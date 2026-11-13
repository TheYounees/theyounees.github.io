/* Google Drive sinxronizasiyası (istəyə bağlı).
   İstifadəçi öz Google Cloud OAuth client ID-sini tənzimləmələrdə daxil edir.
   OAuth PKCE ilə token alınır (client secret lazım deyil). Yaddaş Google Drive
   appDataFolder-də "jarvis.state.v2.json" faylında saxlanılır. */

const TOKEN_KEY = 'jarvis.drive.token';
const CLIENT_KEY = 'jarvis.drive.clientId';
const STATE_KEY = 'jarvis.drive.state';
const VERIFIER_KEY = 'jarvis.drive.verifier';
const FILE_NAME = 'jarvis.state.v2.json';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

function base64Url(buf) {
  let str = '';
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(len) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return base64Url(arr);
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  return crypto.subtle.digest('SHA-256', data);
}

export class DriveSync {
  constructor() {
    this.token = this.loadToken();
    this.clientId = localStorage.getItem(CLIENT_KEY) || '';
    this.fileId = null;
    this.syncTimer = null;
    this.listeners = new Set();
  }

  setClientId(id) {
    this.clientId = String(id || '').trim();
    if (this.clientId) localStorage.setItem(CLIENT_KEY, this.clientId);
    else localStorage.removeItem(CLIENT_KEY);
  }

  getClientId() { return this.clientId; }

  isConnected() {
    return Boolean(this.token?.access_token) && !this.isExpired();
  }

  isExpired() {
    if (!this.token?.expires_at) return false;
    return Date.now() > this.token.expires_at - 60000;
  }

  loadToken() {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      const t = JSON.parse(raw);
      return t && typeof t === 'object' ? t : null;
    } catch { return null; }
  }

  saveToken(t) {
    this.token = t;
    try { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch { /* yoxdur */ }
  }

  clearToken() {
    this.token = null;
    this.fileId = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* yoxdur */ }
  }

  onEvent(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, detail) { this.listeners.forEach((fn) => fn(type, detail)); }

  /* ---------------- OAuth PKCE ---------------- */

  async connect() {
    if (!this.clientId) throw new Error('Əvvəlcə Google Drive Client ID daxil edin.');
    const verifier = randomString(32);
    const challenge = base64Url(await sha256(verifier));
    const state = randomString(16);
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);

    const redirectUri = window.location.origin + window.location.pathname;
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      prompt: 'consent',
      access_type: 'offline'
    });
    window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
  }

  /* Səhifə yüklənəndə callback parametrlərini yoxlayır. Token alınıbsa true qaytarır. */
  async handleCallback() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    if (error) {
      this.cleanUrl();
      throw new Error('Google Drive bağlantısı ləğv edildi: ' + error);
    }
    if (!code) return false;

    const savedState = sessionStorage.getItem(STATE_KEY);
    if (!state || state !== savedState) {
      this.cleanUrl();
      throw new Error('OAuth state uyğun gəlmir.');
    }
    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    if (!verifier) {
      this.cleanUrl();
      throw new Error('OAuth verifier tapılmadı.');
    }

    const clientId = this.clientId || localStorage.getItem(CLIENT_KEY) || '';
    if (!clientId) {
      this.cleanUrl();
      throw new Error('Client ID tapılmadı.');
    }

    const redirectUri = window.location.origin + window.location.pathname;
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      this.cleanUrl();
      throw new Error(data.error_description || data.error || 'Token alınmadı.');
    }

    const token = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || this.token?.refresh_token || null,
      expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000
    };
    this.saveToken(token);
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
    this.cleanUrl();
    this.emit('connected', null);
    return true;
  }

  cleanUrl() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('code');
      url.searchParams.delete('state');
      url.searchParams.delete('scope');
      url.searchParams.delete('authuser');
      url.searchParams.delete('prompt');
      window.history.replaceState({}, '', url.toString());
    } catch { /* yoxdur */ }
  }

  async refreshToken() {
    if (!this.token?.refresh_token || !this.clientId) return false;
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.clientId,
          refresh_token: this.token.refresh_token,
          grant_type: 'refresh_token'
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.access_token) return false;
      const token = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || this.token.refresh_token,
        expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000
      };
      this.saveToken(token);
      return true;
    } catch { return false; }
  }

  async ensureToken() {
    if (!this.token) return false;
    if (!this.isExpired()) return true;
    return this.refreshToken();
  }

  async authHeaders() {
    if (!await this.ensureToken()) throw new Error('Google Drive token yenilənmədi. Yenidən bağlayın.');
    return { Authorization: 'Bearer ' + this.token.access_token };
  }

  /* ---------------- Drive API ---------------- */

  async findFile() {
    if (this.fileId) return this.fileId;
    const headers = await this.authHeaders();
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime)&pageSize=1`, { headers });
    if (!res.ok) throw new Error('Drive fayl siyahısı alınmadı (' + res.status + ').');
    const data = await res.json();
    const f = (data.files || [])[0];
    if (f) { this.fileId = f.id; return f.id; }
    return null;
  }

  async download() {
    const id = await this.findFile();
    if (!id) return null;
    const headers = await this.authHeaders();
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers });
    if (!res.ok) throw new Error('Drive faylı yüklənmədi (' + res.status + ').');
    const text = await res.text();
    try { return JSON.parse(text); } catch { return null; }
  }

  async upload(state) {
    const headers = await this.authHeaders();
    const body = JSON.stringify({ ...state, _driveUpdatedAt: Date.now() });
    const id = await this.findFile();
    if (id) {
      const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body
      });
      if (!res.ok) throw new Error('Drive yenilənmədi (' + res.status + ').');
      return id;
    }
    // create
    const metadata = { name: FILE_NAME, parents: ['appDataFolder'] };
    const boundary = 'jarvis_boundary_' + Math.random().toString(36).slice(2);
    const multipart = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      body,
      `--${boundary}--`
    ].join('\r\n');
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipart
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) throw new Error(data.error?.message || 'Drive faylı yaradılmadı (' + res.status + ').');
    this.fileId = data.id;
    return data.id;
  }

  disconnect() {
    this.clearToken();
    this.emit('disconnected', null);
  }

  /* ---------------- sync helpers ---------------- */

  scheduleSync(state, delay = 2500) {
    if (!this.isConnected()) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(async () => {
      try {
        await this.upload(state);
        this.emit('synced', null);
      } catch (err) {
        this.emit('error', err.message || 'Sinxronizasiya alınmadı.');
      }
    }, delay);
  }

  async pullAndMerge(localState) {
    if (!this.isConnected()) return localState;
    try {
      const remote = await this.download();
      if (!remote) {
        // uzaqda fayl yoxdur — lokalı yükləyirik
        await this.upload(localState);
        this.emit('synced', null);
        return localState;
      }
      const localTs = Number(localState?.updatedAt || localState?.createdAt || 0);
      const remoteTs = Number(remote?._driveUpdatedAt || remote?.updatedAt || remote?.createdAt || 0);
      if (remoteTs > localTs) {
        this.emit('pulled', null);
        return remote;
      }
      // lokal daha yenidir — uzağa yüklə
      await this.upload(localState);
      this.emit('synced', null);
      return localState;
    } catch (err) {
      this.emit('error', err.message || 'Drive-dan oxumaq alınmadı.');
      return localState;
    }
  }
}

export const drive = new DriveSync();
export default drive;