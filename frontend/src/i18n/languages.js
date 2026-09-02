export const DEFAULT_LOCALE = 'en';
export const FALLBACK_LOCALE = 'en';
export const LANGUAGE_STORAGE_KEY = 'tmp-camera-ui-language';

export const SUPPORTED_LANGUAGES = Object.freeze([
  { code: 'de', name: 'German', nativeName: 'Deutsch', direction: 'ltr' },
  { code: 'en', name: 'English', nativeName: 'English', direction: 'ltr' },
  { code: 'fr', name: 'French', nativeName: 'Français', direction: 'ltr' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', direction: 'ltr' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', direction: 'ltr' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', direction: 'ltr' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', direction: 'ltr' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)', direction: 'ltr' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', direction: 'ltr' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština', direction: 'ltr' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', direction: 'ltr' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', direction: 'ltr' },
  { code: 'nb', name: 'Norwegian', nativeName: 'Norsk', direction: 'ltr' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', direction: 'ltr' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română', direction: 'ltr' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar', direction: 'ltr' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', direction: 'ltr' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', direction: 'ltr' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', direction: 'ltr' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', direction: 'rtl' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文', direction: 'ltr' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '繁體中文', direction: 'ltr' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', direction: 'ltr' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', direction: 'ltr' },
]);

const aliases = Object.freeze({
  no: 'nb', 'pt': 'pt-BR', 'pt-br': 'pt-BR', 'zh': 'zh-CN', 'zh-hans': 'zh-CN',
  'zh-hant': 'zh-TW', 'zh-cn': 'zh-CN', 'zh-tw': 'zh-TW', 'en-us': 'en', 'en-gb': 'en',
  'de-de': 'de', 'de-at': 'de', 'de-ch': 'de',
});

export function normalizeLocale(candidate) {
  if (!candidate || typeof candidate !== 'string') return null;
  const raw = candidate.trim();
  if (!raw) return null;
  const normalizedRaw = raw.replace(/_/g, '-');
  const lower = normalizedRaw.toLowerCase();
  const direct = SUPPORTED_LANGUAGES.find((item) => item.code.toLowerCase() === lower);
  if (direct) return direct.code;
  const alias = aliases[lower];
  if (alias) return alias;
  const base = lower.split('-')[0];
  const baseMatch = SUPPORTED_LANGUAGES.find((item) => item.code.toLowerCase() === base);
  return baseMatch?.code || aliases[base] || null;
}

export function resolveInitialLocale({ storedLocale, browserLocales = [] } = {}) {
  const stored = normalizeLocale(storedLocale);
  if (stored) return stored;
  for (const candidate of browserLocales) {
    const normalized = normalizeLocale(candidate);
    if (normalized) return normalized;
  }
  return DEFAULT_LOCALE;
}

export function getLanguage(locale) {
  const normalized = normalizeLocale(locale) || FALLBACK_LOCALE;
  return SUPPORTED_LANGUAGES.find((item) => item.code === normalized) || SUPPORTED_LANGUAGES[1];
}
