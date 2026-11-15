/* Google Drive sinxronizasiyası (istəyə bağlı).
   İstifadəçi öz Google Cloud OAuth client ID-sini tənzimləmələrdə daxil edir.
   OAuth PKCE + client secret ilə token alınır (Google secret-i PKCE-də də tələb edir).
   Yaddaş Google Drive
   appDataFolder-də "jarvis.state.v2.json" faylında saxlanılır. */

const TOKEN_KEY = 'jarvis.drive.token';
const CLIENT_KEY = 'jarvis.drive.clientId';
const SECRET_KEY = 'jarvis.drive.clientSecret';
const STATE_KEY = 'jarvis.drive.state';
const VERIFIER_KEY = 'jarvis.drive.verifier';
const FOLDER_NAME = 'JARVIS';
const FILES = { profile: 'profil.json', chats: 'sohbetler.json', settings: 'ayarlar.json', notes: 'qeydler.json' };
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

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

function mergeRemote(local, remote) {
  const settings = { ...(local.settings || {}), ...(remote.settings || {}) };
  // API açarı və client secret yalnız cihazda qalır.
  settings.apiKey = local.settings?.apiKey || '';
  settings.driveClientSecret = local.settings?.driveClientSecret || '';
  return {
    ...local,
    profile: { ...(local.profile || {}), ...(remote.profile || {}) },
    facts: (remote.facts && remote.facts.length) ? remote.facts : (local.facts || []),
    notes: (remote.notes && remote.notes.length) ? remote.notes : (local.notes || []),
    chats: (remote.chats && remote.chats.length) ? remote.chats : (local.chats || []),
    activeChatId: remote.activeChatId || local.activeChatId,
    settings,
    updatedAt: Date.now()
  };
}

async function driveError(res, prefix) {
  let detail = '';
  try {
    const data = await res.json();
    detail = data?.error?.message || '';
  } catch { /* gövdə yoxdur */ }
  if (res.status === 403 && /has not been used|disabled|accessNotConfigured/i.test(detail)) {
    return 'Google Drive API açılmayıb. Google Cloud Console → APIs & Services → Library → "Google Drive API" → Enable. Sonra tətbiqdə yenidən bağlayın.';
  }
  if (res.status === 403 && /insufficient|scope/i.test(detail)) {
    return 'Google icazəsi çatmır (scope). "Bağlantını kəs" → yenidən "Google Drive bağla" edin.';
  }
  return `${prefix} (${res.status})${detail ? ': ' + detail : ''}`;
}

function tokenError(data) {
  const code = String(data?.error || '');
  const desc = String(data?.error_description || code || 'Token alınmadı.');
  if (/client_secret/i.test(desc + ' ' + code)) {
    return "Google client secret tələb edir. Tənzimləmələrdə «Client secret» xanasını doldurun: Google Console → Credentials → OAuth client → Client secret (GOCSPX-...).";
  }
  if (/redirect_uri/i.test(desc + ' ' + code)) {
    return "Redirect URI uyğun deyil. Google Console → Authorized redirect URIs-ə " + 'https://theyounees.github.io/oauth-callback.html' + " əlavə edin.";
  }
  if (/invalid_grant/i.test(desc)) {
    return "Kod vaxtı bitib və ya artıq istifadə olunub. Yenidən «Google Drive bağla»ya basın.";
  }
  return desc;
}

export class DriveSync {
  constructor() {
    this.token = this.loadToken();
    this.clientId = localStorage.getItem(CLIENT_KEY) || '';
    this.clientSecret = localStorage.getItem(SECRET_KEY) || '';
    this.folderId = null;
    this.syncTimer = null;
    this.listeners = new Set();
  }

  setClientId(id) {
    this.clientId = String(id || '').trim();
    if (this.clientId) localStorage.setItem(CLIENT_KEY, this.clientId);
    else localStorage.removeItem(CLIENT_KEY);
  }

  setClientSecret(secret) {
    this.clientSecret = String(secret || '').trim();
    if (this.clientSecret) localStorage.setItem(SECRET_KEY, this.clientSecret);
    else localStorage.removeItem(SECRET_KEY);
  }

  getClientId() { return this.clientId; }

  /** Native körpü (APK) varsa OAuth xarici brauzerdə aparılır. */
  isNative() {
    try {
      return Boolean(window.JarvisNative?.available?.());
    } catch { return false; }
  }

  /** OAuth redirect URI — Google Cloud Console-da eyni ilə qeydiyyatdan keçməlidir. */
  redirectUri() {
    if (this.isNative()) return 'https://theyounees.github.io/oauth-callback.html';
    const path = window.location.pathname && window.location.pathname !== '/' ? window.location.pathname : '/';
    return window.location.origin + path;
  }

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
    this.folderId = null;
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

    const redirectUri = this.redirectUri();
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
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
    if (this.isNative()) {
      // APK: xarici brauzerdə açırıq; cavab azjarvis:// deep link ilə geri gəlir.
      this.emit('opening', null);
      window.JarvisNative.openUrl(authUrl);
      return;
    }
    window.location.href = authUrl;
  }

  /** Native deep link (azjarvis://oauth?code=...) ilə gələn cavabı emal edir. */
  async handleRedirect(rawUrl) {
    let url;
    try { url = new URL(rawUrl); } catch { return false; }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    if (error) throw new Error('Google Drive bağlantısı ləğv edildi: ' + error);
    if (!code) return false;
    return this.exchangeCode(code, state);
  }

  async exchangeCode(code, state) {
    const savedState = sessionStorage.getItem(STATE_KEY);
    if (!state || state !== savedState) throw new Error('OAuth state uyğun gəlmir.');
    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    if (!verifier) throw new Error('OAuth verifier tapılmadı.');
    const clientId = this.clientId || localStorage.getItem(CLIENT_KEY) || '';
    if (!clientId) throw new Error('Client ID tapılmadı.');

    const redirectUri = this.redirectUri();
    const body = new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });
    if (this.clientSecret) body.set('client_secret', this.clientSecret);
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw new Error(tokenError(data));
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
    return this.exchangeCode(code, state);
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
      const body = new URLSearchParams({
        client_id: this.clientId,
        refresh_token: this.token.refresh_token,
        grant_type: 'refresh_token'
      });
      if (this.clientSecret) body.set('client_secret', this.clientSecret);
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
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

  /** "JARVIS" qovluğu — bütün fayllar burada saxlanılır. */
  async findFolder(create = true) {
    if (this.folderId) return this.folderId;
    const headers = await this.authHeaders();
    const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1`, { headers });
    if (!res.ok) throw new Error(await driveError(res, 'Drive qovluğu oxunmadı'));
    const data = await res.json().catch(() => ({}));
    const found = (data.files || [])[0];
    if (found) { this.folderId = found.id; return found.id; }
    if (!create) return null;
    const created = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    });
    const cdata = await created.json().catch(() => ({}));
    if (!created.ok || !cdata.id) throw new Error(await driveError(created, 'Drive qovluğu yaradılmadı'));
    this.folderId = cdata.id;
    return cdata.id;
  }

  async findFile(name, folderId) {
    const headers = await this.authHeaders();
    const q = encodeURIComponent(`name='${name}' and '${folderId}' in parents and trashed=false`);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&pageSize=1`, { headers });
    if (!res.ok) throw new Error(await driveError(res, 'Drive fayl siyahısı alınmadı'));
    const data = await res.json().catch(() => ({}));
    const f = (data.files || [])[0];
    return f ? f.id : null;
  }

  async downloadNamed(name, folderId) {
    const id = await this.findFile(name, folderId);
    if (!id) return null;
    const headers = await this.authHeaders();
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers });
    if (!res.ok) throw new Error(await driveError(res, `${name} yüklənmədi`));
    const text = await res.text();
    try { return JSON.parse(text); } catch { return null; }
  }

  async uploadNamed(name, obj, folderId) {
    const headers = await this.authHeaders();
    const body = JSON.stringify(obj, null, 2);
    const id = await this.findFile(name, folderId);
    if (id) {
      const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body
      });
      if (!res.ok) throw new Error(await driveError(res, `${name} yenilənmədi`));
      return id;
    }
    const boundary = 'jarvis_boundary_' + Math.random().toString(36).slice(2);
    const metadata = { name, mimeType: 'application/json', parents: [folderId], description: 'JARVIS yaddaşı' };
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
    if (!res.ok || !data.id) throw new Error(await driveError(res, `${name} yaradılmadı`));
    return data.id;
  }

  /** Bütün vəziyyəti 4 ayrı fayl kimi JARVIS qovluğuna yazır. */
  async syncAll(state) {
    const folder = await this.findFolder(true);
    const settings = { ...state.settings };
    delete settings.apiKey;
    delete settings.driveClientSecret;
    await this.uploadNamed(FILES.profile, { profile: state.profile, facts: state.facts || [] }, folder);
    await this.uploadNamed(FILES.chats, { chats: state.chats || [], activeChatId: state.activeChatId || '' }, folder);
    await this.uploadNamed(FILES.settings, { settings, timers: state.timers || [] }, folder);
    await this.uploadNamed(FILES.notes, { notes: state.notes || [] }, folder);
  }

  /** Drive-dakı faylları oxuyur (bir fayl da olsa qaytarır). */
  async pullAll() {
    const folder = await this.findFolder(false);
    if (!folder) return null;
    const [profile, chats, settings, notes] = await Promise.all([
      this.downloadNamed(FILES.profile, folder),
      this.downloadNamed(FILES.chats, folder),
      this.downloadNamed(FILES.settings, folder),
      this.downloadNamed(FILES.notes, folder)
    ]);
    if (!profile && !chats && !settings && !notes) return null;
    return {
      profile: profile?.profile || null,
      facts: profile?.facts || [],
      chats: chats?.chats || [],
      activeChatId: chats?.activeChatId || '',
      settings: settings?.settings || null,
      timers: settings?.timers || [],
      notes: notes?.notes || []
    };
  }

  /** İstifadəçi "Sinxronlaşdır" basanda Drive-dan məcburi oxuyur. */
  async forcePull(localState) {
    const remote = await this.pullAll();
    if (!remote) return null;
    return mergeRemote(localState, remote);
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
        await this.syncAll(state);
        this.emit('synced', null);
      } catch (err) {
        this.emit('error', err.message || 'Sinxronizasiya alınmadı.');
      }
    }, delay);
  }

  async pullAndMerge(localState) {
    if (!this.isConnected()) return localState;
    try {
      const remote = await this.pullAll();
      if (!remote) {
        await this.syncAll(localState);
        this.emit('synced', null);
        return localState;
      }
      const merged = mergeRemote(localState, remote);
      await this.syncAll(merged);
      this.emit('pulled', null);
      return merged;
    } catch (err) {
      this.emit('error', err.message || 'Drive-dan oxumaq alınmadı.');
      return localState;
    }
  }
}

export const drive = new DriveSync();
export default drive;