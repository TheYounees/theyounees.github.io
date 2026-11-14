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
  if (/api key|invalid key|unauthorized/i.test(detail) && status < 500) {
    return 'API açarı qəbul edilmədi. Tənzimləmələrdən açarı yenidən yoxlayın.';
  }
  if (status === 402) return 'Pulsuz rejimin limiti doldu (402). Bir az sonra yenidən yazın.';
  if (status === 400) {
    return `Açar və ya sorğu qəbul edilmədi (400).${detail ? ' ' + detail : ''} Tənzimləmələrdə “Gətir” düyməsi ilə açarı yoxlayın.`;
  }
  if (status === 401 || status === 403) return 'API açarı qəbul edilmədi (401/403). Tənzimləmələrdən açarı yoxlayın.';
  if (status === 429) return 'Limit aşıldı (429). Bir az sonra yenidən cəhd edin və ya başqa model seçin.';
  if (status === 413) return 'Sorğu model üçün çox böyükdür (413). Keçmiş qısaldılır və daha geniş limitli model sınanır.';
  if (status === 404) {
    return `Model və ya endpoint tapılmadı (404). Provayder modeli dəyişmiş ola bilər — Tənzimləmələrdə “Gətir” düyməsi ilə model siyahısını yeniləyin.${detail ? ' ' + detail : ''}`;
  }
  if (status >= 500) return 'Provayder tərəfində xəta baş verdi. Bir az sonra yenidən cəhd edin.';
  return `Sorğu alınmadı (${status}).${detail ? ' ' + detail : ''}`;
}

/** Provayderdən mövcud model siyahısını götürür. */
export async function fetchModels(settings) {
  if (!settings.apiKey) {
    throw new Error('Əvvəlcə API açarını daxil edin.');
  }

  if (settings.provider === 'gemini') {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(settings.apiKey)}`,
      { signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined }
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
    res = await fetch(`${cfg.baseUrl}/models`, {
      headers,
      signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined
    });
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

function estimateTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.ceil(String(text || '').length / 4);
}

/** Mesajları token büdcəsinə sığdırır: sistem təlimatı + ən son mesajlar. */
function trimMessages(messages, budgetTokens, tools) {
  if (!Array.isArray(messages) || !messages.length) return messages;
  const toolsCost = tools?.length ? estimateTokens(tools) : 0;
  const budget = Math.max(1200, (budgetTokens || 6000) - toolsCost);
  const system = messages[0]?.role === 'system' ? [messages[0]] : [];
  let used = system.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  const tail = [];
  const start = system.length ? 1 : 0;
  for (let i = messages.length - 1; i >= start; i--) {
    const msg = messages[i];
    const cost = estimateTokens(msg.content) + 16;
    if (used + cost > budget && tail.length) break;
    used += cost;
    tail.unshift(msg);
  }
  // Alət cavabı tək qalmasın: başlanğıcdakı tool/assistant-tool_calls mesajlarını atırıq.
  while (tail.length && (tail[0].role === 'tool' || (tail[0].role === 'assistant' && tail[0].tool_calls))) {
    tail.shift();
  }
  return [...system, ...tail];
}

const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_HTTP_ATTEMPTS = 5;

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Sorğu dayandırıldı.'), { name: 'AbortError' }));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Sorğu dayandırıldı.'), { name: 'AbortError' }));
    }, { once: true });
  });
}

/** 402/429 cavabından gözləmə müddətini çıxarır (millisaniyə). */
function retryWaitMs(status, body) {
  const detail = String(body?.error?.message || body?.message || '');
  const parsed = Number((detail.match(/retry after (\d+)\s*s/i) || [])[1] || 0);
  if (parsed > 0) return Math.min(parsed * 1000 + 400, 6000);
  if (status === 402) return 4000;
  if (status === 429) return 4000;
  return 0;
}

/** Sorğu üçün vaxt məhdudiyyəti — provayder cavab verməzsə spinner əbədi qalmasın. */
async function fetchWithTimeout(url, init, signal, timeoutMs) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onAbort = () => ctrl.abort();

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      throw Object.assign(new Error('Sorğu dayandırıldı.'), { name: 'AbortError' });
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return { res, timedOut: false };
  } catch (err) {
    if (timedOut) return { res: null, timedOut: true };
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function chatRequest({ settings, messages, tools, signal, onWait, onModelChange }) {
  const { cfg, url } = endpoint(settings);
  const timeoutMs = Number(settings.requestTimeout) > 0 ? Number(settings.requestTimeout) : 15000;
  // Gemini adətən 1–3 saniyədə cavab verir; 15 saniyə kifayətdir və uzun donmaların qarşısını alır.
  const headers = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  if (settings.provider === 'openrouter') {
    headers['HTTP-Referer'] = location.origin;
    headers['X-Title'] = 'JARVIS';
  }

  let budget = Number(settings.tokenBudget) > 0 ? Number(settings.tokenBudget) : 6000;
  const payload = {
    model: cfg.model,
    messages: trimMessages(messages, budget, tools),
    temperature: Number(settings.temperature ?? 0.75)
  };
  if (tools?.length) {
    payload.tools = tools;
    payload.tool_choice = 'auto';
  }

  let lastError = null;

  // Hər modelin kvotası ayrıdır: limit dolanda avtomatik yüngül modelə keçirik.
  const models = [...new Set([cfg.model, ...(cfg.fallbacks || [])].filter(Boolean))];
  let modelIndex = 0;

  // Pulsuz tier-lərdə 429/5xx (model overloaded) tez-tez olur — qısa fasilə ilə yenidən cəhd edirik.
  for (let attempt = 0; attempt < MAX_HTTP_ATTEMPTS; attempt++) {
    payload.model = models[modelIndex];
    payload.messages = trimMessages(messages, budget, tools);

    let res = null;
    let timedOut = false;
    try {
      const sent = await fetchWithTimeout(
        url,
        { method: 'POST', headers, body: JSON.stringify(payload) },
        signal,
        timeoutMs
      );
      res = sent.res;
      timedOut = sent.timedOut;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastError = new Error('Şəbəkəyə qoşulmaq alınmadı. İnterneti yoxlayın və ya endpoint ünvanını düzəldin.');
      lastError.status = 0;
      if (attempt < MAX_HTTP_ATTEMPTS - 1) {
        await pause(800 * (attempt + 1), signal);
        continue;
      }
      throw lastError;
    }

    if (timedOut) {
      lastError = new Error('Provayder cavab vermədi (vaxt bitdi). Yenidən cəhd edin.');
      lastError.status = 0;
      lastError.timeout = true;
      // Timeout-da yalnız bir dəfə təkrar cəhd: istifadəçi 3 dəqiqə spinner görməsin.
      if (attempt === 0) {
        await pause(1200, signal);
        continue;
      }
      throw lastError;
    }

    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* mətn cavabı */ }
    // Gemini bəzən xətanı massiv içində qaytarır: [{ error: {...} }]
    if (Array.isArray(body)) body = body[0] || null;

    if (res.ok) {
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

    lastError = new Error(errorMessage(res.status, body));
    lastError.status = res.status;

    // 402 (ödənişli limit): xəta göstərmək əvəzinə qısa gözləyib davam edirik.
    const waitMs = res.status === 402 ? retryWaitMs(res.status, body) : 0;
    if (waitMs && attempt < MAX_HTTP_ATTEMPTS - 1) {
      onWait?.(waitMs);
      await pause(waitMs, signal);
      continue;
    }

    // 413: sorğu çox böyükdür — büdcəni kiçildib təkrar cəhd edirik.
    if (res.status === 413) {
      const nextBudget = Math.max(1200, Math.floor(budget * 0.6));
      if (nextBudget < budget) {
        budget = nextBudget;
        await pause(300, signal);
        continue;
      }
    }

    // Model limiti / model tapılmadı / sorğu çox böyük → növbəti modeli sınayırıq (kvotalar ayrıdır).
    if ((res.status === 429 || res.status === 404 || res.status === 413) && modelIndex < models.length - 1) {
      modelIndex += 1;
      onModelChange?.(models[modelIndex]);
      await pause(400, signal);
      continue;
    }

    if (RETRY_STATUSES.has(res.status) && attempt < MAX_HTTP_ATTEMPTS - 1) {
      await pause(res.status === 429 ? 2400 : 1000 * (attempt + 1), signal);
      continue;
    }
    throw lastError;
  }

  throw lastError || new Error('Cavab alınmadı.');
}

/* ---------------- alət dövrü ---------------- */

/** Alət nəticəsini insan dilinə çevirir (pulsuz rejimdə model əvəzinə biz yazırıq). */
function formatToolOutput(name, out) {
  if (!out) return 'nəticə yoxdur';
  if (out.ok === false) return out.error || out.message || 'alınmadı';

  if (name === 'get_weather' && out.indi) {
    const i = out.indi;
    return `${i.temperatur}, hiss olunan ${i.hiss_olunan}, ${i.veziyyet}, külək ${i.külək} (${out.yer})`;
  }
  if (name === 'get_time') return `${out.tarix}, saat ${out.saat}`;
  if (name === 'calculate') return `${out.ifadə} = ${out.nəticə}`;
  if (name === 'set_timer') return out.message || out.xəbərdarlıq || 'taymer quruldu';
  if (name === 'recall_memory') {
    const facts = out['xatirələr'] || [];
    return facts.length ? facts.slice(0, 3).join('; ') : 'yaddaşda uyğun qeyd yoxdur';
  }
  if (Array.isArray(out['nəticələr'])) {
    return out['nəticələr'].slice(0, 2).map((r) => r['başlıq'] || r.title || r['xülasə'] || '').filter(Boolean).join(' | ') || 'nəticə tapılmadı';
  }

  const text = out.text || out.message || out.summary || out['nəticə'];
  if (text) return String(text).slice(0, 240);
  return JSON.stringify(out).slice(0, 200);
}

const TOOL_SENTENCES = {
  update_profile: () => 'Sizi tanıdım, bunu yadda saxladım.',
  remember: (out, args) => `Yadda saxladım${args?.text ? ': ' + String(args.text).slice(0, 120) : '.'}`,
  add_note: () => 'Qeydi əlavə etdim.',
  set_timer: (out) => out?.message || 'Taymeri qurdum.'
};

function toolSummaryText(toolsUsed) {
  const lines = toolsUsed.slice(-3).map((t) => {
    const sentence = TOOL_SENTENCES[t.name];
    if (sentence) return sentence(t.result, t.args);
    return `${t.name === 'get_weather' ? 'Hava' : TOOL_TITLES[t.name] || t.name}: ${formatToolOutput(t.name, t.result)}`;
  });
  return `${lines.join('\n')}\n\n(Açarsız rejimdə cavablar arasında təxminən 45 saniyə fasilə lazımdır.)`;
}

const TOOL_TITLES = {
  get_time: 'Vaxt',
  web_search: 'Axtarış',
  calculate: 'Hesablama',
  set_timer: 'Taymer',
  remember: 'Yaddaş',
  recall_memory: 'Yaddaş',
  add_note: 'Qeyd',
  device_action: 'Cihaz'
};

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
export async function runTurn({ settings, messages, toolDefs, executeTool, onTool, onWait, onModelChange, signal }) {
  const convo = [...messages];
  const toolsUsed = [];
  const actions = [];
  const allowedTools = new Set((toolDefs || []).map((t) => t?.function?.name).filter(Boolean));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let result;
    try {
      result = await chatRequest({ settings, messages: convo, tools: toolDefs, signal, onWait, onModelChange });
    } catch (err) {
      // Pulsuz rejimdə limit alətdən sonra bitə bilər — əlimizdəki nəticəni istifadəçiyə veririk.
      if (toolsUsed.length && (err.status === 402 || err.status === 429)) {
        return { text: toolSummaryText(toolsUsed), toolsUsed, actions, rawMessages: convo };
      }
      throw err;
    }

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

      if (allowedTools.size && !allowedTools.has(call.name)) {
        // Model uydurma alət adı çağıra bilər — onu düzgün siyahıyla geri qaytarırıq.
        output = { ok: false, error: `"${call.name}" aləti yoxdur. Mövcud alətlər: ${[...allowedTools].join(', ')}` };
      } else {
        try {
          output = await executeTool(call.name, args);
        } catch (err) {
          output = { ok: false, error: err?.message || 'Alət icra olunmadı.' };
        }
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
    signal,
    onWait,
    onModelChange
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
    return `Salam${name}. Mən JARVIS-əm. Hazırda beynim qoşulmayıb. Tənzimləmələr → Beyin bölməsindən ya pulsuz rejimi (açarsız) seç, ya da API açarı əlavə et — sonra tam söhbət edə biləcəyik.`;
  }

  if (/saat|vaxt|tarix/.test(text)) {
    return `İndi saat ${formatAzTime(now)}, ${formatAzDate(now)}.`;
  }

  return `Beyin hələ qoşulmayıb, ona görə bu suala düzgün cavab verə bilmirəm. Tənzimləmələr → Beyin bölməsindən “Pulsuz (açarsız)” rejimini seçin və ya Gemini açarı əlavə edin — ikisi də pulsuzdur.`;
}
