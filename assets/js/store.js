/* Yaddaş qatı: profil, xatirələr, qeydlər və söhbət tarixçəsi.
   Hər şey yalnız bu brauzerin localStorage-ında saxlanılır. */

import { DEFAULT_SETTINGS } from './config.js';

const STORAGE_KEY = 'jarvis.state.v2';
const MAX_MESSAGES = 400;

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
    messages: []
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
    return {
      ...base,
      ...saved,
      updatedAt: Number(saved.updatedAt || saved.createdAt || base.updatedAt),
      profile: { ...base.profile, ...(saved.profile || {}) },
      settings: { ...base.settings, ...(saved.settings || {}) },
      facts: Array.isArray(saved.facts) ? saved.facts : [],
      notes: Array.isArray(saved.notes) ? saved.notes : [],
      messages: Array.isArray(saved.messages) ? saved.messages : []
    };
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
    const msg = {
      id: id || uid(),
      role,
      content: String(content ?? ''),
      actions: actions || undefined,
      tool: tool || undefined,
      ts: Date.now()
    };
    this.state.messages.push(msg);
    if (this.state.messages.length > MAX_MESSAGES) {
      this.state.messages.splice(0, this.state.messages.length - MAX_MESSAGES);
    }
    this.save();
    return msg;
  }

  clearConversation() {
    this.state.messages = [];
    this.save();
  }

  /* Model üçün son mesajlar (şəkillər tarixçəyə yazılmır). */
  contextMessages(limit = 24) {
    const trimmed = this.state.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-limit);
    return trimmed.map((m) => ({ role: m.role, content: m.content }));
  }

  /* Arxivdə axtarış — JARVIS keçmiş söhbətləri xatırlaya bilsin deyə. */
  searchArchive(query, limit = 6) {
    const q = String(query || '').toLowerCase().trim();
    if (!q) return [];
    const terms = q.split(/\s+/).filter((t) => t.length > 2);
    if (!terms.length) return [];

    const scored = [];
    for (const m of this.state.messages) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      const text = m.content.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (text.includes(t)) score += 1;
      }
      if (score > 0) scored.push({ ...m, score });
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
        messages: this.state.messages
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
    if (Array.isArray(data.messages)) {
      for (const m of data.messages) {
        if (!m || !['user', 'assistant'].includes(m.role)) continue;
        this.state.messages.push({
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
