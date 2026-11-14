/* Yaddaş qatı: profil, xatirələr, qeydlər və ayrı-ayrı söhbətlər.
   Hər şey bu brauzerin localStorage-ında saxlanılır; Google Drive qoşulubsa
   əlavə olaraq orada avtomatik ehtiyat nüsxəsi yaradılır. */

import { DEFAULT_SETTINGS } from './config.js';

const STORAGE_KEY = 'jarvis.state.v2';
const MAX_MESSAGES = 400;
const DEFAULT_TITLE = 'Yeni söhbət';

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function defaultState() {
  return {
    version: 2,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    onboarded: false,
    profile: { name: '', city: 'Bakı', interests: [], about: '' },
    settings: { ...DEFAULT_SETTINGS },
    facts: [],
    notes: [],
    chats: [],
    activeChatId: null
  };
}

function safeParse(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

class Store {
  constructor() {
    this.state = defaultState();
    this.listeners = new Set();
    this.load();
  }

  load() {
    const saved = safeParse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return;
    this.state = this.normalize(saved);
  }

  normalize(saved) {
    const base = defaultState();
    const state = {
      ...base,
      ...saved,
      updatedAt: Number(saved.updatedAt || saved.createdAt || base.updatedAt),
      profile: { ...base.profile, ...(saved.profile || {}) },
      settings: { ...base.settings, ...(saved.settings || {}) },
      facts: Array.isArray(saved.facts) ? saved.facts : [],
      notes: Array.isArray(saved.notes) ? saved.notes : [],
      chats: Array.isArray(saved.chats) ? saved.chats : []
    };

    // Köhnə versiyada tək `messages` massivi var idi — onu bir söhbətə köçürürük.
    if (!state.chats.length && Array.isArray(saved.messages) && saved.messages.length) {
      state.chats = [{
        id: uid(),
        title: this.titleFor(saved.messages),
        messages: saved.messages,
        createdAt: Number(saved.createdAt || Date.now()),
        updatedAt: Number(saved.updatedAt || Date.now())
      }];
      state.activeChatId = state.chats[0].id;
    }

    state.chats = state.chats
      .filter((c) => c && typeof c === 'object')
      .map((c) => ({
        id: c.id || uid(),
        title: c.title || DEFAULT_TITLE,
        messages: Array.isArray(c.messages) ? c.messages : [],
        createdAt: Number(c.createdAt || Date.now()),
        updatedAt: Number(c.updatedAt || c.createdAt || Date.now())
      }));

    // Problemli model adlarını uyğun olanla əvəz edirik (413/TPM limiti).
    if (state.settings.provider === 'groq' && /gpt-oss-120b/i.test(String(state.settings.model || ''))) {
      state.settings.model = 'llama-3.3-70b-versatile';
    }

    if (!state.chats.length) {
      const chat = { id: uid(), title: DEFAULT_TITLE, messages: [], createdAt: Date.now(), updatedAt: Date.now() };
      state.chats = [chat];
      state.activeChatId = chat.id;
    }
    if (!state.chats.some((c) => c.id === state.activeChatId)) {
      state.activeChatId = state.chats[0].id;
    }
    return state;
  }

  save() {
    this.state.updatedAt = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (err) {
      console.warn('Yaddaş diskə yazıla bilmədi', err);
      this.emit('storage-error', err);
    }
    this.emit('change');
  }

  /* Google Drive-dan gələn vəziyyəti əvəz edir (sinxronizasiya üçün). */
  replaceState(saved) {
    if (!saved || typeof saved !== 'object') return false;
    this.state = this.normalize(saved);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch { /* yoxdur */ }
    this.emit('change');
    return true;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, detail) {
    this.listeners.forEach((fn) => fn(type, detail));
  }

  titleFor(messages) {
    const first = (messages || []).find((m) => m && m.role === 'user' && m.content);
    return first ? String(first.content).slice(0, 48) : DEFAULT_TITLE;
  }

  /* ---------- söhbətlər ---------- */
  createChat(title) {
    const chat = {
      id: uid(),
      title: title || DEFAULT_TITLE,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.state.chats.unshift(chat);
    this.state.activeChatId = chat.id;
    return chat;
  }

  ensureActive() {
    if (!Array.isArray(this.state.chats)) this.state.chats = [];
    let chat = this.state.chats.find((c) => c.id === this.state.activeChatId);
    if (!chat) {
      chat = this.createChat();
    }
    return chat;
  }

  activeChat() { return this.ensureActive(); }

  activeMessages() { return this.ensureActive().messages || []; }

  listChats() {
    return [...this.state.chats].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  }

  newChat() {
    this.createChat();
    this.save();
    return this.activeChat();
  }

  switchChat(id) {
    if (!this.state.chats.some((c) => c.id === id)) return false;
    this.state.activeChatId = id;
    this.save();
    return true;
  }

  deleteChat(id) {
    const before = this.state.chats.length;
    this.state.chats = this.state.chats.filter((c) => c.id !== id);
    if (!this.state.chats.length) {
      this.createChat();
    } else if (!this.state.chats.some((c) => c.id === this.state.activeChatId)) {
      this.state.activeChatId = this.state.chats[0].id;
    }
    if (this.state.chats.length !== before) this.save();
    return true;
  }

  /* ---------- profil ---------- */
  setProfile(patch) {
    this.state.profile = { ...this.state.profile, ...patch };
    this.state.profile.interests = (this.state.profile.interests || [])
      .map((x) => String(x).trim())
      .filter(Boolean)
      .slice(0, 24);
    this.save();
  }

  /* ---------- tənzimləmələr ---------- */
  setSettings(patch) {
    this.state.settings = { ...this.state.settings, ...patch };
    this.save();
  }

  /* ---------- xatirələr ---------- */
  addFact(text, tags = []) {
    const clean = String(text || '').trim();
    if (!clean) return null;
    const existing = this.state.facts.find(
      (f) => f.text.toLowerCase() === clean.toLowerCase()
    );
    if (existing) return existing;

    const fact = { id: uid(), text: clean.slice(0, 600), tags, ts: Date.now() };
    this.state.facts.unshift(fact);
    if (this.state.facts.length > 200) this.state.facts.length = 200;
    this.save();
    return fact;
  }

  removeFact(id) {
    this.state.facts = this.state.facts.filter((f) => f.id !== id);
    this.save();
  }

  /* ---------- qeydlər ---------- */
  addNote(text) {
    const clean = String(text || '').trim();
    if (!clean) return null;
    const note = { id: uid(), text: clean.slice(0, 1200), ts: Date.now() };
    this.state.notes.unshift(note);
    this.save();
    return note;
  }

  removeNote(id) {
    this.state.notes = this.state.notes.filter((n) => n.id !== id);
    this.save();
  }

  /* ---------- söhbət ---------- */
  addMessage({ role, content, actions = null, tool = null, id = null }) {
    const chat = this.ensureActive();
    const msg = {
      id: id || uid(),
      role,
      content: String(content ?? ''),
      actions: actions || undefined,
      tool: tool || undefined,
      ts: Date.now()
    };
    chat.messages.push(msg);
    if (chat.messages.length > MAX_MESSAGES) {
      chat.messages.splice(0, chat.messages.length - MAX_MESSAGES);
    }
    chat.updatedAt = Date.now();
    if (!chat.title || chat.title === DEFAULT_TITLE) {
      if (role === 'user' && content) chat.title = String(content).slice(0, 48);
    }
    this.save();
    return msg;
  }

  clearConversation() {
    const chat = this.ensureActive();
    chat.messages = [];
    chat.updatedAt = Date.now();
    this.save();
  }

  /* Model üçün son mesajlar (şəkillər tarixçəyə yazılmır). */
  contextMessages(limit = 16) {
    const trimmed = this.activeMessages()
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-limit);
    return trimmed.map((m) => ({ role: m.role, content: m.content }));
  }

  /* Arxivdə axtarış — bütün söhbətlər üzrə. */
  searchArchive(query, limit = 6) {
    const q = String(query || '').toLowerCase().trim();
    if (!q) return [];
    const terms = q.split(/\s+/).filter((t) => t.length > 2);
    if (!terms.length) return [];

    const scored = [];
    for (const chat of this.state.chats) {
      for (const m of chat.messages || []) {
        if (m.role !== 'user' && m.role !== 'assistant') continue;
        const text = String(m.content || '').toLowerCase();
        let score = 0;
        for (const t of terms) {
          if (text.includes(t)) score += 1;
        }
        if (score > 0) scored.push({ ...m, score });
      }
    }
    return scored
      .sort((a, b) => b.score - a.score || b.ts - a.ts)
      .slice(0, limit)
      .map((m) => ({ role: m.role, content: m.content, ts: m.ts }));
  }

  /* ---------- ixrac / import ---------- */
  exportJSON() {
    return JSON.stringify(
      {
        app: 'JARVIS',
        version: this.state.version,
        exportedAt: new Date().toISOString(),
        profile: this.state.profile,
        facts: this.state.facts,
        notes: this.state.notes,
        chats: this.state.chats,
        activeChatId: this.state.activeChatId
        // API açarları bilərəkdən ixrac olunmur.
      },
      null,
      2
    );
  }

  importJSON(text) {
    const data = safeParse(text);
    if (!data) throw new Error('Fayl oxuna bilmədi — düzgün JSON deyil.');
    if (data.profile) this.state.profile = { ...this.state.profile, ...data.profile };
    if (Array.isArray(data.facts)) {
      const seen = new Set(this.state.facts.map((f) => f.text.toLowerCase()));
      for (const f of data.facts) {
        const clean = String(f.text || '').trim();
        if (!clean || seen.has(clean.toLowerCase())) continue;
        seen.add(clean.toLowerCase());
        this.state.facts.push({ id: uid(), text: clean, tags: [], ts: f.ts || Date.now() });
      }
    }
    if (Array.isArray(data.notes)) {
      for (const n of data.notes) {
        const clean = String(n.text || '').trim();
        if (clean) this.state.notes.push({ id: uid(), text: clean, ts: n.ts || Date.now() });
      }
    }
    if (Array.isArray(data.chats) && data.chats.length) {
      for (const c of data.chats) {
        const messages = Array.isArray(c.messages) ? c.messages : [];
        if (!messages.length) continue;
        this.state.chats.push({
          id: uid(),
          title: c.title || this.titleFor(messages),
          messages: messages
            .filter((m) => m && ['user', 'assistant'].includes(m.role))
            .map((m) => ({ id: uid(), role: m.role, content: String(m.content || '').slice(0, 12000), ts: m.ts || Date.now() })),
          createdAt: Number(c.createdAt || Date.now()),
          updatedAt: Number(c.updatedAt || Date.now())
        });
      }
    } else if (Array.isArray(data.messages)) {
      const chat = this.createChat(this.titleFor(data.messages));
      for (const m of data.messages) {
        if (!m || !['user', 'assistant'].includes(m.role)) continue;
        chat.messages.push({
          id: uid(),
          role: m.role,
          content: String(m.content || '').slice(0, 12000),
          ts: m.ts || Date.now()
        });
      }
    }
    this.save();
  }

  resetAll() {
    this.state = defaultState();
    this.save();
  }
}

export const store = new Store();
export { uid };
