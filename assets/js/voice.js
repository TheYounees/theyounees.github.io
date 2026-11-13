/* Səs: nitqin tanınması, "Jarvis" oyanma sözü, nitq sintezi və mikrofon səviyyəsi.
   Brauzerde Web Speech API, APK-da isə native körpü (window.JarvisNative) istifadə olunur. */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

function getBridge() {
  try {
    const bridge = window.JarvisNative;
    if (bridge && typeof bridge.available === 'function' && bridge.available()) return bridge;
  } catch {
    /* körpü yoxdur */
  }
  return null;
}

export function hasNativeShell() {
  return Boolean(getBridge());
}

function cleanForSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' kod bloku ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_#>|]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'keçid')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function voiceScore(v) {
  let score = 0;
  const name = String(v.name || '').toLowerCase();
  if (/natural|premium|neural|wavenet|studio/i.test(name)) score += 8;
  if (/google|microsoft|apple/i.test(name)) score += 4;
  if (/^az/i.test(v.lang)) score += 6;
  else if (/^tr/i.test(v.lang)) score += 5;
  else if (/^ru|^en/i.test(v.lang)) score += 2;
  if (/compact|basic/i.test(name)) score -= 3;
  return score;
}

function pickVoice(voices, preferredUri) {
  if (!voices.length) return null;
  if (preferredUri) {
    const exact = voices.find((v) => v.voiceURI === preferredUri);
    if (exact) return exact;
  }
  const az = voices.filter((v) => /^az/i.test(v.lang));
  if (az.length) return az.sort((a, b) => voiceScore(b) - voiceScore(a))[0];
  const tr = voices.filter((v) => /^tr/i.test(v.lang));
  if (tr.length) return tr.sort((a, b) => voiceScore(b) - voiceScore(a))[0];
  const others = voices.slice().sort((a, b) => voiceScore(b) - voiceScore(a));
  return others[0] || voices[0];
}

class Voice {
  constructor() {
    this.native = getBridge();
    this.voices = [];
    this.speaking = false;
    this.listening = false;
    this.recognition = null;
    this.wakeRecognition = null;
    this.wakeEnabled = false;
    this.wakeHandler = null;
    this.analyser = null;
    this.audioCtx = null;
    this.micStream = null;
    this.level = 0;
    this._meterRaf = null;
    this._speechToken = 0;
    this._nativeSpeakDone = null;
    this.sttHandlers = null;
    this.handlers = {};

    // Native tərəfdən gələn hadisələri qəbul edirik.
    window.__jarvisNative = {
      onStart: () => {},
      onLevel: (rms) => {
        const value = Number.parseFloat(rms);
        if (Number.isFinite(value)) this.level = Math.max(0, Math.min(1, (value + 2) / 12));
      },
      onInterim: (text) => this.sttHandlers?.onInterim?.(text),
      onFinal: (text) => this.sttHandlers?.onFinal?.(text || ''),
      onError: (message) => {
        this.listening = false;
        this.sttHandlers?.onError?.(message || 'Nitq xətası.');
        this.sttHandlers?.onEnd?.(false);
      },
      onEnd: () => {
        this.listening = false;
        this.sttHandlers?.onEnd?.(true);
      },
      onSpeakEnd: () => {
        const done = this._nativeSpeakDone;
        this._nativeSpeakDone = null;
        done?.();
      },
      onWake: () => {
        this.wakeEnabled = false;
        const cb = this.wakeHandler;
        this.wakeHandler = null;
        cb?.();
      }
    };
  }

  /* ---------- nitq sintezi ---------- */
  initVoices() {
    if (!('speechSynthesis' in window)) return;
    const load = () => {
      this.voices = window.speechSynthesis.getVoices() || [];
      this.handlers.onVoices?.(this.voices);
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    setTimeout(load, 700);
  }

  get supportedTTS() {
    return Boolean(this.native) || 'speechSynthesis' in window;
  }

  get supportedSTT() {
    return Boolean(this.native) || Boolean(SR);
  }

  /** Mətni səsləndirir. */
  speak(text, opts = {}) {
    if (!text) return Promise.resolve();
    const clean = cleanForSpeech(text);
    if (!clean) return Promise.resolve();
    const settings = opts.settings || {};

    if (this.native) {
      this.stopSpeaking();
      const token = ++this._speechToken;
      this.speaking = true;
      this.handlers.onSpeakStart?.();

      return new Promise((resolve) => {
        let settled = false;
        this._nativeSpeakDone = () => {
          if (settled) return;
          settled = true;
          if (token === this._speechToken) {
            this.speaking = false;
            this.handlers.onSpeakEnd?.();
          }
          resolve();
        };
        try {
          this.native.speak(clean, Number(settings.rate ?? 1), Number(settings.pitch ?? 0.92));
        } catch {
          this._nativeSpeakDone();
        }
        // Native cavab gəlməzsə vəziyyəti sıfırlayırıq (təhlükəsizlik).
        setTimeout(() => {
          if (!settled && this.speaking && token === this._speechToken) {
            this.speaking = false;
            this.handlers.onSpeakEnd?.();
          }
        }, Math.min(90000, 5000 + clean.length * 110));
      });
    }

    if (!this.supportedTTS) return Promise.resolve();

    this.stopSpeaking();
    const token = ++this._speechToken;
    this.speaking = true;
    this.handlers.onSpeakStart?.();

    const chunks = [];
    const parts = clean.match(/[^.!?…]+[.!?…]?/g) || [clean];
    let buffer = '';
    for (const part of parts) {
      if ((buffer + part).length > 220) {
        if (buffer) chunks.push(buffer.trim());
        buffer = part;
      } else {
        buffer += part;
      }
    }
    if (buffer.trim()) chunks.push(buffer.trim());

    const voice = pickVoice(this.voices, settings.voiceUri);

    return new Promise((resolve) => {
      let index = 0;
      const speakNext = () => {
        if (token !== this._speechToken) return resolve();
        if (index >= chunks.length) {
          this.speaking = false;
          this.handlers.onSpeakEnd?.();
          return resolve();
        }
        const u = new SpeechSynthesisUtterance(chunks[index++]);
        if (voice) u.voice = voice;
        u.lang = voice?.lang || 'az-AZ';
        u.rate = Number(settings.rate ?? 1);
        u.pitch = Number(settings.pitch ?? 0.92);
        u.volume = 1;
        u.onend = speakNext;
        u.onerror = () => {
          if (token === this._speechToken) {
            this.speaking = false;
            this.handlers.onSpeakEnd?.();
          }
          resolve();
        };
        try {
          window.speechSynthesis.speak(u);
        } catch {
          speakNext();
        }
      };
      speakNext();
    });
  }

  stopSpeaking() {
    try {
      if (this.native) this.native.stopSpeaking();
    } catch {
      /* körpü xətası */
    }
    this._nativeSpeakDone = null;
    if (!('speechSynthesis' in window)) {
      if (this.speaking) {
        this.speaking = false;
        this.handlers.onSpeakEnd?.();
      }
      return;
    }
    this._speechToken++;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* yoxdur */
    }
    if (this.speaking) {
      this.speaking = false;
      this.handlers.onSpeakEnd?.();
    }
  }

  /* ---------- nitqin tanınması ---------- */
  buildRecognition({ continuous = false, interim = true } = {}) {
    const rec = new SR();
    rec.lang = this.handlers.language || 'az-AZ';
    rec.continuous = continuous;
    rec.interimResults = interim;
    rec.maxAlternatives = 1;
    return rec;
  }

  startListening(handlers = {}) {
    this.stopSpeaking();
    this.stopListening();
    this.sttHandlers = handlers;

    if (this.native) {
      this.listening = true;
      try {
        this.native.startListening();
        return true;
      } catch {
        this.listening = false;
        handlers.onError?.('Mikrofonu işə salmaq alınmadı.');
        return false;
      }
    }

    if (!this.supportedSTT) {
      handlers.onError?.('Bu brauzer nitqin tanınmasını dəstəkləmir. Chrome və ya Edge istifadə edin.');
      return false;
    }

    const rec = this.buildRecognition({ continuous: false, interim: true });
    this.recognition = rec;
    this.listening = true;
    let finalText = '';
    let gotResult = false;

    rec.onresult = (event) => {
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript + ' ';
          gotResult = true;
        } else {
          interimText += result[0].transcript;
        }
      }
      if (interimText) handlers.onInterim?.(interimText);
      if (finalText.trim()) handlers.onFinal?.(finalText.trim());
    };

    rec.onerror = (event) => {
      this.listening = false;
      const map = {
        'not-allowed': 'Mikrofona icazə verilmədi. Brauzer ayarlarından icazə verin.',
        'service-not-allowed': 'Nitq xidməti əlçatan deyil (HTTPS və ya icazə tələb olunur).',
        'no-speech': 'Səs eşitmədim.',
        'audio-capture': 'Mikrofon tapılmadı.',
        'network': 'Nitq xidməti üçün internet lazımdır.',
        'language-not-supported': 'Bu dildə nitq tanınması dəstəklənmir. Zəhmət olmasa yazın.',
        'aborted': ''
      };
      const msg = map[event.error] ?? `Nitq xətası: ${event.error}`;
      if (msg) handlers.onError?.(msg);
      handlers.onEnd?.(gotResult);
    };

    rec.onend = () => {
      this.listening = false;
      handlers.onEnd?.(gotResult);
    };

    try {
      rec.start();
      this.startMeter();
      return true;
    } catch {
      this.listening = false;
      handlers.onError?.('Mikrofonu işə salmaq alınmadı.');
      return false;
    }
  }

  stopListening() {
    if (this.native) {
      try {
        this.native.stopListening();
      } catch {
        /* körpü xətası */
      }
    }
    if (this.recognition) {
      try {
        this.recognition.onend = null;
        this.recognition.stop();
      } catch {
        /* yoxdur */
      }
      this.recognition = null;
    }
    this.listening = false;
    this.sttHandlers = null;
    this.stopMeter();
  }

  /* ---------- oyanma sözü ---------- */
  startWakeWord(onWake) {
    if (this.wakeEnabled) return;
    if (this.native) {
      this.wakeEnabled = true;
      this.wakeHandler = onWake;
      try {
        this.native.startWakeWord();
      } catch {
        this.wakeEnabled = false;
        this.handlers.onWakeError?.('Oyanma sözü işə düşmədi.');
      }
      return;
    }
    if (!this.supportedSTT) {
      this.handlers.onWakeError?.('Bu brauzer oyanma sözünü dəstəkləmir.');
      return;
    }

    this.wakeEnabled = true;
    this.wakeHandler = onWake;

    const loop = () => {
      if (!this.wakeEnabled) return;
      const rec = this.buildRecognition({ continuous: true, interim: true });
      this.wakeRecognition = rec;
      let fired = false;

      rec.onresult = (event) => {
        const text = Array.from(event.results)
          .map((r) => r[0].transcript)
          .join(' ')
          .toLowerCase();
        if (!fired && /\b(carvis|jarvis|jarviz|çarvis)\b/.test(text)) {
          fired = true;
          try {
            rec.stop();
          } catch {
            /* yoxdur */
          }
          this.wakeEnabled = false;
          onWake();
        }
      };
      rec.onerror = (event) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          this.wakeEnabled = false;
          this.handlers.onWakeError?.('Oyanma sözü üçün mikrofon icazəsi lazımdır.');
        }
      };
      rec.onend = () => {
        if (this.wakeEnabled) setTimeout(loop, 500);
      };
      try {
        rec.start();
      } catch {
        setTimeout(loop, 1500);
      }
    };
    loop();
  }

  stopWakeWord() {
    this.wakeEnabled = false;
    this.wakeHandler = null;
    if (this.native) {
      try {
        this.native.stopWakeWord();
      } catch {
        /* körpü xətası */
      }
      return;
    }
    if (this.wakeRecognition) {
      try {
        this.wakeRecognition.onend = null;
        this.wakeRecognition.abort();
      } catch {
        /* yoxdur */
      }
      this.wakeRecognition = null;
    }
  }

  /* ---------- mikrofon səviyyəsi (vizualizasiya üçün) ---------- */
  async startMeter() {
    if (this.native) return; // native rejimdə səviyyə körpüdən gəlir
    if (!navigator.mediaDevices?.getUserMedia || this.audioCtx) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.micStream = stream;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new Ctx();
      const source = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      source.connect(this.analyser);

      const data = new Uint8Array(this.analyser.frequencyBinCount);
      const tick = () => {
        if (!this.analyser) return;
        this.analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length / 255;
        this.level = this.level * 0.7 + avg * 0.3;
        this._meterRaf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* icazə yoxdur — sükutla davam */
    }
  }

  stopMeter() {
    if (this._meterRaf) cancelAnimationFrame(this._meterRaf);
    this._meterRaf = null;
    this.level = 0;
    this.analyser = null;
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.audioCtx) {
      try {
        this.audioCtx.close();
      } catch {
        /* yoxdur */
      }
      this.audioCtx = null;
    }
  }

  getLevel() {
    return Math.min(1, this.level * 2.4);
  }
}

export const voice = new Voice();
