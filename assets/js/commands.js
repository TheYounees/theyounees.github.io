/* Yerli əmr ayrışdırıcısı: modelə göndərmədən dərhal icra olunan qısa əmrlər.
   Azərbaycan hərfləri olmadan yazılışı da başa düşür (ə/e, ı/i, ö/o, ü/u, ş/s, ç/c, ğ/g). */

const AZ = { ə: 'e', ı: 'i', ö: 'o', ü: 'u', ş: 's', ç: 'c', ğ: 'g' };

export function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[əıöüşçğ]/g, (c) => AZ[c])
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NAV_APPS = [
  [/waze|veys/, 'waze'],
  [/yandex/, 'yandex'],
  [/google maps|google xerite|xerite|maps/, 'google']
];

function detectNavApp(n) {
  for (const [re, app] of NAV_APPS) if (re.test(n)) return app;
  return '';
}

const STOPWORDS = new Set([
  'və', 've', 'ilə', 'ile', 'ə', 'e', 'də', 'de', 'da', 'ki', 'kimi', 'kadar', 'qədər', 'qeder',
  'aç', 'ac', 'göstər', 'goster', 'qur', 'başlat', 'baslat', 'gir', 'et', 'elə', 'ele', 'necə', 'nece', 'hardan',
  'gedim', 'gedək', 'gedek', 'getmək', 'getmek', 'çatmaq', 'catmaq', 'gedən', 'geden', 'gedir',
  'yolu', 'yolunu', 'yolda', 'yol', 'marşrutu', 'marşrutunu', 'marşrut', 'navigasiyanı', 'navigasiya',
  'waze', 'veys', 'yandex', 'navi', 'google', 'maps', 'xəritə', 'xerite', 'proqramında', 'proqramına'
]);

/** Mənzili orijinal yazılışda saxlayır (Azərbaycan hərfləri ilə). */
function extractDestination(raw) {
  const words = String(raw)
    .toLowerCase()
    .replace(/['’`]/g, ' ')
    .replace(/[!?.,:;()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !STOPWORDS.has(w))
    .filter((w) => !/^(waze|veys|yandex|xerite|xəritə|maps|navi|google)/.test(w));
  if (!words.length) return '';
  // "bravo marketə" / "bravo marketdən" → "bravo market"
  const last = words[words.length - 1].replace(/(dən|den|dan|də|de|yə|ye|ə|e)$/, '');
  if (last) words[words.length - 1] = last;
  return words.join(' ').trim();
}

function legacyExtractDestination(n) {
  let d = n
    .replace(/\b(waze\w*|veys\w*|yandex\w*|navi|google maps|google|xerite\w*|maps)\b/g, ' ')
    .replace(/\b(yolu|yolunu|yolda|yol|marsrutu|marsrutunu|marsrut|navigasiyani|navigasiya)\b/g, ' ')
    .replace(/\b(ac|goster|qur|baslat|gir|nece|hardan|gedim|gedek|getmek|catmaq|geden|gedir)\b/g, ' ')
    .replace(/\b(ve|ile|e|de|da|ki|kimi|kadar|qeder)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // "marketdən gedən yol" → "market"
  d = d.replace(/\b([a-z0-9]+?)(den|dan)$/, '$1');
  return d.trim();
}

/** Qaytarır: null və ya { type, target?, app?, repeat? } */
export function parseLocalCommand(text, ctx = {}) {
  const n = normalizeText(text);
  if (!n) return null;

  if (/(fener|fanar|isig)/.test(n)) {
    const on = /(yan|yandir|yandur|ac)/.test(n);
    const off = /(sondur|bagla|son)\b/.test(n);
    if (on || off) return { type: on && !off ? 'torch_on' : 'torch_off' };
  }

  if (/(saat nece|nece saat|saat necedir)/.test(n)) return { type: 'time' };

  // "yenə aç", "təkrar aç", "bir daha aç", "onu aç"
  if (/^(yene|tekrar|yeniden|bir daha|onu|onlari)\s+(ac|gir)$/.test(n)) {
    return ctx.lastApp
      ? { type: 'open_app', target: ctx.lastApp, repeat: true }
      : { type: 'repeat_missing' };
  }

  const navApp = detectNavApp(n);
  const wantsOpen = /(^|\s)(ac|goster|qur|baslat|et|ele)(\s|$)/.test(n);
  const navWords = /(yol|marsrut|navigasiya|gedim|gedek|getmek|catmaq)/.test(n);
  if (wantsOpen && (navApp || navWords) && !/^(xeriteni|xerite|waze|veys|yandex)\s+ac$/.test(n)) {
    let dest = extractDestination(text);
    // "bunu / onu google xəritədə aç" — əvvəlki mənzili yeni proqramda göstər.
    if (!dest || /^(bunu|onu|bura|bunu\s+)/.test(dest)) {
      if (ctx.lastNav) dest = ctx.lastNav;
    }
    if (dest) return { type: 'navigate', target: dest, app: navApp };
    if (navApp) return { type: 'open_app', target: navApp };
  }

  if (/^(bunu|onu)\b/.test(n) && /(xerite|maps|xeritede|xeritede)/.test(n) && ctx.lastNav) {
    return { type: 'navigate', target: ctx.lastNav, app: detectNavApp(n) || 'google' };
  }

  const m = n.match(/^(.*?)\s*(?:ac|gir)$/);
  if (m) {
    let name = m[1].trim().replace(/(ni|nu|n[ıiuü]|[ıiuü])$/, '').trim();
    if (!name || name.length > 32 || name.split(' ').length > 4) return null;
    if (/(plan|hesab|sohbet|mesaj|qeyd|yaddas|axtar|sayt|link|bluetooth|wifi|wi fi|internet|parlaqliq|ses|rejim|yol|marsrut)/.test(name)) return null;
    return { type: 'open_app', target: name };
  }

  return null;
}
