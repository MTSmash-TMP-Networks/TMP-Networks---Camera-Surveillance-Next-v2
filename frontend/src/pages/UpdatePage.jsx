import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArchiveRestore, CheckCircle2, FileArchive, HardDriveDownload, History, RefreshCw,
  RotateCcw, ShieldCheck, Trash2, UploadCloud, XCircle,
} from 'lucide-react';
import { api } from '../services/api.js';
import { useI18n } from '../i18n/index.js';

function bytes(value, locale = 'en') {
  const number = Number(value || 0);
  const format = (amount, digits = 1) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(amount);
  if (number < 1024) return `${number} B`;
  if (number < 1024 ** 2) return `${format(number / 1024)} KB`;
  if (number < 1024 ** 3) return `${format(number / 1024 ** 2)} MB`;
  return `${format(number / 1024 ** 3, 2)} GB`;
}

function date(value, locale = 'en') {
  if (!value) return '–';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '–';
  try { return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed); }
  catch { return '–'; }
}

function translatedOrFallback(t, key, fallbackKey, variables = {}) {
  const value = t(key, variables);
  return value === key ? t(fallbackKey, variables) : value;
}

function readableError(error, t) {
  const code = String(error?.code || '').trim();
  const key = code ? `update.errorCode.${code}` : '';
  const message = key ? translatedOrFallback(t, key, 'update.error.generic') : t('update.error.generic');
  const diagnosticId = error?.details?.diagnosticId || error?.details?.diagnosisId || error?.diagnosticId;
  return diagnosticId ? `${message} ${t('update.diagnostics.id')}: ${diagnosticId}` : message;
}

const terminalStates = new Set(['completed', 'rolled_back', 'failed']);
function updaterIssueLabel(t, code) {
  const value = String(code || 'UPDATER_ISSUE');
  const translated = t(`update.issue.${value}`);
  return translated === `update.issue.${value}` ? `${t('update.error.operationFailed')} (${value})` : `${translated} (${value})`;
}

function localizeUpdateStatus(t, status = {}) {
  const phase = String(status?.phase || 'preparing');
  return translatedOrFallback(t, `update.phase.${phase}`, 'update.phase.preparing', { version: status?.installedVersion || status?.version || '' });
}


export function UpdatePage() {
  const { t, locale } = useI18n();
  const [overview, setOverview] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState(null);
  const fileRef = useRef(null);
  const previousState = useRef(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    try {
      const next = await api.updateOverview();
      setOverview(next);
      if (!quiet) setError('');
      const state = next.status?.state;
      if (terminalStates.has(state) && previousState.current === 'running') {
        setNotice(localizeUpdateStatus(t, next.status));
      }
      previousState.current = state;
    } catch (loadError) {
      if (!quiet) setError(readableError(loadError, t));
    }
  }, [t]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => load({ quiet: true }), overview?.status?.state === 'running' ? 1500 : 5000);
    return () => window.clearInterval(interval);
  }, [load, overview?.status?.state]);

  const latestPackage = useMemo(() => overview?.packages?.[0] || null, [overview]);
  const running = overview?.status?.state === 'running';
  const updater = overview?.updater || {};
  const updaterRestarting = updater.restarting === true || updater.status === 'restarting' || updater.code === 'UPDATER_RESTARTING';
  const updaterReachable = updaterRestarting || updater.reachable === true || updater.status === 'ok' || updater.status === 'degraded';
  const updaterInstallReady = !updaterRestarting && updaterReachable && updater.installReady !== false && updater.status !== 'degraded';
  const updaterStateClass = updaterInstallReady ? 'online' : (updaterReachable ? 'degraded' : 'offline');
  const updaterStateLabel = updaterRestarting ? t('update.service.state.restarting') : (updaterInstallReady ? t('update.service.state.ready') : (updaterReachable ? t('update.service.state.degraded') : t('update.service.state.unreachable')));
  const updaterPillLabel = `${t('update.card.service')} · ${updaterStateLabel}`;
  const updaterActionLabel = updaterInstallReady ? t('update.action.install') : t('update.action.installTry');
  const updaterAttempts = Array.isArray(updater.attempts) ? updater.attempts : [];

  async function upload() {
    if (!selectedFile) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.uploadUpdate(selectedFile);
      setExpanded(result.id);
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = '';
      setNotice(t('update.notice.packageReady', { version: result.inspection.version }));
      await load({ quiet: true });
    } catch (uploadError) { setError(readableError(uploadError, t)); }
    finally { setBusy(false); }
  }

  async function install(item) {
    const version = item.inspection?.version || '?';
    const serviceWarning = updaterInstallReady
      ? ''
      : updaterReachable
        ? `\n\n${t('update.service.warning.degraded')}`
        : `\n\n${t('update.service.warning.unreachable')}`;
    const confirmed = window.confirm(`${t('update.confirm.install', { version })}${serviceWarning}`);
    if (!confirmed) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.installUpdate(item.id);
      setNotice(t('update.notice.installStarted', { version }));
      await load({ quiet: true });
    } catch (installError) { setError(readableError(installError, t)); }
    finally { setBusy(false); }
  }

  async function remove(item) {
    if (!window.confirm(t('update.confirm.delete', { filename: item.filename }))) return;
    setBusy(true); setError('');
    try { await api.deleteUpdatePackage(item.id); await load({ quiet: true }); }
    catch (removeError) { setError(readableError(removeError, t)); }
    finally { setBusy(false); }
  }

  async function rollback(backup) {
    if (!window.confirm(t('update.confirm.rollback', { version: backup.version }))) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.rollbackUpdate(backup.id);
      setNotice(t('update.notice.rollbackStarted', { version: backup.version }));
      await load({ quiet: true });
    } catch (rollbackError) { setError(readableError(rollbackError, t)); }
    finally { setBusy(false); }
  }

  if (!overview) return <div className="loading-panel update-load-state">
    {error ? <div className="update-load-error"><XCircle /><strong>{t('update.load.unreachable')}</strong><p>{error}</p><button className="secondary-button" onClick={() => load()} disabled={busy}><RefreshCw /> {t('update.load.retry')}</button></div> : t('update.load.loading')}
  </div>;

  const serviceMessage = updaterRestarting
    ? t('update.service.state.restarting')
    : updater.busy
      ? t('update.history.status.running')
      : updaterStateLabel;

  return <div className="page update-page">
    <header className="page-header">
      <div><span className="eyebrow">{t('update.header.eyebrow')}</span><h1>{t('update.header.title')}</h1><p>{t('update.header.subtitle')}</p></div>
      <div className="header-actions">
        <span className={`service-pill ${updaterStateClass}`}><ShieldCheck /> {updaterPillLabel}</span>
        <button className="secondary-button" onClick={() => load()} disabled={busy}><RefreshCw /> {t('common.refresh')}</button>
      </div>
    </header>

    {error && <div className="update-alert error"><XCircle /><span><strong>{t('update.error.operationFailed')}</strong>{error}</span></div>}
    {notice && <div className="update-alert success"><CheckCircle2 /><span><strong>{t('update.notice.status')}</strong>{notice}</span></div>}

    <section className="update-version-grid">
      <article className="version-card current"><span>{t('update.card.installedVersion')}</span><strong>v{overview.currentVersion}</strong><small>TMP Camera Surveillance Next</small></article>
      <article className="version-card"><span>{t('update.card.service')}</span><strong>{updaterStateLabel}</strong><small>{serviceMessage}</small>{updater.connection?.method && <em>{t('update.service.connection', { method: updater.connection.method })}</em>}</article>
      <article className="version-card"><span>{t('update.card.maxPackageSize')}</span><strong>{bytes(overview.maxUploadBytes, locale)}</strong><small>{t('update.card.verifiedOnly')}</small></article>
    </section>

    {!updaterRestarting && (!updaterInstallReady || updaterAttempts.length > 0) && <details className="updater-diagnostics" open={!updaterReachable}>
      <summary>{t('update.diagnostics.title')}</summary>
      <div className="updater-diagnostics-body">
        <p>{t('update.security.description')}</p>
        {updater.diagnosticId && <p><strong>{t('update.diagnostics.id')}:</strong> <code>{updater.diagnosticId}</code></p>}
        {updater.issueCodes?.length > 0 && <p><strong>{t('update.diagnostics.hints')}:</strong> {updater.issueCodes.map((code) => updaterIssueLabel(t, code)).join(' · ')}</p>}
        {updaterAttempts.length > 0 && <div className="updater-attempt-list">{updaterAttempts.map((attempt, index) => <article key={`${attempt.endpoint || 'endpoint'}-${attempt.attempt || index}-${index}`}>
          <div><strong>{attempt.endpoint || 'Updater'}</strong><span>{updaterIssueLabel(t, attempt.code || 'UPDATER_UNAVAILABLE')}</span></div>
          <code>{attempt.code || 'UPDATER_UNAVAILABLE'}{attempt.status ? ` · HTTP ${attempt.status}` : ''}</code>
        </article>)}</div>}
      </div>
    </details>}

    {(running || overview.status?.phase !== 'idle') && <section className={`update-progress-card state-${overview.status?.state}`}>
      <div className="update-progress-head">
        <div><span className="eyebrow">{t('update.progress.eyebrow')}</span><h2>{localizeUpdateStatus(t, overview.status)}</h2><p>{translatedOrFallback(t, `update.phase.${overview.status?.phase || 'preparing'}`, 'update.phase.preparing')} · {overview.status?.progress || 0}%</p></div>
        {terminalStates.has(overview.status?.state) && <button className="primary-button" onClick={() => window.location.reload()}><RefreshCw /> {t('update.progress.reload')}</button>}
      </div>
      <div className="update-progress-track"><span style={{ width: `${Math.max(1, overview.status?.progress || 0)}%` }} /></div>
      {overview.status?.error && <div className="update-inline-error">{t('update.error.generic')}</div>}
      <details className="update-log" open={overview.status?.state === 'failed'}><summary>{t('update.log.technical')}</summary><pre>{(overview.status?.logs || []).map((entry) => `[${date(entry.at, locale)}] ${entry.message}`).join('\n') || t('update.log.empty')}</pre></details>
    </section>}

    <section className="update-upload-card">
      <div className="section-heading"><div><h2>{t('update.upload.title')}</h2><p>{t('update.upload.description')}</p></div><UploadCloud /></div>
      <div className={`update-dropzone ${selectedFile ? 'has-file' : ''}`} onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setSelectedFile(event.dataTransfer.files?.[0] || null); }}>
        <input ref={fileRef} type="file" accept=".zip,application/zip" onChange={(event) => setSelectedFile(event.target.files?.[0] || null)} />
        <FileArchive />
        {selectedFile ? <div><strong>{selectedFile.name}</strong><span>{bytes(selectedFile.size, locale)}</span></div> : <div><strong>{t('update.upload.selectZip')}</strong><span>{t('update.upload.dropHint')}</span></div>}
      </div>
      <div className="update-upload-actions"><small>{t('update.upload.validationHint')}</small><button className="primary-button" onClick={upload} disabled={!selectedFile || busy || running}><HardDriveDownload /> {t('update.upload.check')}</button></div>
    </section>

    <section className="update-section">
      <div className="section-heading"><div><h2>{t('update.packages.title')}</h2><p>{t('update.packages.subtitle')}</p></div><span>{t('update.packages.count', { count: overview.packages?.length || 0 })}</span></div>
      <div className="update-package-list">
        {(overview.packages || []).map((item) => {
          const info = item.inspection || {};
          const isExpanded = expanded === item.id;
          return <article className="update-package" key={item.id}>
            <div className="update-package-main">
              <div className="update-package-icon"><FileArchive /></div>
              <div><div className="update-package-title"><strong>{info.title || item.filename}</strong><em>v{info.version || '?'}</em></div><p>{info.summary || t('update.package.noSummary')}</p><small>{item.filename} · {bytes(item.size, locale)} · {t('update.package.uploaded', { date: date(item.uploadedAt, locale) })}</small></div>
              <div className="update-package-actions"><button className="text-button" onClick={() => setExpanded(isExpanded ? null : item.id)}>{isExpanded ? t('update.package.closeDetails') : t('update.package.showChanges')}</button><button className="primary-button" onClick={() => install(item)} disabled={busy || running || updaterRestarting} title={updaterRestarting ? updaterStateLabel : updaterActionLabel}><UploadCloud /> {updaterActionLabel}</button><button className="icon-danger" onClick={() => remove(item)} disabled={busy || running} title={t('update.action.deletePackage')}><Trash2 /></button></div>
            </div>
            {isExpanded && <div className="update-package-details">
              <div className="update-integrity"><ShieldCheck /><span><strong>{t('update.package.integrityVerified')}</strong>SHA-256: <code>{info.packageSha256 || item.sha256}</code> · {t('update.package.files', { count: info.fileCount || 0 })}</span></div>
              <h3>{t('update.package.changes')}</h3>
              <ul>{(info.changes || []).map((change, index) => <li key={`${item.id}-${index}`}>{change}</li>)}</ul>
              <details><summary>{t('update.package.fullNotes')}</summary><pre>{info.changelog || t('update.package.noNotes')}</pre></details>
            </div>}
          </article>;
        })}
        {!latestPackage && <div className="empty-panel compact">{t('update.packages.empty')}</div>}
      </div>
    </section>

    <div className="update-lower-grid">
      <section className="update-section compact-section">
        <div className="section-heading"><div><h2>{t('update.backups.title')}</h2><p>{t('update.backups.subtitle')}</p></div><ArchiveRestore /></div>
        <div className="backup-list">{(overview.backups || []).map((backup) => <article key={backup.id}><div><strong>{t('common.version')} {backup.version}</strong><span>{date(backup.createdAt, locale)}{backup.database ? ` · ${t('update.backups.includesDatabase')}` : ''}</span></div><button className="secondary-button" onClick={() => rollback(backup)} disabled={busy || running}><RotateCcw /> {t('update.action.rollback')}</button></article>)}{!overview.backups?.length && <p className="muted-copy">{t('update.backups.empty')}</p>}</div>
      </section>
      <section className="update-section compact-section">
        <div className="section-heading"><div><h2>{t('update.history.title')}</h2><p>{t('update.history.subtitle')}</p></div><History /></div>
        <div className="update-history">{(overview.history || []).map((entry) => <article key={entry.id}><span className={`history-state ${entry.status}`}>{t(`update.history.status.${entry.status}`)}</span><div><strong>{entry.fromVersion ? `${entry.fromVersion} → ` : ''}{entry.toVersion || entry.backupId}</strong><small>{date(entry.completedAt || entry.startedAt, locale)}</small></div></article>)}{!overview.history?.length && <p className="muted-copy">{t('update.history.empty')}</p>}</div>
      </section>
    </div>

    <aside className="update-security-note"><ShieldCheck /><div><strong>{t('update.security.title')}</strong><p>{t('update.security.description')}</p></div></aside>
  </div>;
}
