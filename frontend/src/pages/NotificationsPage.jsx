import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BellRing, CheckCircle2, Clock3, Cpu, Mail, RefreshCw, Save, Send, ShieldCheck, Sparkles } from 'lucide-react';
import { SUPPORTED_LANGUAGES, useI18n } from '../i18n/index.js';
import { api } from '../services/api.js';

const emptyRules = { motion: true, cameraStatus: true, streamFailures: true, recordingFailures: true, systemErrors: true, updateOperations: false };
const emptySettings = { enabled: false, host: '', port: 587, security: 'starttls', username: '', password: '', fromName: 'TMP Camera Surveillance', fromAddress: '', recipients: [], language: 'en', rejectUnauthorized: true, cooldownSeconds: 60, rules: emptyRules };
const emptyAiSettings = {
  enabled: false, provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiMode: 'responses', model: 'gpt-5.6-luna', apiKey: '', reasoningEffort: 'low', imageDetail: 'low',
  frameCount: 4, frameIntervalMs: 900, language: 'auto', analysisCooldownSeconds: 20, includeInEmail: true, onlyRelevantNotifications: false, requestTimeoutMs: 30000,
  analyze: { motion: true, manualRecording: true, continuousRecording: false },
};

function recipientsText(items) { return Array.isArray(items) ? items.join('\n') : ''; }
function parseRecipients(value) { return [...new Set(String(value || '').split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean))]; }
function deliveryKind(t, kind) { const map = { test: 'notifications.kind.test', motion: 'events.source.motion', cameraOffline: 'events.source.camera', cameraOnline: 'events.source.camera', streamFailure: 'events.source.stream', streamRecovered: 'events.source.stream', recordingFailure: 'events.source.recording', recordingRecovered: 'events.source.recording', systemError: 'events.source.system', update: 'notifications.kind.update' }; const key = map[kind] || 'events.source.system'; return t(key); }

function localizedUiError(t, reason, fallbackKey) {
  const code = String(reason?.code || '').trim();
  const message = t(fallbackKey);
  return code ? `${message} (${code})` : message;
}

function AiAnalysisCard({ analysis, t }) {
  if (!analysis) return null;
  return <div className={`ai-analysis-card priority-${analysis.priority || 'normal'}`}>
    <div className="ai-analysis-card-header"><span><Sparkles /> {t('ai.analysis')}</span><strong>{analysis.title}</strong></div>
    <p>{analysis.description}</p>
    <div className="ai-analysis-meta">
      <span><b>{t('ai.priority')}:</b> {t(`ai.priority.${analysis.priority || 'normal'}`)}</span>
      <span><b>{t('ai.activity')}:</b> {analysis.activity || '—'}</span>
      <span><b>{t('ai.confidence')}:</b> {Math.round(Number(analysis.confidence || 0) * 100)}%</span>
      {analysis.objects?.length ? <span><b>{t('ai.objects')}:</b> {analysis.objects.join(', ')}</span> : null}
    </div>
  </div>;
}

export function NotificationsPage() {
  const { t, formatDate } = useI18n();
  const [settings, setSettings] = useState(emptySettings);
  const [aiSettings, setAiSettings] = useState(emptyAiSettings);
  const [recipientInput, setRecipientInput] = useState('');
  const [runtime, setRuntime] = useState(null);
  const [aiRuntime, setAiRuntime] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [testRecipient, setTestRecipient] = useState('');
  const [aiTestCamera, setAiTestCamera] = useState('');
  const [aiTestResult, setAiTestResult] = useState(null);

  const load = useCallback(async () => {
    try {
      const [overview, aiOverview, history, cameraResult] = await Promise.all([
        api.emailNotificationSettings(), api.aiEventAnalysisSettings(), api.emailNotificationDeliveries(30), api.cameras(),
      ]);
      const loaded = { ...emptySettings, ...(overview.settings || {}), password: '', rules: { ...emptyRules, ...(overview.settings?.rules || {}) } };
      const loadedAi = { ...emptyAiSettings, ...(aiOverview.settings || {}), apiKey: '', analyze: { ...emptyAiSettings.analyze, ...(aiOverview.settings?.analyze || {}) } };
      const cameraItems = cameraResult.items || [];
      setSettings(loaded); setRecipientInput(recipientsText(loaded.recipients)); setRuntime(overview.runtime || null);
      setAiSettings(loadedAi); setAiRuntime(aiOverview.runtime || null); setDeliveries(history.items || []); setCameras(cameraItems);
      setAiTestCamera((current) => current || cameraItems[0]?.id || ''); setError('');
    } catch (reason) { setError(localizedUiError(t, reason, 'notifications.loadFailed')); }
    finally { setLoading(false); }
  }, [t]);

  useEffect(() => { load(); }, [load]);
  const configured = Boolean(runtime?.configured);
  const aiConfigured = Boolean(aiRuntime?.configured);
  const recipientCount = useMemo(() => parseRecipients(recipientInput).length, [recipientInput]);

  const setField = (key, value) => setSettings((current) => ({ ...current, [key]: value }));
  const setRule = (key, value) => setSettings((current) => ({ ...current, rules: { ...current.rules, [key]: value } }));
  const setAiField = (key, value) => setAiSettings((current) => ({ ...current, [key]: value }));
  const setAiSource = (key, value) => setAiSettings((current) => ({ ...current, analyze: { ...current.analyze, [key]: value } }));

  function aiPayload() {
    const payload = { ...aiSettings, analyze: { ...aiSettings.analyze } };
    if (!payload.apiKey) delete payload.apiKey;
    delete payload.apiKeyConfigured;
    return payload;
  }

  async function save(event) {
    event.preventDefault(); setSaving(true); setMessage(''); setError('');
    try {
      const emailPayload = { ...settings, recipients: parseRecipients(recipientInput) };
      if (!emailPayload.password) delete emailPayload.password;
      delete emailPayload.passwordConfigured;
      const [emailResult, aiResult] = await Promise.all([api.saveEmailNotificationSettings(emailPayload), api.saveAiEventAnalysisSettings(aiPayload())]);
      const loaded = { ...emptySettings, ...(emailResult.settings || {}), password: '', rules: { ...emptyRules, ...(emailResult.settings?.rules || {}) } };
      const loadedAi = { ...emptyAiSettings, ...(aiResult.settings || {}), apiKey: '', analyze: { ...emptyAiSettings.analyze, ...(aiResult.settings?.analyze || {}) } };
      setSettings(loaded); setRecipientInput(recipientsText(loaded.recipients)); setRuntime(emailResult.runtime || null);
      setAiSettings(loadedAi); setAiRuntime(aiResult.runtime || null); setMessage(`${t('notifications.saved')} ${t('ai.saved')}`);
    } catch (reason) { setError(localizedUiError(t, reason, 'notifications.saveFailed')); }
    finally { setSaving(false); }
  }

  async function sendTest() {
    setTesting(true); setMessage(''); setError('');
    try { await api.testEmailNotification(testRecipient.trim()); setMessage(t('notifications.testSuccess')); await load(); }
    catch (reason) { setError(localizedUiError(t, reason, 'notifications.testFailed')); }
    finally { setTesting(false); }
  }

  async function runAiTest() {
    if (!aiTestCamera) { setError(t('ai.test.noCamera')); return; }
    setAiTesting(true); setAiTestResult(null); setMessage(''); setError('');
    try {
      const saved = await api.saveAiEventAnalysisSettings(aiPayload());
      const loadedAi = { ...emptyAiSettings, ...(saved.settings || {}), apiKey: '', analyze: { ...emptyAiSettings.analyze, ...(saved.settings?.analyze || {}) } };
      setAiSettings(loadedAi); setAiRuntime(saved.runtime || null);
      const result = await api.testAiEventAnalysis(aiTestCamera, loadedAi.language);
      setAiTestResult(result); setMessage(t('ai.test.success'));
      const overview = await api.aiEventAnalysisSettings(); setAiRuntime(overview.runtime || null);
    } catch (reason) { setError(localizedUiError(t, reason, 'ai.test.failed')); }
    finally { setAiTesting(false); }
  }

  if (loading) return <div className="page"><div className="page-loading"><Mail /> {t('common.loading')}</div></div>;

  return <div className="page notifications-page">
    <header className="page-header">
      <div><span className="eyebrow">{t('notifications.eyebrow')}</span><h1>{t('notifications.title')}</h1><p>{t('notifications.description')}</p></div>
      <button type="button" className="secondary-button" onClick={load}><RefreshCw /> {t('common.refresh')}</button>
    </header>

    {(message || error) && <div className={`notification-feedback ${error ? 'error' : 'success'}`}>{error ? <AlertTriangle /> : <CheckCircle2 />}<span>{error || message}</span></div>}

    <form onSubmit={save}>
      <section className="settings-card notification-settings-card">
        <div className="section-heading notification-section-heading"><div><h2><Mail /> {t('notifications.smtp.title')}</h2><p>{t('notifications.smtp.description')}</p></div><span className={`notification-config-pill ${configured ? 'ok' : 'warning'}`}>{configured ? <CheckCircle2 /> : <AlertTriangle />}{configured ? t('notifications.configured') : t('notifications.notConfigured')}</span></div>
        <label className="notification-master-toggle"><input type="checkbox" checked={Boolean(settings.enabled)} onChange={(e) => setField('enabled', e.target.checked)} /><span><strong>{t('notifications.enabled')}</strong></span></label>
        <div className="form-grid notification-form-grid">
          <label>{t('notifications.host')}<input value={settings.host} onChange={(e)=>setField('host',e.target.value)} placeholder="smtp.example.com" /></label>
          <label>{t('notifications.port')}<input type="number" min="1" max="65535" value={settings.port} onChange={(e)=>setField('port',Number(e.target.value))} /></label>
          <label>{t('notifications.security')}<select value={settings.security} onChange={(e)=>setField('security',e.target.value)}><option value="starttls">STARTTLS</option><option value="tls">TLS / SMTPS</option><option value="none">{t('notifications.securityNone')}</option></select></label>
          <label>{t('common.username')}<input autoComplete="username" value={settings.username} onChange={(e)=>setField('username',e.target.value)} /></label>
          <label>{t('notifications.password')}<input type="password" autoComplete="new-password" value={settings.password || ''} onChange={(e)=>setField('password',e.target.value)} placeholder={settings.passwordConfigured ? t('notifications.passwordStored') : t('notifications.passwordPlaceholder')} /></label>
          <label>{t('notifications.fromName')}<input value={settings.fromName} onChange={(e)=>setField('fromName',e.target.value)} /></label>
          <label>{t('notifications.fromAddress')}<input type="email" value={settings.fromAddress} onChange={(e)=>setField('fromAddress',e.target.value)} placeholder="camera@example.com" /></label>
          <label>{t('notifications.language')}<select value={settings.language} onChange={(e)=>setField('language',e.target.value)}>{SUPPORTED_LANGUAGES.map((item)=><option key={item.code} value={item.code}>{item.nativeName}</option>)}</select></label>
          <label className="notification-recipients-field">{t('notifications.recipients')}<textarea rows="4" value={recipientInput} onChange={(e)=>setRecipientInput(e.target.value)} placeholder={'security@example.com\nadmin@example.com'} /><small>{t('notifications.recipientsHelp')} · {recipientCount}/20</small></label>
        </div>
        <label className="notification-checkbox-line"><input type="checkbox" checked={!settings.rejectUnauthorized} onChange={(e)=>setField('rejectUnauthorized',!e.target.checked)} /><span>{t('notifications.allowSelfSigned')}</span></label>
      </section>

      <section className="settings-card notification-settings-card ai-settings-card">
        <div className="section-heading notification-section-heading"><div><h2><Cpu /> {t('ai.title')}</h2><p>{t('ai.description')}</p></div><span className={`notification-config-pill ${aiConfigured ? 'ok' : 'warning'}`}>{aiConfigured ? <CheckCircle2 /> : <AlertTriangle />}{aiConfigured ? t('ai.configured') : t('ai.notConfigured')}</span></div>
        <label className="notification-master-toggle"><input type="checkbox" checked={Boolean(aiSettings.enabled)} onChange={(e)=>setAiField('enabled',e.target.checked)} /><span><strong>{t('ai.enabled')}</strong></span></label>
        <div className="form-grid notification-form-grid ai-form-grid">
          <label>{t('ai.provider')}<select value={aiSettings.provider} onChange={(e)=>setAiField('provider',e.target.value)}><option value="openai">{t('ai.provider.openai')}</option><option value="compatible">{t('ai.provider.compatible')}</option></select></label>
          <label>{t('ai.model')}<input value={aiSettings.model} onChange={(e)=>setAiField('model',e.target.value)} placeholder="gpt-5.6-luna" /></label>
          <label>{t('ai.apiKey')}<input type="password" autoComplete="new-password" value={aiSettings.apiKey || ''} onChange={(e)=>setAiField('apiKey',e.target.value)} placeholder={aiSettings.apiKeyConfigured ? t('ai.apiKeyStored') : 'sk-…'} /><small>{aiSettings.apiKeyConfigured ? t('ai.apiKeyPlaceholder') : ''}</small></label>
          {aiSettings.provider === 'compatible' && <label className="ai-wide-field">{t('ai.baseUrl')}<input value={aiSettings.baseUrl} onChange={(e)=>setAiField('baseUrl',e.target.value)} placeholder="http://127.0.0.1:1234/v1" /><small>{t('ai.baseUrlHelp')}</small></label>}
          {aiSettings.provider === 'compatible' && <label>{t('ai.apiMode')}<select value={aiSettings.apiMode} onChange={(e)=>setAiField('apiMode',e.target.value)}><option value="responses">{t('ai.apiMode.responses')}</option><option value="chat_completions">{t('ai.apiMode.chat')}</option></select></label>}
          <label>{t('ai.reasoning')}<select value={aiSettings.reasoningEffort} onChange={(e)=>setAiField('reasoningEffort',e.target.value)}><option value="none">{t('ai.reasoning.none')}</option><option value="low">{t('ai.reasoning.low')}</option><option value="medium">{t('ai.reasoning.medium')}</option><option value="high">{t('ai.reasoning.high')}</option></select></label>
          <label>{t('ai.imageDetail')}<select value={aiSettings.imageDetail} onChange={(e)=>setAiField('imageDetail',e.target.value)}><option value="low">{t('ai.imageDetail.low')}</option><option value="high">{t('ai.imageDetail.high')}</option><option value="auto">{t('ai.imageDetail.auto')}</option></select></label>
          <label>{t('ai.frames')}<input type="number" min="1" max="5" value={aiSettings.frameCount} onChange={(e)=>setAiField('frameCount',Number(e.target.value))} /></label>
          <label>{t('ai.frameInterval')}<input type="number" min="0" max="5000" step="100" value={aiSettings.frameIntervalMs} onChange={(e)=>setAiField('frameIntervalMs',Number(e.target.value))} /></label>
          <label>{t('ai.language')}<select value={aiSettings.language} onChange={(e)=>setAiField('language',e.target.value)}><option value="auto">{t('ai.languageAuto')}</option>{SUPPORTED_LANGUAGES.map((item)=><option key={item.code} value={item.code}>{item.nativeName}</option>)}</select></label>
          <label>{t('ai.cooldown')}<input type="number" min="0" max="3600" value={aiSettings.analysisCooldownSeconds} onChange={(e)=>setAiField('analysisCooldownSeconds',Number(e.target.value))} /></label>
          <label>{t('ai.timeout')}<input type="number" min="5000" max="120000" step="1000" value={aiSettings.requestTimeoutMs} onChange={(e)=>setAiField('requestTimeoutMs',Number(e.target.value))} /></label>
        </div>
        <div className="ai-source-section"><strong>{t('ai.sources.title')}</strong><div className="notification-rule-grid ai-source-grid">
          <label className="notification-rule"><input type="checkbox" checked={Boolean(aiSettings.analyze?.motion)} onChange={(e)=>setAiSource('motion',e.target.checked)} /><span><strong>{t('ai.sources.motion')}</strong></span></label>
          <label className="notification-rule"><input type="checkbox" checked={Boolean(aiSettings.analyze?.manualRecording)} onChange={(e)=>setAiSource('manualRecording',e.target.checked)} /><span><strong>{t('ai.sources.manual')}</strong></span></label>
          <label className="notification-rule"><input type="checkbox" checked={Boolean(aiSettings.analyze?.continuousRecording)} onChange={(e)=>setAiSource('continuousRecording',e.target.checked)} /><span><strong>{t('ai.sources.continuous')}</strong></span></label>
        </div></div>
        <div className="ai-mail-options">
          <label className="notification-checkbox-line"><input type="checkbox" checked={Boolean(aiSettings.includeInEmail)} onChange={(e)=>setAiField('includeInEmail',e.target.checked)} /><span>{t('ai.includeInEmail')}</span></label>
          <label className="notification-checkbox-line"><input type="checkbox" checked={Boolean(aiSettings.onlyRelevantNotifications)} onChange={(e)=>setAiField('onlyRelevantNotifications',e.target.checked)} /><span>{t('ai.onlyRelevant')}</span></label>
          {aiSettings.onlyRelevantNotifications && <small>{t('ai.onlyRelevantHelp')}</small>}
        </div>
        <div className="ai-runtime-strip"><span>{t('ai.runtime.active')}: <strong>{aiRuntime?.active || 0}</strong></span><span>{t('ai.runtime.pending')}: <strong>{aiRuntime?.pending || 0}</strong></span><span>{t('ai.runtime.success')}: <strong>{aiRuntime?.succeeded || 0}</strong></span><span>{t('ai.runtime.failed')}: <strong>{aiRuntime?.failed || 0}</strong></span></div>
      </section>

      <section className="settings-card notification-settings-card">
        <div className="section-heading"><div><h2><BellRing /> {t('notifications.rules.title')}</h2><p>{t('notifications.rules.description')}</p></div></div>
        <div className="notification-rule-grid">{['motion','cameraStatus','streamFailures','recordingFailures','systemErrors','updateOperations'].map((key)=><label key={key} className="notification-rule"><input type="checkbox" checked={Boolean(settings.rules?.[key])} onChange={(e)=>setRule(key,e.target.checked)} /><span><strong>{t(`notifications.rule.${key}`)}</strong></span></label>)}</div>
        <div className="notification-cooldown"><label>{t('notifications.cooldown')}<input type="number" min="0" max="86400" value={settings.cooldownSeconds} onChange={(e)=>setField('cooldownSeconds',Number(e.target.value))} /></label><p>{t('notifications.cooldownHelp')}</p></div>
      </section>

      <section className="settings-card notification-settings-card notification-test-card">
        <div><h2><Send /> {t('notifications.test.title')}</h2><p>{t('notifications.test.description')}</p></div>
        <div className="notification-test-row"><input type="email" value={testRecipient} onChange={(e)=>setTestRecipient(e.target.value)} placeholder={t('notifications.testRecipient')} /><button type="button" className="secondary-button" disabled={testing} onClick={sendTest}><Send /> {testing ? t('notifications.testing') : t('notifications.test')}</button></div>
      </section>

      <section className="settings-card notification-settings-card notification-test-card ai-test-card">
        <div><h2><Sparkles /> {t('ai.test.title')}</h2><p>{t('ai.test.description')}</p></div>
        <div className="notification-test-row"><select value={aiTestCamera} onChange={(e)=>setAiTestCamera(e.target.value)}><option value="">{t('ai.test.selectCamera')}</option>{cameras.map((camera)=><option key={camera.id} value={camera.id}>{camera.name || camera.id}{camera.location ? ` · ${camera.location}` : ''}</option>)}</select><button type="button" className="secondary-button" disabled={aiTesting || !cameras.length} onClick={runAiTest}><Sparkles /> {aiTesting ? t('ai.test.running') : t('ai.test.run')}</button></div>
        <AiAnalysisCard analysis={aiTestResult?.analysis} t={t} />
      </section>

      <div className="notification-save-row"><button className="primary-button" type="submit" disabled={saving}><Save /> {saving ? t('notifications.saving') : t('notifications.save')}</button></div>
    </form>

    <section className="settings-card notification-settings-card">
      <div className="section-heading"><div><h2><Clock3 /> {t('notifications.history.title')}</h2><p>{t('notifications.history.description')}</p></div></div>
      {!deliveries.length ? <div className="empty-panel compact"><Mail /><strong>{t('notifications.history.empty')}</strong></div> : <div className="notification-delivery-list">{deliveries.map((item)=><article key={item.id} className={`notification-delivery ${item.status}`}><span className={`notification-delivery-state ${item.status}`}>{item.status==='sent'?<CheckCircle2/>:item.status==='failed'?<AlertTriangle/>:<Clock3/>}{item.status === 'sent' ? t('events.outcome.success') : item.status === 'failed' ? t('events.outcome.failed') : t('notifications.status.pending')}</span><div><strong>{deliveryKind(t,item.eventKind)}</strong><small>{item.eventCode || '—'}{item.cameraName ? ` · ${item.cameraName}` : item.cameraId ? ` · ${item.cameraId}` : ''}</small></div><div className="notification-delivery-meta"><span>{item.recipientCount} {t('notifications.recipientsShort')}</span><span>{formatDate(item.sentAt || item.createdAt,{dateStyle:'short',timeStyle:'medium'})}</span></div>{item.error && <p title={item.error}>{item.error}</p>}</article>)}</div>}
    </section>

    <aside className="notification-security-note ai-security-note"><ShieldCheck /><div><strong>{t('ai.privacy.title')}</strong><p>{t('ai.privacy.body')}</p></div></aside>
    <aside className="notification-security-note"><ShieldCheck /><div><strong>{t('notifications.securityNote.title')}</strong><p>{t('notifications.securityNote.body')}</p></div></aside>
  </div>;
}
