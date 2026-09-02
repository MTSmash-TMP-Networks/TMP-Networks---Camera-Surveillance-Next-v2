import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Camera, Circle, Download, FileSearch, MonitorPlay, MoreHorizontal, Pencil, RefreshCw, Square, Volume2 } from 'lucide-react';
import { loadCameras } from '../features/cameras/camerasSlice.js';
import { SeamlessLivePlayer } from '../components/SeamlessLivePlayer.jsx';
import { CameraLogPanel } from '../components/CameraLogPanel.jsx';
import { PtzControls } from '../components/PtzControls.jsx';
import { api } from '../services/api.js';
import { codecFamily, codecLabel, codecPreferenceLabel } from '../utils/codec.js';
import { useI18n } from '../i18n/I18nProvider.jsx';

export function LivePage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { t } = useI18n();
  const cameras = useSelector((state) => state.cameras.items);
  const user = useSelector((state) => state.auth.user);
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('camera') || cameras[0]?.id;
  const camera = useMemo(() => cameras.find((item) => item.id === selectedId) || cameras[0], [cameras, selectedId]);
  const [quality, setQuality] = useState('auto');
  const [profileSelections, setProfileSelections] = useState({});
  const [details, setDetails] = useState(null);
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  const [recording, setRecording] = useState(null);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [recordingError, setRecordingError] = useState('');
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef(null);
  const profileToken = camera ? (profileSelections[camera.id] || '') : '';
  const ptzProfileToken = profileToken.startsWith('source:') ? (details?.camera?.preferredProfile || '') : profileToken;

  useEffect(() => { if (!cameras.length) dispatch(loadCameras()); }, [dispatch, cameras.length]);
  useEffect(() => {
    if (!actionsOpen) return undefined;
    const close = (event) => { if (!actionsRef.current?.contains(event.target)) setActionsOpen(false); };
    const escape = (event) => { if (event.key === 'Escape') setActionsOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [actionsOpen]);
  useEffect(() => {
    if (!camera) return undefined;
    const resetTimer = setTimeout(() => { setDetails(null); setDiagnosticOpen(false); setRecording(null); setRecordingError(''); setActionsOpen(false); }, 0);
    api.camera(camera.id).then(setDetails).catch(() => setDetails(null));
    const loadRecording = () => api.recordings(camera.id).then((result) => setRecording((result.active || [])[0] || null)).catch(() => {});
    loadRecording();
    const timer = setInterval(loadRecording, 4000);
    return () => { clearTimeout(resetTimer); clearInterval(timer); };
  }, [camera?.id]);

  async function downloadSnapshot() {
    const blob = await api.snapshot(camera.id);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${camera.name.replace(/\W+/g, '_')}_${new Date().toISOString()}.jpg`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  async function restartStream() {
    setActionsOpen(false);
    await api.restartStream(camera.id);
    setDiagnosticOpen(true);
  }

  async function toggleRecording() {
    setRecordingBusy(true); setRecordingError('');
    try {
      if (recording) {
        await api.stopRecording(recording.id);
        setRecording(null);
      } else {
        const created = await api.startRecording({ cameraId: camera.id, profileToken: profileToken || null, quality: quality === 'auto' ? 'balanced' : quality });
        setRecording(created);
      }
    } catch (error) { setRecordingError(error.message); }
    finally { setRecordingBusy(false); }
  }

  if (!camera) return <div className="empty-panel"><Camera/><h2>{t('live.noCamera')}</h2></div>;
  const allowed = ['admin', 'operator'].includes(user?.role);
  const selectedProfileName = profileToken.startsWith('source:')
    ? details?.mediaSources?.find((source) => `source:${source.id}` === profileToken)?.label
    : details?.profiles?.find((profile) => profile.token === profileToken)?.name;

  return <div className="page live-page">
    <header className="page-header compact live-page-header">
      <div className="live-title-block"><span className="eyebrow">{t('nav.live').toUpperCase()}</span><h1>{camera.name}</h1><p>{camera.location || t('overview.locationUnknown')}</p></div>
      <div className="header-actions live-header-actions">
        {recording && <span className={`recording-header-state ${recording.recovering ? 'recovering' : ''}`}><span/> {recording.recovering ? t('live.recordingReconnect') : 'REC'} {Math.max(0, Number(recording.elapsedSeconds || 0))}s{recording.interruptions ? ` · ${recording.interruptions} ${t(recording.interruptions === 1 ? 'live.interruption' : 'live.interruptions')}` : ''}</span>}
        {allowed && <button className={recording ? 'stop-button' : 'record-button'} onClick={toggleRecording} disabled={recordingBusy}>{recording ? <Square/> : <Circle/>}{recordingBusy ? t('live.wait') : recording ? t('live.stopRecording') : t('live.startRecording')}</button>}
        <button className="secondary-button live-snapshot-button" onClick={downloadSnapshot}><Download/> <span>{t('live.snapshot')}</span></button>
        <div className="action-menu" ref={actionsRef}>
          <button type="button" className="icon-action-button" onClick={() => setActionsOpen((value) => !value)} aria-expanded={actionsOpen} aria-haspopup="menu" title={t('live.moreActions')} aria-label={t('live.moreActions')}><MoreHorizontal/></button>
          {actionsOpen && <div className="action-menu-popover" role="menu" aria-label={t('live.actions')}>
            <button type="button" role="menuitem" onClick={() => { setActionsOpen(false); setDiagnosticOpen(true); }}><FileSearch/><span>{t('live.diagnostics')}</span></button>
            {allowed && <button type="button" role="menuitem" onClick={restartStream}><RefreshCw/><span>{t('live.restartStream')}</span></button>}
            <button type="button" role="menuitem" onClick={() => { setActionsOpen(false); navigate('/kiosk'); }}><MonitorPlay/><span>{t('live.kioskOpen')}</span></button>
            {user?.role === 'admin' && <button type="button" role="menuitem" onClick={() => { setActionsOpen(false); navigate(`/cameras/${camera.id}/edit`); }}><Pencil/><span>{t('common.editCamera')}</span></button>}
          </div>}
        </div>
      </div>
    </header>
    {recordingError && <div className="form-error">{recordingError}</div>}
    <div className="live-layout">
      <aside className="camera-list"><h3>{t('live.cameraRail')}</h3>{cameras.map((item) => <button key={item.id} className={item.id === camera.id ? 'selected' : ''} onClick={() => setParams({ camera: item.id })}><span className={`dot ${item.status}`}/><span><strong>{item.name}</strong><small>{item.location || t('overview.locationUnknown')}</small></span></button>)}</aside>
      <div className="live-main">
        <SeamlessLivePlayer camera={camera} quality={quality} profileToken={profileToken} transportMode="local-hls" onQualityChange={setQuality} onShowDiagnostics={() => setDiagnosticOpen(true)}/>
        <div className="stream-info"><span><Volume2/> Livebild: lokaler HLS-Ring über go2rtc-Broker · Audio wird für die stabile Browseransicht deaktiviert</span><span>{t('live.profileLabel')}: {selectedProfileName || t('live.automatic')} · {profileToken ? t('live.manualSelected') : codecPreferenceLabel(details?.camera?.codecPreference)}</span></div>
        <CameraLogPanel key={camera.id} cameraId={camera.id} canClear={allowed} open={diagnosticOpen} onOpenChange={setDiagnosticOpen}/>
      </div>
      <aside className="control-panel">
        <div className="panel-section"><h3>{t('nav.kiosk')}</h3><button className="kiosk-launch-button" onClick={() => navigate('/kiosk')}><MonitorPlay/><span><strong>{t('live.kioskOpen')}</strong><small>{t('live.kioskDescription')}</small></span></button></div>
        <div className="panel-section"><h3>{t('live.ptzControl')}</h3><PtzControls camera={camera} profileToken={ptzProfileToken || details?.camera?.preferredProfile} allowed={allowed}/></div>
        <div className="panel-section"><h3>{t('live.streamProfiles')}</h3>
          <button className={`profile-row profile-button ${!profileToken ? 'selected' : ''}`} onClick={() => setProfileSelections((current) => ({ ...current, [camera.id]: '' }))}><span><strong>{t('live.automatic')}</strong><small>Profil nach Fläche und Netzqualität</small></span><em>Auto</em></button>
          {details?.profiles?.map((profile) => {
            const family = codecFamily(`${profile.videoCodec || ''} ${profile.videoProfile || ''} ${profile.name || ''}`);
            return <button type="button" className={`profile-row profile-button codec-${family} ${profileToken === profile.token ? 'selected' : ''}`} onClick={() => setProfileSelections((current) => ({ ...current, [camera.id]: profile.token }))} key={profile.token}><span><strong>{profile.name}</strong><small>{profile.width || '?'}×{profile.height || '?'} · {codecLabel(profile)} · {profile.audioCodec || t('live.noAudio')}</small>{family === 'h265' && <small className="transcode-note">HEVC wird für Browser und Aufnahme automatisch nach H.264 umgesetzt.</small>}</span><em>{family === 'h265' ? 'H.265' : profile.role}</em></button>;
          })}
          {(details?.mediaSources || []).filter((source) => source.enabled && source.kind !== 'snapshot').length > 0 && <><h4 className="source-profile-heading">Alternative Quellen</h4>{details.mediaSources.filter((source) => source.enabled && source.kind !== 'snapshot').map((source) => {
            const token = `source:${source.id}`;
            const family = codecFamily(`${source.label} ${source.url}`);
            return <button type="button" className={`profile-row profile-button source-profile codec-${family} ${profileToken === token ? 'selected' : ''}`} onClick={() => setProfileSelections((current) => ({ ...current, [camera.id]: token }))} key={token}><span><strong>{source.label}</strong><small>{source.kind.toUpperCase()} · {source.lastStatus === 'available' ? t('live.lastSuccessful') : source.origin || t('live.manualSelected')}</small>{family === 'h265' && <small className="transcode-note">Erkannte H.265-/HEVC-Quelle – Browserausgabe wird nach H.264 transkodiert.</small>}</span><em>{family === 'h265' ? 'H.265' : 'Quelle'}</em></button>;
          })}</>}
        </div>
      </aside>
    </div>
  </div>;
}
