/* Beyin: OpenAI-uyğun chat completions API, alət (tool) dövrü və JARVIS şəxsiyyəti. */

import { providerConfig, formatAzDate, formatAzTime } from './config.js';

const MAX_TOOL_ROUNDS = 5;

/* ---------------- sistem təlimatı ---------------- */

export function buildSystemPrompt({ profile, facts, notes, settings, now = new Date() }) {
  const interests = (profile.interests || []).length
    ? profile.interests.join(', ')
    : 'hələ qeyd olunmayıb';

  const factLines = facts.length
    ? facts.slice(0, 40).map((f, i) => `${i + 1}. ${f.text}`).join('\n')
    : '(hələ xatirə yoxdur)';

  const noteLines = notes.length
    ? notes.slice(0, 15).map((n) => `- ${n.text}`).join('\n')
    : '(qeyd yoxdur)';

  const stamp = `${formatAzDate(now)}, saat ${formatAzTime(now)}`;

  return `Sən JARVIS-sən — ${profile.name ? profile.name + ' üçün' : 'istifadəçi üçün'} yaradılmış şəxsi süni intellekt köməkçisi. Iron Man filmindəki JARVIS-dən ilhamlanmısan, amma öz xarakterin var.

## Kimliyin
- Ağıllı, məntiqli, sakit və özünəinamlı. Panikaya düşmürsən, mövzunu dəyişmirsən.
- Səmimi, lakin həddindən artıq emosional deyilsən. Yaltaqlıq etmirsən, boş tərif yazmırsan.
- İncə yumor hissin var — yeri gələndə bir qısa zarafat edirsən, amma ciddi mövzuda zarafata keçmirsən.
- Təşəbbüs göstərirsən: növbəti addımı təklif edirsən, riski qabaqcadan deyirsən.
- İstifadəçini tanıyırsan və buna uyğun danışırsan.

## Danışıq qaydaları
1. Həmişə Azərbaycan dilində cavab ver. Dil təbii və canlı olsun — rəsmi sənəd dili deyil, ağıllı bir insanın danışığı kimi. Texniki terminləri (API, framework, debug və s.) olduğu kimi işlədə bilərsən.
2. Sual sadədirsə — qısa və konkret cavab ver (1–3 cümlə). Mürəkkəb sualdırsa — lazım olan qədər ətraflı izah et, strukturlaşdır (başlıqlar, siyahılar).
3. Cavabı lazımsız giriş sözləri ilə doldurma ("Əlbəttə, sizə kömək etməkdən məmnunam..." kimi). Birbaşa işə keç.
4. İstifadəçi səhv düşünürsə, ona avtomatik haqq vermə. Səbəbini göstər, alternativi təklif et. Haqlı olanda da bunu qısa de.
5. Bilmirsənsə — "bilmirəm" de və nəyi yoxlaya biləcəyini təklif et. Uydurma.
6. Cavabı səslə də oxunacaq kimi yaz: uzun URL-lər, artıq simvollar, emoji istifadə etmə.
7. Sən həm də proqramçı, analitik, müəllim və planlaşdırıcısan. Kod yazanda işlək və səliqəli kod ver.

## Yaddaş
İstifadəçi haqqında bildiklərin:
- Ad: ${profile.name || '(bilinmir — bir dəfə nəzakətlə soruşa bilərsən)'}
- Şəhər: ${profile.city || '(bilinmir)'}
- Maraqlar: ${interests}
- Qeyd: ${profile.about || '(yoxdur)'}

Xatirələr:
${factLines}

Qeydlər:
${noteLines}

Qaydalar:
- Yeni, uzunmüddətli və vacib məlumat eşidəndə (adlar, vərdişlər, planlar, üstünlüklər, iş, ailə, sağlamlıq rutini) "remember" alətini çağır.
- Şifrə, bank kartı, token, pasport nömrəsi kimi həssas məlumatları YADDA SAXLAMA. İstifadəçi belə məlumat yazsa, xatırlat ki, onu yaddaşa salmırsan.
- Yaddaşda olmayan şeyi "xatırlayıram" deyə iddia etmə. Keçmiş söhbəti xatırlamaq lazımdırsa "recall_memory" aləti ilə arxivdə axtar.

${stamp} (indiki tarix və saat)

## Alətlər
Sənin real alətlərin var: vaxt, hava, veb axtarış, kalkulyator, taymer, yaddaş, qeyd, profil yeniləmə və cihaz əməliyyatları (fənər, Bluetooth, zəng, SMS, tətbiq açma, musiqi, bildiriş, vibrasiya, bufer, məkan, batareya).
- Lazım olanda çağır, nəticəni istifadə et. Nəticəni uydurma.
- Alət xəta qaytararsa, istifadəçiyə dürüst de. "Cihaz bunu dəstəkləmir" və ya "icazə verilmədi" kimi.
- Zəng, SMS və tətbiq açma kimi əməliyyatlar üçün alət istifadəçiyə təsdiq düyməsi qaytarır; bunu "artıq etdim" kimi təqdim etmə, "düyməyə bas" de.
- Fənər kimi bəzi funksiyalar brauzer icazəsi və Android cihaz tələb edir.

## Məxfilik
Bütün yaddaş istifadəçinin cihazındadır. Ona ehtiyatsız yerdə təkrar-təkrar xatırlatma; sadəcə təhlükəsiz davran.`;
}

/* ---------------- HTTP qatı ---------------- */

function endpoint(settings) {
  const cfg = providerConfig(settings);
  if (!cfg.baseUrl) throw new Error('Baza URL təyin olunmayıb. Tənzimləmələrdən provayder seçin.');
  return { cfg, url: `${cfg.baseUrl}/chat/completions` };
}

function errorMessage(status, body) {
  const detail = body?.error?.message || body?.message || '';
  if (status === 401 || status === 403) return 'API açarı qəbul edilmədi (401/403). Tənzimləmələrdən açarı yoxlayın.';
  if (status === 429) return 'Limit aşıldı (429). Bir az sonra yenidən cəhd edin və ya başqa model seçin.';
  if (status === 404) {
    return `Model və ya endpoint tapılmadı (404). Provayder modeli dəyişmiş ola bilər — Tənzimləmələrdə “Gətir” düyməsi ilə model siyahısını yeniləyin.${detail ? ' ' + detail : ''}`;
  }
  if (status >= 500) return 'Provayder tərəfində xəta baş verdi. Bir az sonra yenidən cəhd edin.';
  return `Sorğu alınmadı (${status}).${detail ? ' ' + detail : ''}`;
}

/** Provayderdən mövcud model siyahısını götürür. */
export async function fetchModels(settings) {
  if (!settings.apiKey && settings.provider !== 'ollama') {
    throw new Error('Əvvəlcə API açarını daxil edin.');
  }

  if (settings.provider === 'gemini') {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(settings.apiKey)}`
    );
    if (!res.ok) throw new Error(errorMessage(res.status, null));
    const data = await res.json();
    return (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => String(m.name || '').replace(/^models\//, ''))
      .filter((id) => id && !/embedding|aqa|imagen|veo|tts|image|live|native-audio|learnlm/i.test(id));
  }

  const cfg = providerConfig(settings);
  if (!cfg.baseUrl) throw new Error('Baza URL təyin olunmayıb.');
  const headers = {};
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  let res;
  try {
    res = await fetch(`${cfg.baseUrl}/models`, { headers });
  } catch {
    throw new Error('Model siyahısına qoşulmaq alınmadı.');
  }
  if (!res.ok) throw new Error(errorMessage(res.status, null));
  const data = await res.json();
  const raw = data.data || data.models || [];
  return raw
    .map((m) => m.id || m.name)
    .filter(Boolean)
    .filter((id) => !/embed|whisper|tts|dall-e|moderation|image|rerank/i.test(String(id)));
}

/** Siyahıdan ən uyğun modeli seçir (yeni versiya, flash/mini üstünlük). */
export function pickModel(ids, provider) {
  if (!Array.isArray(ids) || !ids.length) return '';
  const scored = ids.map((id) => {
    const name = String(id);
    let score = 0;
    const version = Number.parseFloat((name.match(/(\d+(?:\.\d+)?)/) || [])[1] || '0');
    if (Number.isFinite(version)) score += version * 10;
    if (/flash/i.test(name)) score += 4;
    if (/mini|chat|instruct/i.test(name)) score += 2;
    if (/latest/i.test(name)) score += 3;
    if (/pro/i.test(name) && provider === 'gemini') score += 1;
    if (/lite/i.test(name)) score -= 1;
    if (/preview|exp|alpha|beta|test|thinking/i.test(name)) score -= 6;
    if (/embedding|vision|audio|tts|image/i.test(name)) score -= 20;
    return { id: name, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].id;
}

export async function chatRequest({ settings, messages, tools, signal }) {
  const { cfg, url } = endpoint(settings);
  const headers = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  if (settings.provider === 'openrouter') {
    headers['HTTP-Referer'] = location.origin;
    headers['X-Title'] = 'JARVIS';
  }

  const payload = {
    model: cfg.model,
    messages,
    temperature: Number(settings.temperature ?? 0.75)
  };
  if (tools?.length) {
    payload.tools = tools;
    payload.tool_choice = 'auto';
  }

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('Şəbəkəyə qoşulmaq alınmadı. İnterneti yoxlayın və ya endpoint ünvanını düzəldin.');
  }

  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* mətn cavabı */ }

  if (!res.ok) throw new Error(errorMessage(res.status, body));
  if (!body) throw new Error('Provayder boş cavab qaytardı.');

  const choice = body.choices?.[0];
  const message = choice?.message || {};
  const toolCalls = (message.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function?.name,
    argsRaw: tc.function?.arguments || '{}'
  }));

  return {
    content: typeof message.content === 'string' ? message.content : '',
    toolCalls,
    finishReason: choice?.finish_reason || null,
    usage: body.usage || null
  };
}

/* ---------------- alət dövrü ---------------- */

function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return { _raw: String(raw) };
  }
}

/**
 * Bir növbəni idarə edir: model → alətlər → model ... → yekun mətn.
 * @returns {{text: string, toolsUsed: Array, actions: Array, rawMessages: Array}}
 */
export async function runTurn({ settings, messages, toolDefs, executeTool, onTool, signal }) {
  const convo = [...messages];
  const toolsUsed = [];
  const actions = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await chatRequest({ settings, messages: convo, tools: toolDefs, signal });

    if (!result.toolCalls.length) {
      return { text: result.content.trim(), toolsUsed, actions, rawMessages: convo };
    }

    convo.push({
      role: 'assistant',
      content: result.content || null,
      tool_calls: result.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.argsRaw || '{}' }
      }))
    });

    for (const call of result.toolCalls) {
      const args = parseArgs(call.argsRaw);
      let output;
      try {
        output = await executeTool(call.name, args);
      } catch (err) {
        output = { ok: false, error: err?.message || 'Alət icra olunmadı.' };
      }

      if (output?.action) actions.push(output.action);
      toolsUsed.push({ name: call.name, args, result: output });
      onTool?.(call.name, args, output);

      convo.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(output).slice(0, 6000)
      });
    }
  }

  // Alət dövrü bitmədi — modeldən yekun cavab istəyirik.
  const final = await chatRequest({
    settings,
    messages: [
      ...convo,
      { role: 'user', content: 'Alətlərin nəticələrinə əsasən istifadəçiyə qısa yekun cavab ver.' }
    ],
    tools: [],
    signal
  });

  return {
    text: final.content.trim() || 'Alətləri işə saldım, amma yekun cavab formalaşmadı.',
    toolsUsed,
    actions,
    rawMessages: convo
  };
}

/* ---------------- açar olmayanda ---------------- */

export function localFallback(input, { settings, profile }) {
  const text = String(input || '').toLowerCase();
  const now = new Date();

  if (/^(salam|salaam|hey|hi|hello|necəsən|necesen)/.test(text.trim())) {
    const name = profile.name ? `, ${profile.name}` : '';
    return `Salam${name}. Mən JARVIS-əm. Hazırda beynim qoşulmayıb — yəni söhbəti tam aparmaq üçün API açarı lazımdır. Amma saat, hava və cihaz əmrləri işləyir.

Tənzimləmələr → Beyin bölməsindən açarı əlavə et, sonra davam edək.`;
  }

  if (/saat|vaxt|tarix/.test(text)) {
    return `İndi saat ${formatAzTime(now)}, ${formatAzDate(now)}.`;
  }

  return `Beyin hələ qoşulmayıb, ona görə bu suala düzgün cavab verə bilmirəm. Tənzimləmələr → Beyin bölməsindən API açarı əlavə edin (Gemini üçün pulsuzdur), sonra hər şey işləyəcək.`;
}
