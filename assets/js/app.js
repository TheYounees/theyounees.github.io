/* Tətbiq: hadisələr, göndərmə axını, səs və tənzimləmələr. */

import { store } from './store.js';
import { ui, $ } from './ui.js';
import { voice } from './voice.js';
import { PROVIDERS, providerConfig } from './config.js';
import { TOOL_DEFS, executeTool } from './tools.js';
import { buildSystemPrompt, runTurn, localFallback, fetchModels, pickModel } from './llm.js';

let busy = false;
let pendingImage = null;
let abortCtrl = null;

const TOOL_LABELS = {
  get_time: 'vaxt',
  get_weather: 'hava',
  web_search: 'veb axtarış',
  calculate: 'hesablama',
  set_timer: 'taymer',
  remember: 'yaddaş',
  recall_memory: 'yaddaş axtarışı',
  add_note: 'qeyd',
  update_profile: 'profil',
  device_action: 'cihaz əmri'
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function activeProvider() {
  return PROVIDERS[store.state.settings.provider] || PROVIDERS.custom;
}

function needsKey() {
  return activeProvider().needsKey;
}

/* ---------------- ilkin qurulum ---------------- */

function init() {
  ui.boot();
  ui.levelProvider = () => voice.getLevel();

  voice.handlers = {
    language: 'az-AZ',
    onSpeakStart: () => {
      ui.setCoreState('speaking', 'Danışıram…');
      ui.setStatus('Danışıram…');
    },
    onSpeakEnd: () => {
      if (!busy) {
        ui.setCoreState('idle', 'Hazırdır');
        ui.setStatus(modeLabel());
      }
      restartWake();
    },
    onVoices: (voices) => ui.populateVoices(voices, store.state.settings.voiceUri),
    onWakeError: (msg) => ui.toast(msg, 'err')
  };

  voice.initVoices();
  ui.fillProfileFields(store.state.profile);
  ui.renderMemory(store.state);
  ui.setMuteState(!store.state.settings.speak);
  ui.setWakeState(Boolean(store.state.settings.wakeWord));

  restoreTranscript();
  bindEvents();
  ui.setStatus(modeLabel());

  if (!store.state.onboarded) {
    $('#onboarding').hidden = false;
    $('#ob-provider').value = store.state.settings.provider;
    $('#ob-name').value = store.state.profile.name || '';
    updateProviderHints('#ob-provider', '#ob-key', '#ob-hint');
  } else {
    ui.setStatus(modeLabel());
    if (store.state.settings.wakeWord) startWake();
  }

  store.subscribe((type) => {
    if (type === 'change') ui.renderMemory(store.state);
  });

  registerServiceWorker();
  window.addEventListener('jarvis:timer', onTimerComplete);
  showShellInfo();
  exposeApkDownload();
}

function modeLabel() {
  if (needsKey() && !store.state.settings.apiKey) return 'Məhdud rejim — açar yoxdur';
  return 'Onlayn';
}

function restoreTranscript() {
  const messages = store.state.messages.slice(-60);
  if (!messages.length) {
    ui.renderEmptyState();
    return;
  }
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    ui.addMessage({ role: m.role, content: m.content, actions: m.actions || [] });
  }
  ui.scrollToBottom(true);
}

/* ---------------- göndərmə ---------------- */

async function send(text) {
  const content = String(text ?? '').trim();
  if (!content || busy) return;

  busy = true;
  abortCtrl = new AbortController();
  voice.stopSpeaking();

  const settings = store.state.settings;
  const history = store.contextMessages(settings.historyLimit || 24);
  const imageData = pendingImageData;

  ui.addUserMessage(content);
  store.addMessage({ role: 'user', content });

  if (pendingImageData) clearImage();

  ui.showTyping();
  ui.setCoreState('thinking', 'Düşünürəm…');
  ui.setStatus('Düşünürəm…');

  try {
    if (needsKey() && !settings.apiKey) {
      await wait(450);
      const reply = localFallback(content, { settings, profile: store.state.profile });
      deliver(reply, []);
      return;
    }

    const userContent = imageData
      ? [{ type: 'text', text: content }, { type: 'image_url', image_url: { url: imageData } }]
      : content;

    const messages = [
      {
        role: 'system',
        content: buildSystemPrompt({
          profile: store.state.profile,
          facts: store.state.facts,
          notes: store.state.notes,
          settings
        })
      },
      ...history,
      { role: 'user', content: userContent }
    ];

    const result = await runTurn({
      settings,
      messages,
      toolDefs: TOOL_DEFS,
      executeTool,
      signal: abortCtrl.signal,
      onTool: logTool
    }).catch(async (err) => {
      // Model adı köhnəlibsə (404) — provayderdən siyahını çəkib avtomatik yenidən cəhd edirik.
      const recovered = await recoverModel(settings, err);
      if (!recovered) throw err;
      return runTurn({
        settings: store.state.settings,
        messages,
        toolDefs: TOOL_DEFS,
        executeTool,
        signal: abortCtrl.signal,
        onTool: logTool
      });
    });

    deliver(result.text || 'Cavab formalaşmadı.', result.actions || []);
  } catch (err) {
    if (err.name === 'AbortError') return;
    ui.hideTyping();
    ui.addSystemMessage(err.message || 'Gözlənilməz xəta baş verdi.');
    ui.setCoreState('error', 'Xəta');
    ui.setStatus('Xəta');
    setTimeout(() => {
      if (!voice.speaking) {
        ui.setCoreState('idle', 'Hazırdır');
        ui.setStatus(modeLabel());
      }
    }, 2800);
  } finally {
    pendingImageData = null;
    busy = false;
    abortCtrl = null;
  }
}

/* pendingImageData — şəkil birbaşa yaddaşa yazılmır, yalnız bu sorğu üçün istifadə olunur. */
let pendingImageData = null;

function logTool(name, args, output) {
  const detail = args?.city || args?.query || args?.action || args?.text || '';
  const line = `${TOOL_LABELS[name] || name}${detail ? ' · ' + String(detail).slice(0, 60) : ''}${output?.ok === false ? ' · alınmadı' : ''}`;
  ui.addMessage({ role: 'tool', content: line });
}

/** 404 zamanı model siyahısını çəkib ən uyğun modeli təyin edir. */
async function recoverModel(settings, err) {
  const message = String(err?.message || '');
  if (!/404|tapılmadı|not found/i.test(message)) return false;

  try {
    const ids = await fetchModels(store.state.settings);
    const pick = pickModel(ids, store.state.settings.provider);
    if (!pick || pick === store.state.settings.model) return false;

    store.setSettings({ model: pick });
    const input = $('#st-model');
    if (input) input.value = pick;
    ui.addMessage({ role: 'tool', content: `model avtomatik seçildi · ${pick}` });
    ui.toast(`Model dəyişdirildi: ${pick}`);
    return true;
  } catch {
    return false;
  }
}

function deliver(text, actions) {
  ui.hideTyping();
  ui.addJarvisMessage(text, actions);
  store.addMessage({ role: 'assistant', content: text, actions: actions?.length ? actions : null });
  speakReply(text);
}

function speakReply(text) {
  if (!store.state.settings.speak || !voice.supportedTTS) {
    ui.setCoreState('idle', 'Hazırdır');
    ui.setStatus(modeLabel());
    return;
  }
  voice.speak(text, { settings: store.state.settings });
}

/* ---------------- mikrofon və oyanma sözü ---------------- */

function toggleMic() {
  if (voice.listening) {
    voice.stopListening();
    ui.setMicState(false);
    ui.setCoreState('idle', 'Hazırdır');
    return;
  }

  voice.stopSpeaking();
  const started = voice.startListening({
    onInterim: (text) => {
      const input = $('#input');
      input.value = text;
      autoGrow(input);
    },
    onFinal: (text) => {
      ui.setMicState(false);
      $('#input').value = '';
      autoGrow($('#input'));
      ui.setCoreState('idle', 'Hazırdır');
      if (text.trim()) send(text);
    },
    onError: (msg) => ui.toast(msg, 'err'),
    onEnd: () => {
      ui.setMicState(false);
      if (!busy) {
        ui.setCoreState('idle', 'Hazırdır');
        ui.setStatus(modeLabel());
      }
      restartWake();
    }
  });

  if (started) {
    ui.setMicState(true);
    ui.setCoreState('listening', 'Dinləyirəm…');
    ui.setStatus('Dinləyirəm…');
  }
}

function onWake() {
  ui.toast('Buradayam.');
  voice.stopWakeWord();
  setTimeout(() => toggleMic(), 220);
}

function startWake() {
  voice.startWakeWord(onWake);
  ui.setWakeState(true);
  ui.toast('Oyanma sözü aktivdir — “Jarvis” deyin.');
}

function restartWake() {
  if (!store.state.settings.wakeWord) return;
  if (voice.wakeEnabled || busy || voice.listening) return;
  setTimeout(() => {
    if (store.state.settings.wakeWord && !voice.wakeEnabled && !busy && !voice.listening) {
      voice.startWakeWord(onWake);
    }
  }, 900);
}

function toggleWake() {
  const next = !store.state.settings.wakeWord;
  store.setSettings({ wakeWord: next });
  ui.setWakeState(next);
  if (next) startWake();
  else {
    voice.stopWakeWord();
    ui.toast('Oyanma sözü söndürüldü.');
  }
}

/* ---------------- şəkil ---------------- */

function clearImage() {
  pendingImage = null;
  pendingImageData = null;
  $('#attach-preview').hidden = true;
  $('#attach-img').removeAttribute('src');
  $('#file-input').value = '';
}

function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    ui.toast('Yalnız şəkil faylları əlavə olunur.', 'err');
    return;
  }
  if (file.size > 6 * 1024 * 1024) {
    ui.toast('Şəkil çox böyükdür (maksimum 6 MB).', 'err');
    return;
  }

  const provider = activeProvider();
  if (!provider.vision) {
    ui.toast(`${provider.label} şəkil görməyi dəstəkləmir.`, 'err');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    pendingImageData = String(reader.result);
    pendingImage = file;
    $('#attach-img').src = pendingImageData;
    $('#attach-preview').hidden = false;
  };
  reader.readAsDataURL(file);
}

/* ---------------- tənzimləmələr ---------------- */

function updateProviderHints(providerSel, keySel, hintSel) {
  const provider = PROVIDERS[$(providerSel).value] || PROVIDERS.custom;
  const keyInput = $(keySel);
  const hint = $(hintSel);
  if (keyInput) {
    keyInput.placeholder = provider.needsKey ? 'API açarı' : 'Açar lazım deyil';
    keyInput.disabled = !provider.needsKey;
  }
  if (hint) hint.textContent = provider.keyHint;
  const modelInput = $('#st-model');
  if (modelInput && provider.model) modelInput.placeholder = provider.model;
}

function openSettings() {
  ui.openSettings(store.state.settings);
  updateProviderHints('#st-provider', '#st-key', '#st-hint');
}

function saveSettings() {
  store.setSettings({
    provider: $('#st-provider').value,
    apiKey: $('#st-key').value.trim(),
    model: $('#st-model').value.trim(),
    baseUrl: $('#st-base').value.trim(),
    searchKey: $('#st-search').value.trim(),
    speak: $('#st-speak').checked,
    wakeWord: $('#st-wake').checked,
    rate: Number($('#st-rate').value),
    pitch: Number($('#st-pitch').value),
    voiceUri: $('#st-voice').value
  });

  ui.setMuteState(!store.state.settings.speak);
  ui.setWakeState(Boolean(store.state.settings.wakeWord));
  ui.closeSettings();
  ui.setStatus(modeLabel());
  ui.toast('Tənzimləmələr yadda saxlanıldı.');

  if (!store.state.settings.wakeWord) voice.stopWakeWord();
  else startWake();
}

function saveProfile() {
  store.setProfile({
    name: $('#pf-name').value.trim(),
    city: $('#pf-city').value.trim(),
    interests: $('#pf-interests').value.split(',').map((s) => s.trim()).filter(Boolean),
    about: $('#pf-about').value.trim()
  });
  ui.fillProfileFields(store.state.profile);
  ui.toast('Profil yeniləndi.');
}

/* ---------------- məlumat ---------------- */

function exportData() {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jarvis-yaddas-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  ui.toast('Yaddaş fayla yazıldı.');
}

function onTimerComplete(event) {
  const label = event.detail?.label || 'Taymer';
  const message = `${label} bitdi.`;
  ui.addJarvisMessage(`⏱ ${message}`);
  store.addMessage({ role: 'assistant', content: message });
  speakReply(message);
}

/* ---------------- hadisələr ---------------- */

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 132) + 'px';
}

function bindEvents() {
  const input = $('#input');
  input.addEventListener('input', () => autoGrow(input));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = input.value;
      input.value = '';
      autoGrow(input);
      send(text);
    }
  });

  $('#btn-send').addEventListener('click', () => {
    const text = input.value;
    input.value = '';
    autoGrow(input);
    send(text);
  });

  $('#btn-mic').addEventListener('click', toggleMic);
  $('#btn-wake').addEventListener('click', toggleWake);
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-mute').addEventListener('click', () => {
    const speak = !store.state.settings.speak;
    store.setSettings({ speak });
    ui.setMuteState(!speak);
    if (!speak) voice.stopSpeaking();
    ui.toast(speak ? 'Səsli cavab aktivdir.' : 'Səsli cavab söndürüldü.');
  });

  $('#btn-menu').addEventListener('click', () => {
    ui.fillProfileFields(store.state.profile);
    ui.renderMemory(store.state);
    ui.openDrawer();
  });
  $('#btn-drawer-close').addEventListener('click', () => ui.closeDrawer());
  $('#scrim').addEventListener('click', () => ui.closeDrawer());

  $('#btn-attach').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', (e) => handleFile(e.target.files?.[0]));
  $('#btn-attach-clear').addEventListener('click', clearImage);

  $('#settings-close').addEventListener('click', () => ui.closeSettings());
  $('#settings-cancel').addEventListener('click', () => ui.closeSettings());
  $('#settings-save').addEventListener('click', saveSettings);
  $('#st-provider').addEventListener('change', () => updateProviderHints('#st-provider', '#st-key', '#st-hint'));

  $('#st-model-fetch').addEventListener('click', async () => {
    const btn = $('#st-model-fetch');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '…';
    try {
      const ids = await fetchModels({
        ...store.state.settings,
        provider: $('#st-provider').value,
        apiKey: $('#st-key').value.trim(),
        baseUrl: $('#st-base').value.trim()
      });
      const list = $('#model-options');
      list.innerHTML = ids.slice(0, 300).map((id) => `<option value="${id}"></option>`).join('');
      if (!ids.length) {
        ui.toast('Model siyahısı boşdur.', 'err');
      } else {
        if (!$('#st-model').value.trim()) {
          $('#st-model').value = pickModel(ids, $('#st-provider').value);
        }
        ui.toast(`${ids.length} model tapıldı — siyahıdan seçin.`);
      }
    } catch (err) {
      ui.toast(err.message || 'Modellər alınmadı.', 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
  $('#st-rate').addEventListener('input', (e) => { $('#rate-val').textContent = Number(e.target.value).toFixed(2); });
  $('#st-pitch').addEventListener('input', (e) => { $('#pitch-val').textContent = Number(e.target.value).toFixed(2); });

  $('#pf-save').addEventListener('click', saveProfile);
  $('#fact-add').addEventListener('click', () => {
    const el = $('#fact-input');
    if (store.addFact(el.value)) {
      el.value = '';
      ui.toast('Xatirə yadda saxlanıldı.');
    }
  });
  $('#fact-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#fact-add').click();
  });

  $('#facts-list').addEventListener('click', (e) => {
    const id = e.target?.dataset?.fact;
    if (id) store.removeFact(id);
  });
  $('#notes-list').addEventListener('click', (e) => {
    const id = e.target?.dataset?.note;
    if (id) store.removeNote(id);
  });

  $('#data-export').addEventListener('click', exportData);
  $('#data-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      store.importJSON(await file.text());
      ui.renderMemory(store.state);
      ui.fillProfileFields(store.state.profile);
      ui.toast('Məlumatlar yükləndi.');
    } catch (err) {
      ui.toast(err.message || 'İmport alınmadı.', 'err');
    }
    e.target.value = '';
  });
  $('#data-clear').addEventListener('click', () => {
    if (!confirm('Bütün söhbət tarixçəsi silinsin? Xatirələr və qeydlər qalacaq.')) return;
    store.clearConversation();
    ui.clearTranscript();
    ui.renderEmptyState();
    ui.toast('Söhbət təmizləndi.');
  });

  // İlk quraşdırma
  $('#ob-provider').addEventListener('change', () => updateProviderHints('#ob-provider', '#ob-key', '#ob-hint'));
  updateProviderHints('#ob-provider', '#ob-key', '#ob-hint');

  $('#ob-start').addEventListener('click', () => {
    const provider = $('#ob-provider').value;
    const key = $('#ob-key').value.trim();
    const name = $('#ob-name').value.trim();

    if (provider === 'gemini' && !key) {
      ui.toast('Gemini üçün API açarı lazımdır (pulsuzdur).', 'err');
      return;
    }
    if (PROVIDERS[provider]?.needsKey && !key) {
      ui.toast('Bu provayder üçün API açarı lazımdır.', 'err');
      return;
    }

    store.setSettings({ provider, apiKey: key, model: '' });
    if (name) store.setProfile({ name });
    store.state.onboarded = true;
    store.save();

    $('#onboarding').hidden = true;
    ui.setStatus(modeLabel());
    ui.addJarvisMessage(
      `Sistem hazırdır${name ? ', ' + name : ''}. Mən JARVIS-əm — sizi dinləyir, yadda saxlayır və işinizi asanlaşdırıram.\n\nDanışmaq üçün mikrofonu basın və ya yazın. İlk addım kimi mənə özünüz haqqında bir-iki cümlə deyə bilərsiniz.`
    );
  });

  $('#ob-skip').addEventListener('click', () => {
    store.state.onboarded = true;
    store.save();
    $('#onboarding').hidden = true;
    ui.setStatus(modeLabel());
    ui.toast('Məhdud rejim: açar olmadan yalnız vaxt və cihaz əmrləri işləyir.');
  });

  // Escape — açıq panelləri bağla
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#settings-modal').hidden) ui.closeSettings();
    else if ($('#drawer').classList.contains('open')) ui.closeDrawer();
    else if (voice.speaking) voice.stopSpeaking();
  });
}

/* ---------------- service worker ---------------- */

/** Yalnız inkişaf/preview mühitində APK yükləmə düyməsini göstərir. */
function exposeApkDownload() {
  const link = $('#apk-download');
  if (!link) return;
  const host = location.hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || /\.style\.dev$/.test(host);
  if (local) link.hidden = false;
}

function showShellInfo() {
  const bridge = window.JarvisNative;
  if (!bridge?.deviceInfo) return;
  try {
    const info = JSON.parse(bridge.deviceInfo());
    const el = $('#app-version');
    if (el) el.textContent = `APK ${info.version || ''} · ${info.model || ''} · Android ${info.sdk || ''}`.trim();
  } catch {
    /* məlumat alınmadı */
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // APK qabığında fayllar artıq cihazdadır — service worker lazım deyil.
  if (window.JarvisNative) return;
  if (location.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  navigator.serviceWorker.register('sw.js').catch(() => {
    /* oflayn keş mümkün deyil — tətbiq yenə işləyir */
  });
}

/* ---------------- start ---------------- */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
