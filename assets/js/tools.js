/* Alətlər: vaxt, hava, axtarış, hesablama, taymer, yaddaş, qeydlər və cihaz əmrləri. */

import { store } from './store.js';
import { formatAzDate, formatAzTime } from './config.js';

/* ---------------- köməkçilər ---------------- */

const WEATHER_CODES = {
  0: 'aydın', 1: 'az buludlu', 2: 'qismən buludlu', 3: 'tutqun',
  45: 'dumanlı', 48: 'qırovlu duman',
  51: 'yüngül çisənti', 53: 'çisənti', 55: 'güclü çisənti',
  56: 'donan çisənti', 57: 'güclü donan çisənti',
  61: 'yüngül yağış', 63: 'yağış', 65: 'güclü yağış',
  66: 'donan yağış', 67: 'güclü donan yağış',
  71: 'yüngül qar', 73: 'qar', 75: 'güclü qar', 77: 'qar dənələri',
  80: 'yüngül leysan', 81: 'leysan', 82: 'güclü leysan',
  85: 'qar leysanı', 86: 'güclü qar leysanı',
  95: 'tufan', 96: 'dolulu tufan', 99: 'güclü dolulu tufan'
};

function degToCompass(deg) {
  const dirs = ['şimal', 'şimal-şərq', 'şərq', 'cənub-şərq', 'cənub', 'cənub-qərb', 'qərb', 'şimal-qərb'];
  return dirs[Math.round(((deg % 360) / 45)) % 8];
}

function ok(data) { return { ok: true, ...data }; }
function fail(error) { return { ok: false, error }; }

/* ---------------- fənər (torch) ---------------- */

let torchState = { stream: null, on: false };

function nativeBridge() {
  try {
    const bridge = window.JarvisNative;
    return bridge && typeof bridge.available === 'function' && bridge.available() ? bridge : null;
  } catch {
    return null;
  }
}

async function setTorch(on) {
  const bridge = nativeBridge();
  if (bridge) {
    try {
      const done = bridge.torch(Boolean(on));
      return done
        ? ok({ message: on ? 'Fənər yandırıldı.' : 'Fənər söndürüldü.' })
        : fail('Bu cihazda fənər tapılmadı.');
    } catch {
      return fail('Fənəri idarə etmək alınmadı.');
    }
  }

  if (on) {
    if (torchState.on) return ok({ message: 'Fənər artıq yanır.' });
    if (!navigator.mediaDevices?.getUserMedia) {
      return fail('Bu brauzer kameraya çıxış vermir, fənər idarə oluna bilməz.');
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }
      });
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (!caps.torch) {
        stream.getTracks().forEach((t) => t.stop());
        return fail('Bu cihaz/tarayıcı fənəri dəstəkləmir (əsasən Android Chrome lazımdır).');
      }
      await track.applyConstraints({ advanced: [{ torch: true }] });
      torchState = { stream, on: true };
      return ok({ message: 'Fənər yandırıldı.' });
    } catch (err) {
      return fail(`Fənər açılmadı: ${err.message}. Kamera icazəsi verildiyini yoxlayın.`);
    }
  }

  if (!torchState.on) return ok({ message: 'Fənər onsuz da sönülüdür.' });
  try {
    torchState.stream.getTracks().forEach((t) => t.stop());
  } catch { /* artıq bağlanıb */ }
  torchState = { stream: null, on: false };
  return ok({ message: 'Fənər söndürüldü.' });
}

export function isTorchOn() { return torchState.on; }

/* ---------------- tətbiq keçidləri ---------------- */

function appLink(app, query) {
  const q = encodeURIComponent(query || '');
  const map = {
    youtube: { href: q ? `https://www.youtube.com/results?search_query=${q}` : 'https://www.youtube.com', label: 'YouTube' },
    spotify: { href: q ? `https://open.spotify.com/search/${q}` : 'https://open.spotify.com', label: 'Spotify' },
    whatsapp: { href: q ? `https://wa.me/?text=${q}` : 'https://web.whatsapp.com', label: 'WhatsApp' },
    telegram: { href: 'https://web.telegram.org', label: 'Telegram' },
    instagram: { href: 'https://www.instagram.com', label: 'Instagram' },
    maps: { href: q ? `https://www.google.com/maps/search/${q}` : 'https://www.google.com/maps', label: 'Xəritə' },
    mail: { href: q ? `mailto:?body=${q}` : 'mailto:', label: 'E-poçt' },
    camera: { href: 'https://www.google.com/search?q=camera', label: 'Kamera' },
    phone: { href: 'tel:', label: 'Zəng' },
    settings: { href: 'https://www.google.com/search?q=phone+settings', label: 'Tənzimləmələr' }
  };
  const key = String(app || '').toLowerCase().trim();
  const found = map[key] || {
    href: `https://www.google.com/search?q=${encodeURIComponent(app + ' ' + (query || ''))}`,
    label: app
  };
  return found;
}

/* ---------------- hava ---------------- */

async function getWeather(city) {
  const place = String(city || store.state.settings.city || 'Bakı').trim();
  try {
      const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=az&format=json`
    );
    const geo = await geoRes.json();
    const loc = geo?.results?.[0];
    if (!loc) return fail(`"${place}" adlı yer tapılmadı.`);

    const params = new URLSearchParams({
      latitude: loc.latitude,
      longitude: loc.longitude,
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: 'auto',
      forecast_days: '3'
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    const data = await res.json();
    if (!data?.current) return fail('Hava məlumatı alınmadı.');

    const c = data.current;
    const days = (data.daily?.time || []).map((iso, i) => ({
      date: iso,
      code: data.daily.weather_code?.[i],
      desc: WEATHER_CODES[data.daily.weather_code?.[i]] || 'naməlum',
      max: Math.round(data.daily.temperature_2m_max?.[i] ?? 0),
      min: Math.round(data.daily.temperature_2m_min?.[i] ?? 0),
      rain: data.daily.precipitation_probability_max?.[i] ?? null
    }));

    return ok({
      yer: `${loc.name}${loc.country ? ', ' + loc.country : ''}`,
      indi: {
        temperatur: Math.round(c.temperature_2m) + '°C',
        hiss_olunan: Math.round(c.apparent_temperature) + '°C',
        veziyyet: WEATHER_CODES[c.weather_code] || 'naməlum',
        rütubət: c.relative_humidity_2m + '%',
        külək: `${Math.round(c.wind_speed_10m)} km/saat, ${degToCompass(c.wind_direction_10m || 0)}`
      },
      prognoz: days
    });
  } catch {
    return fail('Hava xidmətinə qoşulmaq alınmadı.');
  }
}

/* ---------------- veb axtarış ---------------- */

async function webSearch(query) {
  const q = String(query || '').trim();
  if (!q) return fail('Axtarış sorğusu boşdur.');
  const tavilyKey = store.state.settings.searchKey;

  if (tavilyKey) {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: q,
          max_results: 5,
          search_depth: 'basic',
          include_answer: true
        })
      });
      if (res.ok) {
        const data = await res.json();
        return ok({
          mənbə: 'Tavily',
          xülasə: data.answer || null,
          nəticələr: (data.results || []).map((r) => ({
            başlıq: r.title,
            url: r.url,
            mətn: String(r.content || '').slice(0, 500)
          }))
        });
      }
    } catch { /* Vikipediyaya keçirik */ }
  }

  // Açarsız ehtiyat: Azərbaycan Vikipediyası (CORS açıqdır).
  try {
    const lang = 'az';
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=4&prop=extracts&exintro=1&explaintext=1&format=json&origin=*`;
    const res = await fetch(url);
    const data = await res.json();
    const pages = Object.values(data?.query?.pages || {});
    if (!pages.length) {
      return ok({ mənbə: 'Vikipediya', nəticələr: [], qeyd: 'Nəticə tapılmadı. Daha dəqiq sorğu yazın.' });
    }
    return ok({
      mənbə: 'Vikipediya (az)',
      qeyd: 'Dəqiq və aktual xəbər üçün Tavily açarı əlavə edin.',
      nəticələr: pages.map((p) => ({
        başlıq: p.title,
        url: `https://az.wikipedia.org/?curid=${p.pageid}`,
        mətn: String(p.extract || '').slice(0, 420)
      }))
    });
  } catch {
    return fail('Axtarış alınmadı — şəbəkə və ya CORS maneəsi.');
  }
}

/* ---------------- kalkulyator ---------------- */

export function calculate(expression) {
  const raw = String(expression || '').replace(/,/g, '.').trim();
  if (!raw) return fail('İfadə boşdur.');
  if (raw.length > 200) return fail('İfadə çox uzundur.');

  const normalized = raw
    .replace(/π/gi, 'PI')
    .replace(/\bpi\b/gi, 'PI')
    .replace(/√/g, 'sqrt')
    .replace(/\^/g, '**')
    .replace(/\bmod\b/gi, '%')
    .replace(/\bx\b/gi, '*');

  if (!/^[\d\s+\-*/().%PI*Ee_]*$|^[\d\s+\-*/().%\w*]*$/.test(normalized) || /[;:{}[\]"'`=<>]/.test(normalized)) {
    return fail('Yalnız riyazi ifadələr qəbul olunur.');
  }
  if (!/^[\d\s+\-*/().%*A-Za-z_]*$/.test(normalized)) {
    return fail('İfadədə icazəsiz simvol var.');
  }

  try {
    // Yalnız məhdud riyazi kontekst — global obyektlər əlçatan deyil.
    const fn = new Function(
      'PI', 'E', 'sqrt', 'sin', 'cos', 'tan', 'abs', 'log', 'round', 'floor', 'ceil', 'pow',
      `"use strict"; return (${normalized});`
    );
    const value = fn(
      Math.PI, Math.E, Math.sqrt, Math.sin, Math.cos, Math.tan, Math.abs,
      Math.log, Math.round, Math.floor, Math.ceil, Math.pow
    );
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return fail('Nəticə hesablanmadı (sıfıra bölmə və ya yanlış ifadə).');
    }
    return ok({ ifadə: raw, nəticə: Number(value.toFixed(10)) });
  } catch {
    return fail('İfadəni başa düşmədim.');
  }
}

/* ---------------- taymerlər ---------------- */

const timers = new Map();

function setTimer({ minutes, seconds, label }) {
  const total = Number(minutes || 0) * 60 + Number(seconds || 0);
  if (!Number.isFinite(total) || total <= 0) return fail('Vaxt düzgün göstərilməyib.');
  if (total > 60 * 60 * 12) return fail('Maksimum 12 saatlıq taymer mümkündür.');

  const id = 'tim_' + Math.random().toString(36).slice(2, 7);
  const name = label || 'Taymer';
  const timeout = setTimeout(() => {
    timers.delete(id);
    const body = `${name} bitdi.`;
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('JARVIS', { body, icon: 'assets/icon.svg' });
      }
    } catch { /* bildiriş dəstəklənmir */ }
    navigator.vibrate?.([180, 90, 180]);
    window.dispatchEvent(new CustomEvent('jarvis:timer', { detail: { id, label: name } }));
  }, total * 1000);

  timers.set(id, { id, label: name, endsAt: Date.now() + total * 1000, timeout });
  return ok({
    taymer_id: id,
    mesaj: `${name} ${total >= 60 ? Math.round(total / 60) + ' dəqiqə' : total + ' saniyə'} sonra işə düşəcək.`
  });
}

export function listTimers() {
  return [...timers.values()].map(({ id, label, endsAt }) => ({ id, label, endsAt }));
}

/* ---------------- alət sxemləri ---------------- */

export const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'get_time',
      description: 'Cari tarix, saat və həftənin günü. Vaxtla bağlı suallarda istifadə et.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Verilən şəhər üçün cari hava və 3 günlük proqnoz.',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string', description: 'Şəhər adı, məsələn Bakı' } },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'İnternetdə axtarış. Aktual xəbər, fakt, qiymət, hadisə üçün.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Axtarış sorğusu' } },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: 'Riyazi ifadəni hesabla. Məsələn "1250*0.18" və ya "sqrt(144)".',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string' } },
        required: ['expression'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_timer',
      description: 'Taymer qur. İstifadəçi "10 dəqiqə sonra xatırlat" deyəndə çağır.',
      parameters: {
        type: 'object',
        properties: {
          minutes: { type: 'number', description: 'Dəqiqə' },
          seconds: { type: 'number', description: 'Saniyə' },
          label: { type: 'string', description: 'Taymerin adı' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description: 'İstifadəçi haqqında uzunmüddətli vacib məlumatı yadda saxla.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Qısa, birmənalı fakta. Məs. "Hər səhər 7-də qalxır".' }
        },
        required: ['text'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'recall_memory',
      description: 'Keçmiş söhbətlərdə və xatirələrdə axtarış et.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_note',
      description: 'Qeyd yarat (alış-veriş siyahısı, ideya, tapşırıq).',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_profile',
      description: 'İstifadəçinin adını, şəhərini və ya maraqlarını yenilə.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          city: { type: 'string' },
          interests: { type: 'array', items: { type: 'string' } },
          about: { type: 'string' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'device_action',
      description:
        'Telefon/cihaz əməliyyatı. action dəyərləri: torch_on, torch_off, bluetooth, call, sms, open_app, music, notify, vibrate, clipboard_copy, location, battery, share.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['torch_on', 'torch_off', 'bluetooth', 'call', 'sms', 'open_app', 'music', 'notify', 'vibrate', 'clipboard_copy', 'location', 'battery', 'share']
          },
          target: { type: 'string', description: 'Nömrə, tətbiq adı, mətn və ya axtarış sözü' },
          message: { type: 'string', description: 'SMS mətni və ya bildiriş mətni' }
        },
        required: ['action'],
        additionalProperties: false
      }
    }
  }
];

/* ---------------- icra ---------------- */

async function deviceAction(args) {
  const action = String(args.action || '').toLowerCase();
  const target = args.target ? String(args.target) : '';
  const message = args.message ? String(args.message) : '';

  switch (action) {
    case 'torch_on': return setTorch(true);
    case 'torch_off': return setTorch(false);

    case 'bluetooth': {
      if (!navigator.bluetooth) {
        return fail('Bu brauzer Web Bluetooth dəstəkləmir (Android Chrome və ya kompüter Chrome/Edge lazımdır).');
      }
      try {
        const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
        return ok({ message: `Bluetooth cihazı seçildi: ${device.name || 'adsız cihaz'}.` });
      } catch (err) {
        return fail(err.name === 'NotFoundError' ? 'Cihaz seçilmədi.' : `Bluetooth xətası: ${err.message}`);
      }
    }

    case 'call': {
      const number = target.replace(/[^\d+]/g, '');
      if (!number) return fail('Zəng üçün nömrə lazımdır.');
      return ok({
        message: 'Zəngi başlatmaq üçün düyməyə basın.',
        action: { href: `tel:${number}`, label: `Zəng et: ${number}` }
      });
    }

    case 'sms': {
      const number = target.replace(/[^\d+]/g, '');
      const href = `sms:${number}${message ? `?&body=${encodeURIComponent(message)}` : ''}`;
      return ok({
        message: 'SMS pəncərəsini açmaq üçün düyməyə basın.',
        action: { href, label: number ? `SMS: ${number}` : 'SMS yaz' }
      });
    }

    case 'open_app': {
      const link = appLink(target, message);
      return ok({
        message: `${link.label} açmaq üçün düyməyə basın.`,
        action: { href: link.href, label: `${link.label} aç` }
      });
    }

    case 'music': {
      const query = target || message || '';
      const link = appLink(query ? 'spotify' : 'youtube', query);
      return ok({
        message: query ? `"${query}" üçün musiqi axtarışı hazırdır.` : 'Musiqi tətbiqi üçün keçid hazırdır.',
        action: { href: link.href, label: query ? `Musiqi: ${query}` : 'Musiqi aç' }
      });
    }

    case 'notify': {
      if (!('Notification' in window)) return fail('Bu brauzer bildirişləri dəstəkləmir.');
      let perm = Notification.permission;
      if (perm === 'default') perm = await Notification.requestPermission();
      if (perm !== 'granted') return fail('Bildiriş icazəsi verilmədi.');
      new Notification('JARVIS', { body: message || target || 'Bildiriş', icon: 'assets/icon.svg' });
      return ok({ message: 'Bildiriş göndərildi.' });
    }

    case 'vibrate': {
      const bridge = nativeBridge();
      if (bridge) {
        try {
          bridge.vibrate(180);
          return ok({ message: 'Cihaz titrədi.' });
        } catch {
          return fail('Vibrasiya işə düşmədi.');
        }
      }
      if (!navigator.vibrate) return fail('Vibrasiya dəstəklənmir.');
      navigator.vibrate([120, 80, 120]);
      return ok({ message: 'Cihaz titrədi.' });
    }

    case 'clipboard_copy': {
      const text = message || target;
      if (!text) return fail('Kopyalamaq üçün mətn lazımdır.');
      try {
        await navigator.clipboard.writeText(text);
        return ok({ message: 'Mətn buferə kopyalandı.' });
      } catch {
        return fail('Buferə yazmaq alınmadı (brauzer icazəsi).');
      }
    }

    case 'location': {
      if (!navigator.geolocation) return fail('Məkan xidməti dəstəklənmir.');
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { latitude, longitude } = pos.coords;
            const coords = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
            resolve(ok({
              koordinatlar: coords,
              mesaj: 'Məkan təyin edildi.',
              action: { href: `https://www.google.com/maps?q=${coords}`, label: 'Xəritədə aç' }
            }));
          },
          (err) => resolve(fail(`Məkan alınmadı: ${err.message}`)),
          { enableHighAccuracy: true, timeout: 12000 }
        );
      });
    }

    case 'battery': {
      if (!navigator.getBattery) return fail('Batareya məlumatı bu brauzerdə əlçatan deyil.');
      const b = await navigator.getBattery();
      return ok({
        səviyyə: Math.round(b.level * 100) + '%',
        doldurulur: b.charging ? 'bəli' : 'xeyr'
      });
    }

    case 'share': {
      if (!navigator.share) return fail('Paylaşma bu brauzerdə dəstəklənmir.');
      try {
        await navigator.share({ title: 'JARVIS', text: message || target || 'JARVIS' });
        return ok({ message: 'Paylaşma pəncərəsi açıldı.' });
      } catch {
        return fail('Paylaşma ləğv edildi.');
      }
    }

    default:
      return fail(`Naməlum cihaz əməliyyatı: ${action}`);
  }
}

export async function executeTool(name, args = {}) {
  switch (name) {
    case 'get_time': {
      const now = new Date();
      return ok({
        tarix: formatAzDate(now),
        saat: formatAzTime(now),
        iso: now.toISOString()
      });
    }

    case 'get_weather': return getWeather(args.city);
    case 'web_search': return webSearch(args.query);
    case 'calculate': return calculate(args.expression);
    case 'set_timer': return setTimer(args);

    case 'remember': {
      const fact = store.addFact(args.text || args.fact || '');
      return fact
        ? ok({ message: 'Yadda saxladım.', xatirə: fact.text })
        : fail('Yadda saxlanacaq mətn boşdur.');
    }

    case 'recall_memory': {
      const q = args.query || '';
      const facts = store.state.facts
        .filter((f) => f.text.toLowerCase().includes(String(q).toLowerCase()))
        .slice(0, 8)
        .map((f) => f.text);
      const messages = store.searchArchive(q, 6).map((m) => ({
        kim: m.role === 'user' ? 'istifadəçi' : 'JARVIS',
        mətn: m.content.slice(0, 400)
      }));
      return ok({ xatirələr: facts, keçmiş_söhbətlər: messages });
    }

    case 'add_note': {
      const note = store.addNote(args.text || '');
      return note ? ok({ message: 'Qeyd yaradıldı.', qeyd: note.text }) : fail('Qeyd mətni boşdur.');
    }

    case 'update_profile': {
      const patch = {};
      if (args.name) patch.name = String(args.name).slice(0, 60);
      if (args.city) patch.city = String(args.city).slice(0, 60);
      if (Array.isArray(args.interests)) patch.interests = args.interests.slice(0, 20);
      if (args.about) patch.about = String(args.about).slice(0, 400);
      store.setProfile(patch);
      return ok({ message: 'Profil yeniləndi.', profil: store.state.profile });
    }

    case 'device_action': return deviceAction(args);

    default:
      return fail(`Naməlum alət: ${name}`);
  }
}
