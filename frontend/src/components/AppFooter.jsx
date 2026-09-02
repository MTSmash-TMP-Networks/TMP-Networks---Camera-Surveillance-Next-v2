import { Link } from 'react-router-dom';
import { LanguageSelector } from '../i18n/LanguageSelector.jsx';
import { useI18n } from '../i18n/I18nProvider.jsx';

export function AppFooter() {
  const { t } = useI18n();
  const year = new Date().getFullYear();
  const version = typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '–';
  return <footer className="footer app-footer" aria-label={t('common.footerInfo')}>
    <span>© {year} TMP-SYSTEM-SERVICE GmbH</span>
    <span className="footer-separator" aria-hidden="true">·</span>
    <span>{t('common.version')} {version}</span>
    <span className="footer-separator" aria-hidden="true">·</span>
    <Link to="/license">{t('common.license')}</Link>
    <span className="footer-separator" aria-hidden="true">·</span>
    <LanguageSelector compact />
    <span className="footer-separator footer-community-separator" aria-hidden="true">·</span>
    <span className="footer-community-mark">Made in the EU</span>
  </footer>;
}
