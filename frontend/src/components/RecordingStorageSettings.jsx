import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, HardDrive, KeyRound, Network, RefreshCw, Save, Server, ShieldCheck, Wifi } from 'lucide-react';
import { api } from '../services/api.js';
import { useI18n } from '../i18n/index.js';
import { parseSmbLocationText } from '../utils/smbLocation.js';

function storageError(error, t) {
  const code = String(error?.code || '');
  if (code === 'NETWORK_STORAGE_INVALID' || code === 'NETWORK_STORAGE_PATH_INVALID' || code === 'NETWORK_STORAGE_PROTOCOL_UNSUPPORTED') return t('recordings.storage.error.invalid');
  if (code === 'NETWORK_STORAGE_AUTH_FAILED') return t('recordings.storage.error.auth');
  if (code === 'NETWORK_STORAGE_PERMISSION_DENIED') return t('recordings.storage.error.permission');
  if (code === 'NETWORK_STORAGE_SHARE_NOT_FOUND') return t('recordings.storage.error.share');
  if (code === 'NETWORK_STORAGE_PROTOCOL_FAILED') return t('recordings.storage.error.protocol');
  if (code === 'NETWORK_STORAGE_HOST_UNRESOLVED') return t('recordings.storage.error.host');
  if (code === 'NETWORK_STORAGE_PORT_UNREACHABLE') return t('recordings.storage.error.port');
  if (code === 'NETWORK_STORAGE_SMB_FAILED') return t('recordings.storage.error.smb');
  if (code === 'NETWORK_STORAGE_CLIENT_MISSING') return t('recordings.storage.error.clientMissing');
  if (code === 'NETWORK_STORAGE_VERIFY_FAILED' || code === 'NETWORK_STORAGE_LOCAL_CLEANUP_FAILED') return t('recordings.storage.error.verify');
  if (code === 'NETWORK_STORAGE_CONNECTION_FAILED' || code === 'NETWORK_STORAGE_TIMEOUT') return t('recordings.storage.error.connection');
  return t('recordings.storage.error.generic', { code: code || 'UNKNOWN' });
}

function defaultPort(protocol) { return protocol === 'sftp' ? 22 : 445; }

export function RecordingStorageSettings({ canConfigure = false }) {
  const { t } = useI18n();
  const [overview, setOverview] = useState(null);
  const [form, setForm] = useState({ mode: 'local', protocol: 'smb', host: '', port: 445, share: '', basePath: 'TMP-Camera', username: '', password: '', domain: '', hostKeyPolicy: 'accept-new' });
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function sync(result) {
    const profile = result?.profile || {};
    const protocol = profile.protocol || 'smb';
    setForm({
      mode: result?.mode || 'local', protocol,
      host: profile.host || '', port: profile.port || defaultPort(protocol), share: profile.share || '',
      basePath: profile.basePath || (protocol === 'sftp' ? '/TMP-Camera' : 'TMP-Camera'),
      username: profile.username || '', password: '', domain: profile.domain || '', hostKeyPolicy: profile.hostKeyPolicy || 'accept-new',
    });
  }

  async function load({ syncForm = true } = {}) {
    try {
      const result = await api.recordingStorage();
      setOverview(result);
      if (syncForm) sync(result);
      setError('');
      return result;
    } catch (cause) {
      setError(storageError(cause, t));
      return null;
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const payload = useMemo(() => ({
    mode: form.mode,
    protocol: form.protocol,
    host: form.host.trim(),
    port: Number(form.port || defaultPort(form.protocol)),
    share: form.share.trim(),
    basePath: form.basePath.trim(),
    username: form.username,
    password: form.password,
    domain: form.domain.trim(),
    hostKeyPolicy: form.hostKeyPolicy,
  }), [form]);

  const profile = overview?.profile || null;
  const runtime = overview?.runtime || {};
  const counts = runtime.counts || {};
  const networkIncomplete = form.mode === 'network' && (!form.host.trim() || !form.basePath.trim() || (form.protocol === 'smb' && !form.share.trim()) || (form.protocol === 'sftp' && !form.username.trim()));

  async function testTarget() {
    setTesting(true); setError(''); setNotice('');
    try {
      await api.testRecordingStorage(payload);
      setNotice(t('recordings.storage.testOk'));
    } catch (cause) { setError(storageError(cause, t)); }
    finally { setTesting(false); }
  }

  async function saveTarget() {
    if (!canConfigure) return;
    setSaving(true); setError(''); setNotice('');
    try {
      // The backend re-validates network connectivity before persisting the target.
      const result = await api.saveRecordingStorage(payload);
      setOverview(result);
      sync(result);
      setNotice(t('recordings.storage.saved'));
    } catch (cause) { setError(storageError(cause, t)); }
    finally { setSaving(false); }
  }

  function changeSmbHost(value) {
    const parsed = parseSmbLocationText(value);
    setForm((current) => parsed ? {
      ...current, host: parsed.host || current.host, port: parsed.port || current.port,
      share: parsed.share || current.share, basePath: parsed.basePath || current.basePath,
    } : { ...current, host: value });
  }

  function changeSmbShare(value) {
    const parsed = parseSmbLocationText(value);
    setForm((current) => parsed ? {
      ...current, host: parsed.host || current.host, port: parsed.port || current.port,
      share: parsed.share || current.share, basePath: parsed.basePath || current.basePath,
    } : { ...current, share: value });
  }

  function changeProtocol(protocol) {
    setForm((current) => ({
      ...current, protocol, port: defaultPort(protocol), share: protocol === 'smb' ? current.share : '',
      domain: protocol === 'smb' ? current.domain : '',
      basePath: current.basePath || (protocol === 'sftp' ? '/TMP-Camera' : 'TMP-Camera'),
    }));
  }

  if (loading) return <section className="recording-storage-page"><div className="storage-loading"><RefreshCw className="spin"/> {t('common.loading')}</div></section>;

  return <section className="recording-storage-page">
    {error && <div className="form-error">{error}</div>}
    {notice && <div className="form-success">{notice}</div>}

    <div className="storage-hero-card">
      <div className="storage-hero-copy"><span className="storage-icon"><HardDrive/></span><div><h2>{t('recordings.storage.title')}</h2><p>{t('recordings.storage.description')}</p></div></div>
      <button className="secondary-button" type="button" onClick={() => load()} disabled={saving}><RefreshCw/> {t('common.refresh')}</button>
    </div>

    <div className="storage-mode-grid">
      <label className={`storage-mode-card ${form.mode === 'local' ? 'selected' : ''}`}>
        <input type="radio" name="recording-storage-mode" checked={form.mode === 'local'} onChange={() => setForm((current) => ({ ...current, mode: 'local' }))} disabled={!canConfigure || saving}/>
        <Database/><span><strong>{t('recordings.storage.local')}</strong><small>{t('recordings.storage.localDescription')}</small></span>
      </label>
      <label className={`storage-mode-card ${form.mode === 'network' ? 'selected' : ''}`}>
        <input type="radio" name="recording-storage-mode" checked={form.mode === 'network'} onChange={() => setForm((current) => ({ ...current, mode: 'network' }))} disabled={!canConfigure || saving}/>
        <Network/><span><strong>{t('recordings.storage.network')}</strong><small>{t('recordings.storage.networkDescription')}</small></span>
      </label>
    </div>

    {form.mode === 'network' && <div className="storage-network-card">
      <div className="storage-form-grid">
        <label>{t('recordings.storage.protocol')}
          <select value={form.protocol} onChange={(event) => changeProtocol(event.target.value)} disabled={!canConfigure || saving}>
            <option value="smb">{t('recordings.storage.protocolSmb')}</option>
            <option value="sftp">{t('recordings.storage.protocolSftp')}</option>
          </select>
        </label>
        <label>{t('recordings.storage.host')}<input value={form.host} onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))} onBlur={(event) => { if (form.protocol === 'smb') changeSmbHost(event.target.value); }} placeholder="192.168.1.20" disabled={!canConfigure || saving}/></label>
        <label>{t('recordings.storage.port')}<input type="number" min="1" max="65535" value={form.port} onChange={(event) => setForm((current) => ({ ...current, port: event.target.value }))} disabled={!canConfigure || saving}/></label>
        {form.protocol === 'smb' && <label>{t('recordings.storage.share')}<input value={form.share} onChange={(event) => setForm((current) => ({ ...current, share: event.target.value }))} onBlur={(event) => changeSmbShare(event.target.value)} placeholder="recordings" disabled={!canConfigure || saving}/><small>{t('recordings.storage.shareHelp')}</small></label>}
        <label className="storage-wide">{t('recordings.storage.basePath')}<input value={form.basePath} onChange={(event) => setForm((current) => ({ ...current, basePath: event.target.value }))} placeholder={form.protocol === 'sftp' ? '/video/TMP-Camera' : 'TMP-Camera'} disabled={!canConfigure || saving}/><small>{t(form.protocol === 'sftp' ? 'recordings.storage.basePathSftpHelp' : 'recordings.storage.basePathSmbHelp')}</small></label>
        <label>{t('common.username')}<input autoComplete="off" value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} disabled={!canConfigure || saving}/></label>
        <label>{t('common.password')}<input type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder={profile?.passwordConfigured ? t('recordings.storage.passwordStored') : ''} disabled={!canConfigure || saving}/></label>
        {form.protocol === 'smb' && <label>{t('recordings.storage.domain')}<input value={form.domain} onChange={(event) => setForm((current) => ({ ...current, domain: event.target.value }))} placeholder="WORKGROUP" disabled={!canConfigure || saving}/></label>}
        {form.protocol === 'sftp' && <label>{t('recordings.storage.hostKeyPolicy')}<select value={form.hostKeyPolicy} onChange={(event) => setForm((current) => ({ ...current, hostKeyPolicy: event.target.value }))} disabled={!canConfigure || saving}><option value="accept-new">{t('recordings.storage.hostKeyAcceptNew')}</option><option value="strict">{t('recordings.storage.hostKeyStrict')}</option></select></label>}
      </div>
      <div className="storage-credential-hint"><KeyRound/><span>{t('recordings.storage.credentialsHint')}</span></div>
    </div>}

    <div className="storage-status-card">
      <header><div><Server/><span><strong>{t('recordings.storage.activeTarget')}</strong><small>{overview?.mode === 'network' && profile ? `${profile.protocol.toUpperCase()} · ${profile.host}:${profile.port}${profile.protocol === 'smb' ? `/${profile.share}` : ''}${profile.basePath ? ` · ${profile.basePath}` : ''}` : runtime.localSpool || '/data/recordings'}</small></span></div>{overview?.mode === 'network' ? <span className={runtime.lastError ? 'storage-status-bad' : 'storage-status-ok'}>{runtime.lastError ? <AlertTriangle/> : <CheckCircle2/>}{runtime.lastError ? t('recordings.storage.connectionIssue') : t('recordings.storage.networkActive')}</span> : <span className="storage-status-ok"><CheckCircle2/> {t('recordings.storage.localActive')}</span>}</header>
      <div className="storage-metrics">
        <article><small>{t('recordings.storage.transferPending')}</small><strong>{Number(counts.pending || 0) + Number(counts.uploading || 0)}</strong><span>{t('recordings.storage.transferPendingHelp')}</span></article>
        <article><small>{t('recordings.storage.transferRemote')}</small><strong>{Number(counts.remote || 0)}</strong><span>{t('recordings.storage.transferRemoteHelp')}</span></article>
        <article><small>{t('recordings.storage.transferFailed')}</small><strong>{Number(counts.upload_failed || 0)}</strong><span>{runtime.lastError ? storageError({ code: runtime.lastError }, t) : t('recordings.storage.transferFailedHelp')}</span></article>
        <article><small>{t('recordings.storage.localSpool')}</small><strong>{t('recordings.storage.spoolActive')}</strong><span>{runtime.localSpool || '/data/recordings'}</span></article>
      </div>
    </div>

    <div className="storage-info-grid">
      <article><Wifi/><div><strong>{t('recordings.storage.directTitle')}</strong><p>{t('recordings.storage.directText')}</p></div></article>
      <article><ShieldCheck/><div><strong>{t('recordings.storage.securityTitle')}</strong><p>{t('recordings.storage.securityText')}</p></div></article>
    </div>

    {!canConfigure && <div className="storage-admin-note"><ShieldCheck/> {t('recordings.storage.adminRequired')}</div>}

    <div className="storage-actions">
      {form.mode === 'network' && <button className="secondary-button" type="button" onClick={testTarget} disabled={!canConfigure || testing || saving || networkIncomplete}><ShieldCheck/> {testing ? t('recordings.storage.testing') : t('recordings.storage.test')}</button>}
      <button className="primary-button" type="button" onClick={saveTarget} disabled={!canConfigure || testing || saving || networkIncomplete}><Save/> {saving ? t('recordings.storage.saving') : t('recordings.storage.save')}</button>
    </div>
  </section>;
}
