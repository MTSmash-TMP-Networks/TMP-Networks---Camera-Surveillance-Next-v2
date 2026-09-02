import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { CalendarClock, CalendarDays, Camera, ChevronDown, ChevronRight, Clapperboard, Clock, Download, FileArchive, HardDrive, Play, RefreshCw, Save, Sparkles, Square, Trash2, X, Zap } from 'lucide-react';
import { api } from '../services/api.js';
import { loadCameras } from '../features/cameras/camerasSlice.js';
import { RecordingPlanEditor } from '../components/RecordingPlanEditor.jsx';
import { RetentionPolicyEditor } from '../components/RetentionPolicyEditor.jsx';
import { RecordingArchivePlayer } from '../components/RecordingArchivePlayer.jsx';
import { RecordingStorageSettings } from '../components/RecordingStorageSettings.jsx';
import { validateRecordingPlans } from '../services/scheduleValidation.js';
import { useI18n } from '../i18n/index.js';

function duration(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = Math.floor(value % 60);
  return [hours, minutes, secs].map((part) => String(part).padStart(2, '0')).join(':');
}
function size(bytes) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes); let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}
function RecordingAiAnalysis({ analysis, t }) {
  if (!analysis) return null;
  return <div className={`recording-ai-analysis priority-${analysis.priority || 'normal'}`} title={`${t('ai.confidence')}: ${Math.round(Number(analysis.confidence || 0) * 100)}%`}><strong><Sparkles/> {analysis.title || t('ai.analysis')}</strong><p>{analysis.description}</p></div>;
}
function statusLabel(recording, t) {
  if (recording.status === 'ready') return t('recordings.status.ready');
  if (recording.status === 'ready_with_gaps') return t('recordings.status.readyWithGaps', { count: recording.interruptions || 0 });
  if (recording.status === 'failed') return t('recordings.status.failed');
  if (recording.status === 'recording') return t('recordings.status.recording');
  return recording.status || t('recordings.status.unknown');
}
function dateTime(value, locale, t) {
  if (!value) return t('recordings.status.open');
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? t('recordings.status.unknown') : new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }).format(date);
}
function timeOnly(value, locale, t) {
  if (!value) return t('recordings.status.open');
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? t('recordings.status.unknown') : new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
}
function recordingRange(recording, locale, t) {
  const start = recording.timelineStartedAt || recording.startedAt;
  const end = recording.status === 'recording' ? null : (recording.timelineEndedAt || recording.endedAt);
  return t('recordings.archive.rangeValue', { start: dateTime(start, locale, t), end: end ? dateTime(end, locale, t) : t('recordings.status.running') });
}
function playableBlockCount(recording) {
  return Number(recording?.playableBlockCount || recording?.blocks || 0);
}
function sanitizeRetentionPolicy(policy) {
  const number = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  };
  return {
    strategy: ['none', 'age', 'quota', 'hybrid'].includes(policy?.strategy) ? policy.strategy : 'hybrid',
    cleanupEnabled: Boolean(policy?.cleanupEnabled),
    maxAgeDays: Math.max(0, Math.min(3650, number(policy?.maxAgeDays, 30))),
    eventMaxAgeDays: Math.max(0, Math.min(3650, number(policy?.eventMaxAgeDays, 30))),
    maxStorageBytes: Math.max(0, number(policy?.maxStorageBytes, 0)),
    minFreeBytes: Math.max(0, number(policy?.minFreeBytes, 0)),
    maxRecordings: Math.max(0, Math.min(10000000, number(policy?.maxRecordings, 0))),
    protectEventRecordings: Boolean(policy?.protectEventRecordings),
    blockSeconds: Math.max(30, Math.min(3600, number(policy?.blockSeconds, 300))),
  };
}
function defaultDate() {
  return new Date().toISOString().slice(0, 10);
}
function localTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
}
function saveDownload(blob, filename = 'tmp-camera-export.zip') {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename || 'tmp-camera-export.zip';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function cameraIp(camera, t) {
  return camera?.onvif?.ip || camera?.ip || camera?.address || t('recordings.camera.unknownIp');
}
function cameraLabel(camera, t) {
  if (!camera) return t('recordings.camera.noneShort');
  return `${camera.name || t('recordings.camera.default')} · ${cameraIp(camera, t)}`;
}
function modeSummary(plan, t) {
  if (plan.mode === 'continuous') return t('recordings.plan.modeContinuous');
  if (plan.mode === 'event') return t('recordings.plan.modeEvent');
  return t('recordings.plan.range', { start: plan.startTime || '00:00', end: plan.endTime || '23:59' });
}
function triggerLabel(value, t) {
  const key = {
    manual: 'recordings.trigger.manual', continuous: 'recordings.trigger.continuous', scheduled: 'recordings.trigger.scheduled',
    event: 'recordings.trigger.event', motion: 'recordings.trigger.motion', sensor: 'recordings.trigger.sensor', analytics: 'recordings.trigger.analytics',
  }[String(value || '').toLowerCase()];
  return key ? t(key) : (value || t('recordings.trigger.manual'));
}
function retentionStrategyLabel(value, t) {
  const key = { none: 'recordings.retention.strategyNone', age: 'recordings.retention.strategyAge', quota: 'recordings.retention.strategyQuota', hybrid: 'recordings.retention.strategyHybrid' }[value];
  return key ? t(key) : String(value || '—');
}
function recordingErrorMessage(error, { t, locale }) {
  const code = String(error?.code || '');
  const key = code ? `recordings.error.${code}` : '';
  if (key && t(key) !== key) return t(key);
  if (locale === 'de' && error?.message) return error.message;
  if (/^HTTP\s+\d+/i.test(String(error?.message || ''))) return error.message;
  return t('recordings.error.generic', { code: code || 'UNKNOWN' });
}
function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
function minuteOfDay(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 0;
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}
function timelineLeft(iso) {
  return clamp((minuteOfDay(iso) / 1440) * 100);
}
function timelineWidth(startIso, endIso) {
  const start = minuteOfDay(startIso);
  const end = minuteOfDay(endIso);
  const width = ((Math.max(end, start + 1) - start) / 1440) * 100;
  return clamp(width, 0.35, 100);
}
function timelineMarkers() {
  return Array.from({ length: 13 }, (_, index) => ({ hour: index * 2, left: (index / 12) * 100 }));
}
function intervalSummary(interval, locale, t) {
  const parts = [t('recordings.timeline.intervalRange', { start: timeOnly(interval.startIso, locale, t), end: timeOnly(interval.endIso, locale, t) }), t('recordings.timeline.blocksCount', { count: interval.blockCount })];
  if (interval.isRecording) parts.push(t('recordings.timeline.running'));
  if (interval.hasGaps) parts.push(t('recordings.timeline.withGaps'));
  return parts.join(' · ');
}

export function RecordingsPage() {
  const { t, locale } = useI18n();
  const dispatch = useDispatch();
  const cameras = useSelector((state) => state.cameras.items);
  const user = useSelector((state) => state.auth.user);
  const [tab, setTab] = useState('archive');
  const [cameraId, setCameraId] = useState('');
  const [items, setItems] = useState([]);
  const [active, setActive] = useState([]);
  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const [playing, setPlaying] = useState(null);
  const [plans, setPlans] = useState([]);
  const [retention, setRetention] = useState(null);
  const [scheduler, setScheduler] = useState(null);
  const [motionStatus, setMotionStatus] = useState(null);
  const [retentionStatus, setRetentionStatus] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  const [cleanupResult, setCleanupResult] = useState(null);
  const [exportForm, setExportForm] = useState({ cameraId: '', date: defaultDate(), startTime: '08:00', endTime: '12:00', timezone: localTimezone(), caseReference: '', notes: '' });
  const [exportPreview, setExportPreview] = useState(null);
  const [exportTimeline, setExportTimeline] = useState(null);
  const [archiveDate, setArchiveDate] = useState(defaultDate());
  const [archiveTimeline, setArchiveTimeline] = useState(null);
  const [timelineHint, setTimelineHint] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const allowed = ['admin', 'operator'].includes(user?.role);
  const cameraNames = useMemo(() => Object.fromEntries(cameras.map((camera) => [camera.id, camera.name])), [cameras]);
  const planningCameraId = cameraId || cameras[0]?.id || '';
  const exportCameraId = exportForm.cameraId || cameraId || cameras[0]?.id || '';
  const planningCamera = useMemo(() => cameras.find((camera) => camera.id === planningCameraId) || null, [cameras, planningCameraId]);
  const activePlans = useMemo(() => plans.filter((plan) => plan.enabled !== false), [plans]);
  const archivedItems = useMemo(() => items.filter((item) => item.status !== 'recording'), [items]);
  const archiveTotals = useMemo(() => archivedItems.reduce((summary, recording) => ({
    durationSeconds: summary.durationSeconds + Number(recording.durationSeconds || 0),
    fileSizeBytes: summary.fileSizeBytes + Number(recording.fileSizeBytes || 0),
  }), { durationSeconds: 0, fileSizeBytes: 0 }), [archivedItems]);
  const headerCameraValue = tab === 'archive' ? cameraId : tab === 'export' ? exportCameraId : planningCameraId;

  async function loadArchive() {
    try {
      const result = await api.recordings(cameraId);
      setItems(result.items || []); setActive(result.active || []); setError('');
    } catch (e) { setError(recordingErrorMessage(e, { t, locale })); }
  }

  async function loadArchiveTimeline() {
    if (!archiveDate) return;
    try {
      const result = await api.recordingEvidenceTimeline({ cameraId: cameraId || undefined, date: archiveDate, timezone: localTimezone() });
      setArchiveTimeline(result);
      setTimelineHint('');
    } catch (e) { setTimelineHint(recordingErrorMessage(e, { t, locale })); }
  }

  async function refreshArchive() {
    await Promise.allSettled([loadArchive(), loadArchiveTimeline()]);
  }

  async function refreshCurrentTab() {
    if (tab === 'archive') return refreshArchive();
    if (tab === 'planning') return loadPlanning();
    if (tab === 'storage') return undefined;
    return loadExportTimeline();
  }

  async function openTimelineInterval(entry, interval) {
    setError('');
    setTimelineHint('');
    if (entry?.camera?.id) setCameraId(entry.camera.id);
    const ids = Array.isArray(interval?.recordingIds) ? interval.recordingIds : [];
    const localRecording = [...active, ...items].find((item) => ids.includes(item.id));
    const targetId = localRecording?.id || ids[0];
    if (!targetId) {
      setTimelineHint(t('recordings.timeline.noPlayableRange'));
      return;
    }
    try {
      const token = await api.recordingToken(targetId);
      setPlaying({ ...(localRecording || {}), id: targetId, cameraId: entry.camera.id, startedAt: interval.startIso, endedAt: interval.endIso, url: token.url, format: token.format || 'file' });
    } catch (e) { setError(recordingErrorMessage(e, { t, locale })); }
  }

  function selectTimelineForExport(entry, interval) {
    updateExportForm({ cameraId: entry.camera.id, date: archiveDate, startTime: interval.startTime, endTime: interval.endTime });
    setTab('export');
  }

  async function loadPlanning() {
    if (!planningCameraId) return;
    try {
      const [planResult, policy, schedulerResult, motionResult, cleanupStatus, recordingCapabilities] = await Promise.all([
        api.recordingPlans(planningCameraId), api.retentionPolicy(planningCameraId), api.recordingSchedulerStatus(), api.motionDetectionStatus(), api.retentionStatus(), api.recordingCapabilities(),
      ]);
      setPlans(planResult.items || []);
      setRetention(policy);
      setScheduler(schedulerResult);
      setMotionStatus(motionResult);
      setRetentionStatus(cleanupStatus);
      setCapabilities(recordingCapabilities);
      setError('');
    } catch (e) { setError(recordingErrorMessage(e, { t, locale })); }
  }

  async function loadExportTimeline() {
    if (!exportForm.date || !exportForm.timezone) return;
    try {
      const result = await api.recordingEvidenceTimeline({ date: exportForm.date, timezone: exportForm.timezone });
      setExportTimeline(result);
      setError('');
    } catch (e) { setError(recordingErrorMessage(e, { t, locale })); }
  }

  useEffect(() => { dispatch(loadCameras()); }, [dispatch]);
  useEffect(() => {
    if (!cameras.length) return;
    if (cameraId && !cameras.some((camera) => camera.id === cameraId)) setCameraId('');
  }, [cameras, cameraId]);
  useEffect(() => {
    if (cameras.length && (!exportForm.cameraId || !cameras.some((camera) => camera.id === exportForm.cameraId))) setExportForm((current) => ({ ...current, cameraId: cameraId || cameras[0].id }));
  }, [cameras, cameraId, exportForm.cameraId]);
  useEffect(() => {
    if (tab !== 'archive') return undefined;
    const initial = setTimeout(refreshArchive, 0);
    const timer = setInterval(refreshArchive, 7000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [cameraId, archiveDate, tab, locale]);
  useEffect(() => { if (tab === 'planning') loadPlanning(); }, [tab, planningCameraId, locale]);
  useEffect(() => {
    if (tab !== 'export') return undefined;
    const initial = setTimeout(loadExportTimeline, 0);
    const timer = setInterval(loadExportTimeline, 10000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [tab, exportForm.date, exportForm.timezone, cameras.length, locale]);

  function changeHeaderCamera(value) {
    if (tab === 'export') updateExportForm({ cameraId: value });
    else setCameraId(value);
  }

  async function stop(recording) {
    setBusy(true); try { await api.stopRecording(recording.id); await loadArchive(); } catch (e) { setError(recordingErrorMessage(e, { t, locale })); } finally { setBusy(false); }
  }
  async function remove(recording) {
    if (!window.confirm(t('recordings.archive.deleteConfirm', { filename: recording.filename }))) return;
    setBusy(true); try { await api.deleteRecording(recording.id); await loadArchive(); } catch (e) { setError(recordingErrorMessage(e, { t, locale })); } finally { setBusy(false); }
  }
  async function open(recording, download = false) {
    try {
      const token = await api.recordingToken(recording.id);
      if (download) window.location.assign(token.downloadUrl);
      else setPlaying({ ...recording, url: token.url, format: token.format || 'file' });
    } catch (e) { setError(recordingErrorMessage(e, { t, locale })); }
  }
  async function savePlanning() {
    const validationErrors = validateRecordingPlans(plans, { prebufferMaxSeconds: capabilities?.recordingPrebufferMaxSeconds || 10, t });
    if (validationErrors.length) { setError(validationErrors.join(' ')); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.saveRecordingPlanning(planningCameraId, { plans, retention: sanitizeRetentionPolicy(retention) });
      setPlans(result.plans || []); setRetention(result.retention);
      setNotice(t('recordings.notice.planningSaved'));
      setScheduler(await api.recordingSchedulerStatus());
      setMotionStatus(await api.motionDetectionStatus());
    } catch (e) {
      setError(recordingErrorMessage(e, { t, locale }));
    }
    finally { setBusy(false); }
  }
  async function cleanup(dryRun) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.cleanupRecordings({ cameraId: planningCameraId, dryRun });
      setCleanupResult(result);
      setNotice(dryRun ? t('recordings.notice.cleanupPreview', { count: result.candidates }) : t('recordings.notice.cleanupDone', { count: result.deleted, size: size(result.freedBytes) }));
      setRetentionStatus(await api.retentionStatus());
      if (!dryRun) await loadArchive();
    } catch (e) { setError(recordingErrorMessage(e, { t, locale })); }
    finally { setBusy(false); }
  }
  async function testMotionEvent() {
    setBusy(true); setError('');
    try {
      await api.createRecordingEvent({ cameraId: planningCameraId, type: 'motion', source: 'ui-test', state: 'pulse', durationSeconds: 20, severity: 'info', metadata: { test: true } });
      if (user?.role === 'admin') await api.runRecordingScheduler();
      setNotice(t('recordings.notice.motionTest'));
    } catch (e) { setError(recordingErrorMessage(e, { t, locale })); }
    finally { setBusy(false); }
  }
  function updateExportForm(patch) {
    setExportPreview(null);
    setExportForm((current) => ({ ...current, ...patch }));
  }
  async function previewExport() {
    setExportBusy(true); setError(''); setNotice('');
    try {
      const preview = await api.recordingEvidencePreview({ ...exportForm, cameraId: exportCameraId });
      setExportPreview(preview);
      setNotice(preview.empty ? t('recordings.notice.noExportBlocks') : t('recordings.notice.exportPreview', { blocks: preview.blockCount, recordings: preview.recordingCount }));
    } catch (e) { setError(recordingErrorMessage(e, { t, locale })); }
    finally { setExportBusy(false); }
  }
  async function downloadExport() {
    setExportBusy(true); setError(''); setNotice('');
    try {
      const result = await api.recordingEvidenceExport({ ...exportForm, cameraId: exportCameraId });
      saveDownload(result.blob, result.filename || 'tmp-camera-evidence-export.zip');
      setNotice(t('recordings.notice.exportDone'));
      setExportPreview(null);
    } catch (e) { setError(recordingErrorMessage(e, { t, locale })); }
    finally { setExportBusy(false); }
  }

  const motionCameraStatus = motionStatus?.cameras?.find((item) => item.cameraId === planningCameraId);
  const changedPercent = Math.round((motionCameraStatus?.lastChangedRatio || 0) * 1000) / 10;
  const windowMotionFrames = motionCameraStatus?.motionWindow?.motionFrames ?? 0;
  const windowTotalFrames = motionCameraStatus?.motionWindow?.totalFrames ?? 0;
  const motionDiagnostic = motionCameraStatus?.lastError
    ? (locale === 'de' ? t('recordings.planning.errorValue', { error: motionCameraStatus.lastError }) : t('recordings.planning.analysisError'))
    : motionCameraStatus?.lastEventAt
      ? t('recordings.planning.lastEventStatus', {
        time: dateTime(motionCameraStatus.lastEventAt, locale, t),
        state: motionCameraStatus.motionActive ? t('recordings.planning.stateActive') : t('recordings.planning.stateReady'),
        armed: motionCameraStatus.motionArmed === false ? t('recordings.planning.waitingStill') : t('recordings.planning.armed'),
        motion: windowMotionFrames,
        total: windowTotalFrames,
      })
      : motionCameraStatus?.lastCheckedAt
        ? t('recordings.planning.lastCheckStatus', {
          time: timeOnly(motionCameraStatus.lastCheckedAt, locale, t), changed: changedPercent,
          armed: motionCameraStatus.motionArmed === false ? t('recordings.planning.rearming') : t('recordings.planning.armed'),
          source: motionCameraStatus.source || motionStatus?.source || 'live',
        })
        : t('recordings.planning.motionDefault');
  const motionTitle = motionStatus?.enabled
    ? (motionCameraStatus?.lastError ? t('recordings.planning.analysisErrorTitle') : motionCameraStatus?.motionActive ? t('recordings.planning.motionActive') : motionCameraStatus?.watched ? t('recordings.planning.analysisActive') : motionStatus?.running ? t('recordings.planning.analysisReady') : t('recordings.planning.analysisWaiting'))
    : t('recordings.planning.disabled');

  return <div className="page recordings-page">
    <header className="page-header"><div><span className="eyebrow">{t('recordings.eyebrow')}</span><h1>{t('recordings.title')}</h1><p>{t('recordings.description')}</p></div>{tab !== 'storage' && <div className="header-actions"><select aria-label={t('recordings.camera.selector')} value={headerCameraValue || ''} onChange={(event) => changeHeaderCamera(event.target.value)} disabled={!cameras.length}>{tab === 'archive' && <option value="">{t('recordings.camera.all')}</option>}{!cameras.length && <option value="">{t('live.noCamera')}</option>}{cameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.name}</option>)}</select><button className="secondary-button" onClick={refreshCurrentTab}><RefreshCw/> {t('common.refresh')}</button></div>}</header>
    <nav className="recording-tabs"><button className={tab === 'archive' ? 'active' : ''} onClick={() => setTab('archive')}><Clapperboard/> {t('recordings.tabs.archive')}</button><button className={tab === 'export' ? 'active' : ''} onClick={() => setTab('export')}><FileArchive/> {t('recordings.tabs.export')}</button><button className={tab === 'planning' ? 'active' : ''} onClick={() => setTab('planning')}><CalendarClock/> {t('recordings.tabs.planning')}</button>{user?.role === 'admin' && <button className={tab === 'storage' ? 'active' : ''} onClick={() => setTab('storage')}><HardDrive/> {t('recordings.tabs.storage')}</button>}</nav>
    {error && <div className="form-error">{error}</div>}
    {notice && <div className="form-success">{notice}</div>}

    {tab === 'archive' && <>
      <section className="recording-workflow-cards"><article><Clapperboard/><span><strong>{t('recordings.workflow.archive.title')}</strong><small>{t('recordings.workflow.archive.description')}</small></span></article><article><CalendarClock/><span><strong>{t('recordings.workflow.planning.title')}</strong><small>{t('recordings.workflow.planning.description')}</small></span></article><article><FileArchive/><span><strong>{t('recordings.workflow.export.title')}</strong><small>{t('recordings.workflow.export.description')}</small></span></article></section>
      <section className="recording-day-timeline"><header><div><strong>{t('recordings.timeline.title')}</strong><small>{t('recordings.timeline.description')}</small></div><label>{t('recordings.timeline.date')}<input type="date" value={archiveDate} onChange={(event) => setArchiveDate(event.target.value)}/></label></header>{timelineHint && <p className="timeline-hint">{timelineHint}</p>}<div className="timeline-hour-scale">{timelineMarkers().map((marker) => <span key={marker.hour} style={{ left: `${marker.left}%` }}>{String(marker.hour).padStart(2, '0')}:00</span>)}</div><div className="timeline-camera-list">{archiveTimeline?.cameras?.filter((entry) => !entry.empty).map((entry) => <article key={entry.camera.id} className={entry.camera.id === cameraId ? 'selected' : ''}><header><button type="button" onClick={() => setCameraId(entry.camera.id)}><Camera/> <span>{entry.camera.name}</span></button><small>{t('recordings.timeline.rangeBlockMeta', { ranges: entry.intervals.length, blocks: entry.intervals.reduce((sum, interval) => sum + Number(interval.blockCount || 0), 0) })}</small></header><div className="timeline-track" aria-label={t('recordings.timeline.aria', { camera: entry.camera.name })}>{timelineMarkers().slice(0, -1).map((marker) => <i key={marker.hour} style={{ left: `${marker.left}%` }}/>) }{entry.intervals.map((interval) => <button key={`${entry.camera.id}-${interval.startIso}`} type="button" className={`timeline-segment ${interval.hasGaps ? 'has-gaps' : ''} ${interval.isRecording ? 'is-recording' : ''}`} style={{ left: `${timelineLeft(interval.startIso)}%`, width: `${timelineWidth(interval.startIso, interval.endIso)}%` }} onClick={() => openTimelineInterval(entry, interval)} title={`${entry.camera.name}: ${intervalSummary(interval, locale, t)}`}><span>{timeOnly(interval.startIso, locale, t)}</span></button>)}</div><footer>{entry.intervals.map((interval) => <button key={`${entry.camera.id}-${interval.startIso}-label`} type="button" onClick={() => openTimelineInterval(entry, interval)} onDoubleClick={() => selectTimelineForExport(entry, interval)}><strong>{timeOnly(interval.startIso, locale, t)} – {timeOnly(interval.endIso, locale, t)}</strong><small>{t('recordings.timeline.blocksCount', { count: interval.blockCount })}{interval.isRecording ? ` · ${t('recordings.timeline.running')}` : ''}{interval.hasGaps ? ` · ${t('recordings.timeline.gaps')}` : ''}</small></button>)}</footer></article>)}{archiveTimeline && !archiveTimeline.totalIntervals && <div className="empty-panel"><Clock/><h2>{t('recordings.timeline.emptyTitle')}</h2><p>{t('recordings.timeline.emptyDescription')}</p></div>}</div><p className="timeline-help">{t('recordings.timeline.help')}</p></section>
      {active.length > 0 && <section className="active-recordings"><h2>{t('recordings.active.title')}</h2>{active.map((recording) => <article key={recording.id}><span className="recording-pulse"/><div><strong>{cameraNames[recording.cameraId] || recording.cameraId}</strong><small>{recording.triggerType === 'manual' ? t('recordings.trigger.manual') : t('recordings.active.automaticTrigger', { trigger: triggerLabel(recording.triggerType, t) })} · {duration(recording.elapsedSeconds)}{playableBlockCount(recording) ? ` · ${t('recordings.active.playableBlocks', { count: playableBlockCount(recording) })}` : ` · ${t('recordings.active.waitingFirstBlock')}`}{recording.recovering ? ` · ${t('recordings.active.reconnecting')}` : ''}{recording.interruptions ? ` · ${t('recordings.active.interruptions', { count: recording.interruptions })}` : ''}</small><RecordingAiAnalysis analysis={recording.metadata?.aiAnalysis} t={t}/></div><div className="recording-actions active-actions">{playableBlockCount(recording) > 0 && <><button onClick={() => open(recording)} title={t('recordings.active.playPartial')}><Play/></button><button onClick={() => open(recording, true)} title={t('recordings.active.downloadPartial')}><Download/></button></>}{allowed && <button className="stop-button" onClick={() => stop(recording)} disabled={busy}><Square/> {t('live.stopRecording')}</button>}</div></article>)}</section>}
      {archivedItems.length > 0 && <section className={`recording-archive-stack ${archiveExpanded ? 'expanded' : 'collapsed'}`}>
        <button className="recording-archive-toggle" type="button" aria-expanded={archiveExpanded} aria-controls="recording-archive-list" onClick={() => setArchiveExpanded((value) => !value)}>
          <span className="recording-archive-toggle-icon"><Clapperboard/></span>
          <span className="recording-archive-toggle-copy"><strong>{t('recordings.tabs.archive')}</strong><small>{t('recordings.export.recordingsLabel', { count: archivedItems.length })} · {duration(archiveTotals.durationSeconds)} · {size(archiveTotals.fileSizeBytes)}</small></span>
          <span className="recording-archive-toggle-chevron">{archiveExpanded ? <ChevronDown/> : <ChevronRight/>}</span>
        </button>
        {archiveExpanded && <div className="recording-list" id="recording-archive-list">
          {archivedItems.map((recording) => <article key={recording.id} className={`recording-row status-${recording.status}`}><div className="recording-icon"><Clapperboard/></div><div className="recording-main"><strong>{cameraNames[recording.cameraId] || t('recordings.camera.default')}</strong><span>{t('recordings.archive.rangeLabel')}: {recordingRange(recording, locale, t)} · {triggerLabel(recording.triggerType, t)}</span><small>{recording.filename}{recording.playableBlockCount ? ` · ${t('recordings.timeline.blocksCount', { count: recording.playableBlockCount })}` : ''}{recording.damagedBlockCount ? ` · ${t('recordings.archive.damaged', { count: recording.damagedBlockCount })}` : ''}{recording.gapSeconds ? ` · ${t('recordings.archive.gap', { seconds: Number(recording.gapSeconds).toFixed(1) })}` : ''}</small><RecordingAiAnalysis analysis={recording.metadata?.aiAnalysis} t={t}/></div><div className="recording-metrics"><span>{duration(recording.durationSeconds)}</span><span>{size(recording.fileSizeBytes)}</span><em>{statusLabel(recording, t)}</em></div><div className="recording-actions">{['ready', 'ready_with_gaps'].includes(recording.status) && <><button onClick={() => open(recording)} title={t('recordings.archive.play')}><Play/></button><button onClick={() => open(recording, true)} title={t('recordings.archive.download')}><Download/></button></>}{allowed && <button onClick={() => remove(recording)} title={t('recordings.archive.delete')}><Trash2/></button>}</div></article>)}
        </div>}
      </section>}
      {!archivedItems.length && !active.length && <div className="empty-panel"><Clapperboard/><h2>{t('recordings.archive.emptyTitle')}</h2><p>{t('recordings.archive.emptyDescription')}</p></div>}
    </>}

    {tab === 'export' && <section className="evidence-export-page">
      <div className="planner-section evidence-export-card">
        <header><div><CalendarDays/><span><strong>{t('recordings.export.title')}</strong><small>{t('recordings.export.description')}</small></span></div></header>
        <div className="planner-grid evidence-export-grid">
          <label>{t('recordings.export.camera')}<select value={exportCameraId} onChange={(event) => updateExportForm({ cameraId: event.target.value })}>{cameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.name}</option>)}</select></label>
          <label>{t('recordings.export.date')}<input type="date" value={exportForm.date} onChange={(event) => updateExportForm({ date: event.target.value })}/></label>
          <label>{t('recordings.export.from')}<input type="time" value={exportForm.startTime} onChange={(event) => updateExportForm({ startTime: event.target.value })}/></label>
          <label>{t('recordings.export.to')}<input type="time" value={exportForm.endTime} onChange={(event) => updateExportForm({ endTime: event.target.value })}/></label>
          <label>{t('recordings.export.timezone')}<input value={exportForm.timezone} onChange={(event) => updateExportForm({ timezone: event.target.value })}/></label>
          <label>{t('recordings.export.caseReference')}<input value={exportForm.caseReference} onChange={(event) => updateExportForm({ caseReference: event.target.value })} placeholder={t('recordings.export.optional')}/></label>
          <label className="wide-field">{t('recordings.export.notes')}<input value={exportForm.notes} onChange={(event) => updateExportForm({ notes: event.target.value })} placeholder={t('recordings.export.notesPlaceholder')}/></label>
        </div>
        <div className="planner-savebar evidence-export-actions"><button className="secondary-button" onClick={previewExport} disabled={!allowed || exportBusy || !exportCameraId}><RefreshCw/> {t('recordings.export.check')}</button><button className="primary-button" onClick={downloadExport} disabled={!allowed || exportBusy || !exportCameraId}><Download/> {exportBusy ? t('recordings.export.building') : t('recordings.export.download')}</button></div>
      </div>
      <div className="evidence-timeline-panel"><strong>{t('recordings.export.availableTitle', { date: exportForm.date })}</strong><p>{t('recordings.export.availableDescription')}</p>{exportTimeline?.totalIntervals ? <div className="evidence-timeline-list">{exportTimeline.cameras.filter((entry) => !entry.empty).map((entry) => <article key={entry.camera.id} className={entry.camera.id === exportCameraId ? 'selected' : ''}><header><span>{entry.camera.name}</span><small>{entry.camera.ip || t('recordings.camera.unknownIp')}</small></header>{entry.intervals.map((interval) => <button key={`${entry.camera.id}-${interval.startIso}`} type="button" onClick={() => updateExportForm({ cameraId: entry.camera.id, startTime: interval.startTime, endTime: interval.endTime })}><strong>{timeOnly(interval.startIso, locale, t)} – {timeOnly(interval.endIso, locale, t)}</strong><small>{t('recordings.export.intervalSummary', { recordings: interval.recordingCount, blocks: interval.blockCount, duration: duration(interval.mediaDurationSeconds) })}{interval.hasGaps ? `, ${t('recordings.export.gapSummary', { seconds: Number(interval.gapSeconds || 0).toFixed(1) })}` : ''}</small></button>)}</article>)}</div> : <p>{t('recordings.export.noPeriods')}</p>}</div>
      {exportPreview && <div className={`evidence-export-preview ${exportPreview.empty ? 'empty' : ''}`}><strong>{exportPreview.empty ? t('recordings.export.previewEmpty') : t('recordings.export.previewTitle')}</strong><span>{t('recordings.archive.rangeValue', { start: exportPreview.startLocal, end: exportPreview.endLocal })}</span><div><small>{t('recordings.export.cameraLabel', { camera: exportPreview.camera?.name || t('recordings.camera.default') })}</small><small>{t('recordings.export.recordingsLabel', { count: exportPreview.recordingCount })}</small><small>{t('recordings.export.blocksLabel', { count: exportPreview.blockCount })}</small><small>{t('recordings.export.mediaDuration', { duration: duration(exportPreview.mediaDurationSeconds) })}</small><small>{t('recordings.export.dataSize', { size: size(exportPreview.fileSizeBytes) })}</small></div>{!exportPreview.empty && <p>{t('recordings.export.blockNote')}</p>}</div>}
    </section>}

    {tab === 'planning' && <section className="recording-planning-page">
      {!planningCameraId ? <div className="empty-panel"><CalendarClock/><h2>{t('live.noCamera')}</h2></div> : <>
        <section className="planning-overview"><article className="planning-camera-card"><Camera/><span><small>{t('recordings.planning.selectedCamera')}</small><strong>{cameraLabel(planningCamera, t)}</strong><em>{t('recordings.planning.allRules')}</em></span></article><article><Clock/><span><small>{t('recordings.planning.scheduler')}</small><strong>{scheduler?.running ? t('recordings.planning.active') : t('recordings.planning.inactive')}</strong><em>{scheduler?.lastCompletedAt ? t('recordings.planning.lastCheck', { time: dateTime(scheduler.lastCompletedAt, locale, t) }) : t('recordings.planning.noCheck')}</em></span></article><article><Zap/><span><small>{t('recordings.planning.motion')}</small><strong>{motionTitle}</strong><em>{motionDiagnostic}</em></span></article><article><HardDrive/><span><small>{t('recordings.planning.retention')}</small><strong>{retentionStatus?.running ? t('recordings.planning.cleanupActive') : t('recordings.planning.cleanupInactive')}</strong><em>{retention?.cleanupEnabled ? t('recordings.planning.rule', { rule: retentionStrategyLabel(retention.strategy, t) }) : t('recordings.planning.noCleanup')}</em></span></article></section>
        <section className="recording-mode-guide"><article><strong>{t('recordings.guide.typeTitle')}</strong><span>{t('recordings.guide.typeDescription')}</span></article><article><strong>{t('recordings.guide.retentionTitle')}</strong><span>{t('recordings.guide.retentionDescription')}</span></article><article><strong>{t('recordings.guide.exportTitle')}</strong><span>{t('recordings.guide.exportDescription')}</span></article></section>
        <div className="planner-status-row"><span className={scheduler?.running ? 'ok' : 'warn'}>{t('recordings.planning.schedulerState', { state: scheduler?.running ? t('recordings.planning.active') : t('recordings.planning.inactive') })}</span><span className={retentionStatus?.running ? 'ok' : 'warn'}>{t('recordings.planning.cleanupState', { state: retentionStatus?.running ? t('recordings.planning.active') : t('recordings.planning.inactive') })}</span>{activePlans.length > 0 && <small>{t('recordings.planning.activePlans', { count: activePlans.length, plans: activePlans.slice(0, 3).map((plan) => modeSummary(plan, t)).join(', '), more: activePlans.length > 3 ? ' …' : '' })}</small>}</div>
        <RecordingPlanEditor plans={plans} onChange={setPlans} disabled={!allowed || busy} prebufferMaxSeconds={capabilities?.recordingPrebufferMaxSeconds || 10}/>
        <RetentionPolicyEditor policy={retention} onChange={setRetention} disabled={!allowed || busy} onCleanup={cleanup} cleanupBusy={busy}/>
        {cleanupResult && <div className="cleanup-preview"><strong>{cleanupResult.dryRun ? t('recordings.cleanup.previewTitle') : t('recordings.cleanup.resultTitle')}</strong><span>{t('recordings.cleanup.summary', { candidates: cleanupResult.candidates, deleted: cleanupResult.deleted, size: size(cleanupResult.freedBytes) })}</span>{cleanupResult.items?.slice(0, 10).map((item) => <small key={item.recordingId}>#{item.recordingId}: {(item.reasons || []).join(', ')}</small>)}</div>}
        <div className="planner-savebar">{allowed && <button className="secondary-button" onClick={testMotionEvent} disabled={busy}><Zap/> {t('recordings.planning.testMotion')}</button>}<button className="primary-button" onClick={savePlanning} disabled={!allowed || busy || !retention}><Save/> {busy ? t('recordings.planning.processing') : t('recordings.planning.save')}</button></div>
      </>}
    </section>}

    {tab === 'storage' && <RecordingStorageSettings canConfigure={user?.role === 'admin'}/>}

    {playing && <div className="video-modal" role="dialog" aria-modal="true"><div className="video-modal-card"><header><div><strong>{cameraNames[playing.cameraId] || t('live.recording')}</strong><small>{dateTime(playing.startedAt, locale, t)}</small></div><button onClick={() => setPlaying(null)} aria-label={t('recordings.modal.close')}><X/></button></header><RecordingArchivePlayer source={playing}/></div></div>}
  </div>;
}
