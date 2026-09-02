import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { FALLBACK_LOCALE, LANGUAGE_STORAGE_KEY, getLanguage, resolveInitialLocale } from './languages.js';
import { LegacyLocalizationBridge } from './LegacyLocalizationBridge.jsx';
import { translate } from './messages.js';

const I18nContext = createContext(null);

function safeReadStorage() {
  try { return window.localStorage.getItem(LANGUAGE_STORAGE_KEY); } catch { return null; }
}
function safeWriteStorage(locale) {
  try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, locale); } catch { /* Storage can be disabled. */ }
}

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(() => {
    const browserLocales = typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language]);
    const configuredLocale = import.meta.env?.VITE_DEFAULT_LANGUAGE;
    const candidates = configuredLocale && configuredLocale !== 'auto' ? [configuredLocale, ...browserLocales] : browserLocales;
    return resolveInitialLocale({
      storedLocale: typeof window === 'undefined' ? null : safeReadStorage(),
      browserLocales: candidates,
    });
  });

  const language = getLanguage(locale);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = locale;
    document.documentElement.dir = language.direction;
    document.documentElement.dataset.locale = locale;
  }, [language.direction, locale]);

  const setLocale = useCallback((nextLocale) => {
    const normalized = getLanguage(nextLocale).code;
    safeWriteStorage(normalized);
    setLocaleState(normalized);
  }, []);

  const t = useCallback((key, variables) => translate(locale || FALLBACK_LOCALE, key, variables), [locale]);
  const formatDate = useCallback((value, options = {}) => new Intl.DateTimeFormat(locale, options).format(value instanceof Date ? value : new Date(value)), [locale]);
  const formatNumber = useCallback((value, options = {}) => new Intl.NumberFormat(locale, options).format(value), [locale]);

  const contextValue = useMemo(() => ({ locale, language, setLocale, t, formatDate, formatNumber }), [formatDate, formatNumber, language, locale, setLocale, t]);
  return <I18nContext.Provider value={contextValue}><LegacyLocalizationBridge locale={locale} />{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}
