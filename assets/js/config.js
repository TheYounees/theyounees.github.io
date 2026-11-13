/* Provayderlər, model seçimləri və standart tənzimləmələr. */

export const PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    keyHint: 'aistudio.google.com/apikey ünvanından pulsuz açar götürün',
    needsKey: true,
    vision: true
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyHint: 'platform.openai.com/api-keys ünvanından açar götürün',
    needsKey: true,
    vision: true
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-2.5-flash',
    keyHint: 'openrouter.ai/keys ünvanından açar götürün (bir çox model bir yerdə)',
    needsKey: true,
    vision: true
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    keyHint: 'console.groq.com/keys ünvanından pulsuz açar götürün',
    needsKey: true,
    vision: false
  },
  ollama: {
    label: 'Ollama (lokal)',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
    keyHint: 'Açar lazım deyil — kompüterinizdə Ollama işləməlidir',
    needsKey: false,
    vision: false
  },
  custom: {
    label: 'Digər (OpenAI uyğun)',
    baseUrl: '',
    model: '',
    keyHint: 'OpenAI formatını dəstəkləyən istənilən endpoint',
    needsKey: true,
    vision: true
  }
};

export const DEFAULT_SETTINGS = {
  provider: 'gemini',
  apiKey: '',
  baseUrl: '',
  model: '',
  temperature: 0.75,
  speak: true,
  voiceUri: '',
  rate: 1,
  pitch: 0.92,
  wakeWord: false,
  searchKey: '',
  city: 'Bakı',
  historyLimit: 24
};

export const QUICK_ACTIONS = [
  'Sabah üçün plan qur',
  'Bugünkü hava necədir?',
  'Məni xatırla: hər səhər idman edirəm',
  'Azərbaycan haqqında qısa məlumat ver',
  'Bu kodu izah et',
  'Fənəri yandır'
];

export const CAPABILITIES = [
  { key: 'speech', label: 'Nitqin tanınması' },
  { key: 'tts', label: 'Səsli cavab' },
  { key: 'torch', label: 'Fənər' },
  { key: 'bluetooth', label: 'Bluetooth' },
  { key: 'share', label: 'Paylaşma' },
  { key: 'notify', label: 'Bildirişlər' },
  { key: 'geolocation', label: 'Məkan' },
  { key: 'battery', label: 'Batareya' },
  { key: 'clipboard', label: 'Bufer' }
];

export const AZ_WEEKDAYS = ['bazar günü', 'bazar ertəsi', 'çərşənbə axşamı', 'çərşənbə', 'cümə axşamı', 'cümə', 'şənbə'];

export const AZ_MONTHS = [
  'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'
];

/** Brauzerin locale dəstəyindən asılı olmayan Azərbaycan dili tarixi. */
export function formatAzDate(date = new Date()) {
  return `${date.getDate()} ${AZ_MONTHS[date.getMonth()]} ${date.getFullYear()}, ${AZ_WEEKDAYS[date.getDay()]}`;
}

export function formatAzTime(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function providerConfig(settings) {
  const base = PROVIDERS[settings.provider] || PROVIDERS.custom;
  const baseUrl = (settings.baseUrl || base.baseUrl || '').replace(/\/+$/, '');
  const model = settings.model || base.model;
  return { ...base, baseUrl, model, id: settings.provider };
}
