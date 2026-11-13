/* İnterfeys: mesajlar, vizualizator, panel, tənzimləmələr. */

import { CAPABILITIES, PROVIDERS, QUICK_ACTIONS } from './config.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

/* ---------------- markdown (yüngül) ---------------- */

export function renderMarkdown(src) {
  const raw = String(src ?? '');
  const blocks = [];

  let text = raw.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    blocks.push(`<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`);
    return `\u0000B${blocks.length - 1}\u0000`;
  });

  text = esc(text);
  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  text = text.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');

  // Siyahıları qruplaşdır (pre-wrap ilə uyğun olsun deyə sətir sonlarını saxlayırıq).
  const lines = text.split('\n');
  const out = [];
  let listType = null;
  for (const line of lines) {
    const ul = /^\s*[-•*]\s+(.+)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (ul || ol) {
      const wanted = ul ? 'ul' : 'ol';
      if (listType !== wanted) {
        if (listType) out.push(`</${listType}>`);
        out.push(`<${wanted}>`);
        listType = wanted;
      }
      out.push(`<li>${(ul || ol)[1]}</li>`);
    } else {
      if (listType) { out.push(`</${listType}>`); listType = null; }
      out.push(line);
    }
  }
  if (listType) out.push(`</${listType}>`);

  let html = out.join('\n').replace(/\u0000B(\d+)\u0000/g, (_m, i) => blocks[Number(i)]);
  return html;
}

/* ---------------- vizualizator ---------------- */

class Visualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = 'idle';
    this.t = 0;
    this.levelFn = () => 0;
    this.running = false;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.max(rect.width, 240);
    this.canvas.width = size * this.dpr;
    this.canvas.height = size * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.size = size;
  }

  setState(state) { this.state = state; }

  start() {
    if (this.running) return;
    this.running = true;
    const draw = () => {
      if (!this.running) return;
      this.t += 0.016;
      this.render();
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  render() {
    const ctx = this.ctx;
    const size = this.size;
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2;
    const cy = size / 2;
    const base = size * 0.22;
    const level = this.levelFn();

    const color = this.state === 'thinking' ? '255,181,71' : '56,232,255';
    const segments = this.state === 'idle' ? 44 : 64;
    const amp = this.state === 'listening'
      ? base * (0.14 + level * 0.5)
      : this.state === 'speaking'
        ? base * 0.2
        : base * 0.035;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.state === 'idle' ? this.t * 0.08 : this.t * (this.state === 'thinking' ? 0.35 : 0.18));
    ctx.lineCap = 'round';

    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const wobble =
        Math.sin(angle * 3 + this.t * 2.1) * 0.5 +
        Math.sin(angle * 5 - this.t * 1.4) * 0.3 +
        Math.sin(angle * 9 + this.t * 3.3) * 0.2;
      const len = amp * (0.55 + Math.abs(wobble)) + 2;
      const r1 = base + 12;
      const r2 = r1 + len;
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${color},${0.14 + Math.abs(wobble) * 0.5})`;
      ctx.lineWidth = 1.7;
      ctx.moveTo(Math.cos(angle) * r1, Math.sin(angle) * r1);
      ctx.lineTo(Math.cos(angle) * r2, Math.sin(angle) * r2);
      ctx.stroke();
    }
    ctx.restore();

    // üfüqi skan xətti
    const scanY = cy + Math.sin(this.t * 0.6) * base * 1.4;
    const grad = ctx.createLinearGradient(cx - base * 1.6, 0, cx + base * 1.6, 0);
    grad.addColorStop(0, `rgba(${color},0)`);
    grad.addColorStop(0.5, `rgba(${color},0.22)`);
    grad.addColorStop(1, `rgba(${color},0)`);
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx - base * 1.6, scanY);
    ctx.lineTo(cx + base * 1.6, scanY);
    ctx.stroke();
  }
}

/* ---------------- əsas UI ---------------- */

class UI {
  constructor() {
    this.transcript = $('#transcript');
    this.core = $('#core');
    this.quick = $('#quick');
    this.toastWrap = $('#toast-wrap');
    this.typingEl = null;
    this.viz = new Visualizer($('#viz'));
    this.viz.levelFn = () => this.levelProvider?.() ?? 0;
  }

  boot() {
    this.viz.start();
    this.renderQuickActions();
    this.renderCapabilities();
    this.populateProviders();
  }

  /* ---- status / core ---- */
  setStatus(text) {
    const el = $('#status-text');
    if (el) el.textContent = text;
  }

  setCoreState(state, caption) {
    this.core.dataset.state = state;
    this.viz.setState(state);
    if (caption !== undefined) $('#core-caption').textContent = caption;
  }

  /* ---- mesajlar ---- */
  clearTranscript() {
    this.transcript.innerHTML = '';
  }

  renderEmptyState() {
    this.transcript.innerHTML = `
      <div class="empty-state">
        <strong>JARVIS hazırdır.</strong><br />
        Danışmaq üçün mikrofonu basın, yazın və ya aşağıdakı əmrlərdən birini seçin.<br />
        Sizi tanıyır, yadda saxlayır və cihazınızı idarə edir.
      </div>`;
  }

  addMessage({ role, content, actions = [], interim = false }) {
    const wrap = document.createElement('div');
    wrap.className = `msg ${role === 'assistant' ? 'jarvis' : role}`;
    if (interim) wrap.dataset.interim = '1';

    const head = document.createElement('div');
    head.className = 'msg-head';
    const label = role === 'user' ? 'Siz' : role === 'assistant' ? 'JARVIS' : role === 'tool' ? 'Alət' : 'Sistem';
    head.innerHTML = `<span class="msg-dot"></span><span>${label}</span>`;

    const body = document.createElement('div');
    body.className = 'msg-body';
    if (role === 'user') {
      body.textContent = content;
    } else {
      body.innerHTML = renderMarkdown(content);
    }

    wrap.append(head, body);

    if (actions?.length) {
      const bar = document.createElement('div');
      bar.className = 'msg-actions';
      for (const action of actions) {
        if (!action?.href) continue;
        const a = document.createElement('a');
        a.className = 'action-btn';
        a.href = action.href;
        a.textContent = action.label || 'Aç';
        if (/^https?:/i.test(action.href)) {
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        }
        bar.appendChild(a);
      }
      if (bar.children.length) wrap.appendChild(bar);
    }

    this.transcript.appendChild(wrap);
    this.scrollToBottom();
    return wrap;
  }

  addUserMessage(text) {
    this.clearEmptyState();
    return this.addMessage({ role: 'user', content: text });
  }

  addJarvisMessage(text, actions) {
    this.clearEmptyState();
    return this.addMessage({ role: 'assistant', content: text, actions });
  }

  addSystemMessage(text) {
    this.clearEmptyState();
    return this.addMessage({ role: 'system', content: text });
  }

  clearEmptyState() {
    const empty = this.transcript.querySelector('.empty-state');
    if (empty) empty.remove();
  }

  showTyping() {
    if (this.typingEl) return;
    const wrap = document.createElement('div');
    wrap.className = 'msg jarvis';
    wrap.innerHTML = `
      <div class="msg-head"><span class="msg-dot"></span><span>JARVIS</span></div>
      <div class="msg-body"><span class="typing"><i></i><i></i><i></i></span></div>`;
    this.typingEl = wrap;
    this.transcript.appendChild(wrap);
    this.scrollToBottom();
  }

  hideTyping() {
    this.typingEl?.remove();
    this.typingEl = null;
  }

  showInterim(text) {
    if (!this.interimEl) {
      this.interimEl = this.addMessage({ role: 'user', content: text, interim: true });
    } else {
      this.interimEl.querySelector('.msg-body').textContent = text;
    }
    this.scrollToBottom();
  }

  clearInterim() {
    this.interimEl?.remove();
    this.interimEl = null;
  }

  scrollToBottom(force = false) {
    const el = this.transcript;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 180;
    if (force || nearBottom) {
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }
  }

  /* ---- qısa əmrlər ---- */
  renderQuickActions() {
    this.quick.innerHTML = '';
    for (const text of QUICK_ACTIONS) {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.type = 'button';
      chip.textContent = text;
      chip.addEventListener('click', () => this.onQuickAction?.(text));
      this.quick.appendChild(chip);
    }
  }

  /* ---- cihaz imkanları ---- */
  renderCapabilities() {
    const list = $('#cap-list');
    if (!list) return;
    const supports = {
      speech: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
      tts: 'speechSynthesis' in window,
      torch: Boolean(navigator.mediaDevices?.getUserMedia),
      bluetooth: Boolean(navigator.bluetooth),
      share: Boolean(navigator.share),
      notify: 'Notification' in window,
      geolocation: Boolean(navigator.geolocation),
      battery: Boolean(navigator.getBattery),
      clipboard: Boolean(navigator.clipboard)
    };
    list.innerHTML = '';
    for (const cap of CAPABILITIES) {
      const li = document.createElement('li');
      const good = Boolean(supports[cap.key]);
      li.innerHTML = `<span>${cap.label}</span><span class="${good ? 'cap-yes' : 'cap-no'}">${good ? 'mövcud' : 'yoxdur'}</span>`;
      list.appendChild(li);
    }
  }

  /* ---- toast ---- */
  toast(text, type = '') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = text;
    this.toastWrap.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s ease';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 320);
    }, 3600);
  }

  /* ---- provayder seçimləri ---- */
  populateProviders() {
    // Yalnız Gemini göstərilir — digər provayderlər ehtiyat (fallback) olaraq kodda qalır.
    const options = Object.entries(PROVIDERS)
      .filter(([id]) => id === 'gemini')
      .map(([id, p]) => `<option value="${id}">${p.label}</option>`)
      .join('');
    for (const id of ['#st-provider', '#ob-provider']) {
      const el = $(id);
      if (el) el.innerHTML = options;
    }
  }

  /* ---- səs seçimləri ---- */
  populateVoices(voices, selected) {
    const sel = $('#st-voice');
    if (!sel) return;
    const az = voices.filter((v) => /^az/i.test(v.lang));
    const tr = voices.filter((v) => /^tr/i.test(v.lang));
    const rest = voices.filter((v) => !/^az|^tr/i.test(v.lang));

    const group = (label, arr) => {
      if (!arr.length) return '';
      return `<optgroup label="${label}">${arr
        .map((v) => `<option value="${v.voiceURI}">${esc(v.name)} (${v.lang})</option>`)
        .join('')}</optgroup>`;
    };

    sel.innerHTML =
      `<option value="">Avtomatik (Azərbaycan → Türk → digər)</option>` +
      group('Azərbaycan', az) +
      group('Türk', tr) +
      group('Digər', rest);
    sel.value = selected || '';
    this.voices = voices;
  }

  /* ---- yaddaş paneli ---- */
  renderMemory(state) {
    const factsList = $('#facts-list');
    const notesList = $('#notes-list');
    if (!factsList || !notesList) return;

    $('#facts-count').textContent = String(state.facts.length);
    factsList.innerHTML = state.facts.length
      ? state.facts.map((f) => `
        <li><span>${esc(f.text)}</span><button data-fact="${f.id}" aria-label="Sil">×</button></li>`).join('')
      : '<li class="mem-empty">Hələ xatirə yoxdur. JARVIS söhbət zamanı özü yadda saxlayacaq.</li>';

    notesList.innerHTML = state.notes.length
      ? state.notes.map((n) => `
        <li><span>${esc(n.text)}</span><button data-note="${n.id}" aria-label="Sil">×</button></li>`).join('')
      : '<li class="mem-empty">Qeyd yoxdur.</li>';
  }

  fillProfileFields(profile) {
    const map = { '#pf-name': profile.name, '#pf-city': profile.city, '#pf-about': profile.about };
    for (const [sel, val] of Object.entries(map)) {
      const el = $(sel);
      if (el) el.value = val || '';
    }
    const interests = $('#pf-interests');
    if (interests) interests.value = (profile.interests || []).join(', ');
  }

  /* ---- tənzimləmələr ---- */
  openSettings(settings) {
    $('#st-provider').value = settings.provider;
    $('#st-key').value = settings.apiKey || '';
    $('#st-model').value = settings.model || '';
    $('#st-base').value = settings.baseUrl || '';
    $('#st-search').value = settings.searchKey || '';
    $('#st-speak').checked = Boolean(settings.speak);
    $('#st-wake').checked = Boolean(settings.wakeWord);
    $('#st-rate').value = settings.rate;
    $('#pitch-val').textContent = Number(settings.pitch).toFixed(2);
    $('#rate-val').textContent = Number(settings.rate).toFixed(2);
    $('#st-pitch').value = settings.pitch;
    $('#st-voice').value = settings.voiceUri || '';
    $('#settings-modal').hidden = false;
  }

  closeSettings() { $('#settings-modal').hidden = true; }

  setMicState(listening) {
    $('#btn-mic').classList.toggle('listening', listening);
  }

  setWakeState(enabled) {
    $('#btn-wake').classList.toggle('active', enabled);
  }

  setMuteState(muted) {
    $('#btn-mute').classList.toggle('muted', muted);
  }

  openDrawer() {
    $('#scrim').hidden = false;
    $('#drawer').classList.add('open');
    $('#drawer').setAttribute('aria-hidden', 'false');
  }

  closeDrawer() {
    $('#scrim').hidden = true;
    $('#drawer').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
  }
}

export const ui = new UI();
