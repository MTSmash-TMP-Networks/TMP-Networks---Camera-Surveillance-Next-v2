import { ArrowLeft, ExternalLink, FileText, Printer, Scale, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PRODUCT } from '../config/product.js';
import { useI18n } from '../i18n/I18nProvider.jsx';
import { LanguageSelector } from '../i18n/LanguageSelector.jsx';
import { getLicenseSections } from '../i18n/licenseContent.js';

export function LicensePage() {
  const { locale, t } = useI18n();
  const legalLocale = locale === 'de' ? 'de' : 'en';
  const sections = getLicenseSections(legalLocale);
  const version = typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '–';

  return <div className="legal-page">
    <header className="legal-hero">
      <div className="legal-toolbar">
        <Link className="secondary-button" to="/"><ArrowLeft /> {t('common.backToApp')}</Link>
        <div className="legal-toolbar-actions"><LanguageSelector /><button className="secondary-button" onClick={() => window.print()}><Printer /> {t('common.print')}</button></div>
      </div>
      <div className="legal-heading"><Scale /><div><span className="eyebrow">{t('license.eyebrow')}</span><h1>{t('license.title')}</h1><p>{t('license.subtitle')}</p></div></div>
      <div className="legal-meta"><span>{PRODUCT.name}</span>{PRODUCT.edition && <span>{PRODUCT.edition}</span>}<span>{t('common.version')} {version}</span><span>{PRODUCT.vendor}</span></div>
    </header>

    <main className="legal-content">
      <section className="legal-license-notice">
        <ShieldCheck />
        <div><h2>{t('license.vendorTitle')}</h2><p>{t('license.vendorText')}</p><p className="legal-language-note">{t('license.bindingLanguage')}</p></div>
      </section>

      {sections.map((section) => <section className="legal-section" key={section.key}>
        <h2>{section.title}</h2>
        {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        {section.bullets && <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul>}
      </section>)}

      <section className="legal-section legal-contact">
        <h2>{t('license.section.contact')}</h2>
        <p><strong>{PRODUCT.vendor}</strong><br />{t('common.product')}: {PRODUCT.name}</p>
        <div className="legal-external-links">
          <a href={PRODUCT.vendorUrl} target="_blank" rel="noreferrer">{t('common.vendorWebsite')} <ExternalLink /></a>
          {PRODUCT.supportUrl && <a href={PRODUCT.supportUrl} target="_blank" rel="noreferrer">{t('common.support')} <ExternalLink /></a>}
          {PRODUCT.documentationUrl && <a href={PRODUCT.documentationUrl} target="_blank" rel="noreferrer">{t('license.docsLink')} <ExternalLink /></a>}
          <a href={PRODUCT.licenseAgreementPath} target="_blank" rel="noreferrer">{t('license.fullTextLink')} <FileText /></a>
          <a href={PRODUCT.thirdPartyNoticesPath} target="_blank" rel="noreferrer">{t('license.thirdPartyLink')} <FileText /></a>
        </div>
      </section>

      {locale !== 'de' && locale !== 'en' && <p className="legal-fallback-note">{t('language.fallbackNotice')}</p>}
    </main>
  </div>;
}
