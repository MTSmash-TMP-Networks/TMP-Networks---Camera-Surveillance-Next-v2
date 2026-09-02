import { Languages } from 'lucide-react';
import { SUPPORTED_LANGUAGES } from './languages.js';
import { useI18n } from './I18nProvider.jsx';

export function LanguageSelector({ compact = false, className = '' }) {
  const { locale, setLocale, t } = useI18n();
  return <label className={`language-selector ${compact ? 'is-compact' : ''} ${className}`.trim()}>
    <Languages aria-hidden="true" />
    <span className="sr-only">{t('common.language')}</span>
    <select aria-label={t('common.language')} value={locale} onChange={(event) => setLocale(event.target.value)}>
      {SUPPORTED_LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.nativeName}</option>)}
    </select>
  </label>;
}
