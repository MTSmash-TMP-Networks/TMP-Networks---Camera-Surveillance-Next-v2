import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { Navigate } from 'react-router-dom';
import { Activity, RadioTower, ShieldCheck } from 'lucide-react';
import { api } from '../services/api.js';
import { connectEventSocket } from '../services/eventSocket.js';
import { useI18n } from '../i18n/I18nProvider.jsx';
import { eventMetaLabel, eventTypeLabel, localizeEventMessage, originalEventMessage } from '../i18n/eventLocalization.js';

function EventRow({ item, locale, t, formatDate }) {
  const message = localizeEventMessage(item, { locale, t });
  const original = originalEventMessage(item);
  const analysis = item?.payload?.details?.analysis || item?.details?.analysis || null;
  const diagnosticTitle = original && original !== message ? `${t('events.originalDiagnostic')}: ${original}` : undefined;
  return <div className={`event-log-row outcome-${item.outcome || item.payload?.level || item.details?.level || 'info'} ${analysis ? 'has-ai-analysis' : ''}`} title={diagnosticTitle}>
    <time>{formatDate(item.createdAt, { dateStyle: 'short', timeStyle: 'medium' })}</time>
    <strong>{eventTypeLabel(item, t)}</strong>
    <span>{message}</span>
    <small>{eventMetaLabel(item, t)}</small>
    {analysis && <div className="event-ai-analysis"><strong>{analysis.title || t('ai.analysis')}</strong><p>{analysis.description}</p><small><span>{t('ai.priority')}: {t(`ai.priority.${analysis.priority || 'normal'}`)}</span><span>{t('ai.activity')}: {analysis.activity || '—'}</span>{analysis.objects?.length ? <span>{t('ai.objects')}: {analysis.objects.join(', ')}</span> : null}<span>{t('ai.confidence')}: {Math.round(Number(analysis.confidence || 0) * 100)}%</span></small></div>}
  </div>;
}

export function EventsPage() {
  const user = useSelector((state) => state.auth.user);
  const { locale, t, formatDate } = useI18n();
  const [audit, setAudit] = useState([]);
  const [live, setLive] = useState([]);
  const [socketState, setSocketState] = useState('connecting');
  const [error, setError] = useState('');
  const load = async () => {
    try {
      const [auditResult, eventResult] = await Promise.all([api.auditLogs({ limit: 250 }), api.recentDomainEvents({ limit: 250 })]);
      setAudit(auditResult.items || []);
      setLive(eventResult.items || []);
      setError('');
    } catch (reason) { setError(reason.message); }
  };

  useEffect(() => {
    void load();
    const disconnect = connectEventSocket({
      onState: setSocketState,
      onEvent: (event) => {
        setLive((current) => [...current, event].slice(-250));
        if (event.type === 'audit.log') setAudit((current) => [...current, event.payload].slice(-250));
      },
    });
    const timer = globalThis.setInterval(() => void load(), 30_000);
    return () => { disconnect(); globalThis.clearInterval(timer); };
  }, []);

  const newestLive = useMemo(() => [...live].reverse(), [live]);
  const newestAudit = useMemo(() => [...audit].reverse(), [audit]);
  const socketLabel = socketState === 'connected' ? t('events.socket.connected') : socketState === 'connecting' ? t('events.socket.connecting') : t('events.socket.fallback');
  if (user?.role !== 'admin') return <Navigate to="/" replace/>;
  return <div className="page events-page">
    <header className="page-header">
      <div><span className="eyebrow">{t('events.eyebrow')}</span><h1>{t('events.title')}</h1><p>{t('events.subtitle')}</p></div>
      <div className={`connection-badge ${socketState}`}><RadioTower/> {socketLabel}</div>
    </header>
    {error && <div className="form-error" title={locale === 'de' ? undefined : error}>{locale === 'de' ? error : `${t('events.title')}: ${t('common.unavailable')}`}</div>}
    <div className="event-columns">
      <section className="settings-card">
        <div className="wizard-title"><Activity/><div><h2>{t('events.live.title')}</h2><p>{t('events.live.subtitle')}</p></div></div>
        <div className="event-log-list">{newestLive.map((item) => <EventRow key={item.id || `${item.sequence}-${item.createdAt}`} item={item} locale={locale} t={t} formatDate={formatDate}/>)}{!newestLive.length && <div className="empty-mini">{t('events.live.empty')}</div>}</div>
      </section>
      <section className="settings-card">
        <div className="wizard-title"><ShieldCheck/><div><h2>{t('events.audit.title')}</h2><p>{t('events.audit.subtitle')}</p></div></div>
        <div className="event-log-list">{newestAudit.map((item) => <EventRow key={item.id} item={item} locale={locale} t={t} formatDate={formatDate}/>)}{!newestAudit.length && <div className="empty-mini">{t('events.audit.empty')}</div>}</div>
      </section>
    </div>
  </div>;
}
