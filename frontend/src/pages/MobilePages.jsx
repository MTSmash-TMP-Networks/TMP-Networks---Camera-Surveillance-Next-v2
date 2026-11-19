import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, ChevronRight, CircleAlert, CircleCheck, Download, LogOut, Monitor, Play, RefreshCw, Search, ShieldCheck, Video, WifiOff, X } from 'lucide-react';
import { logout } from '../features/auth/authSlice.js';
import { loadCameras } from '../features/cameras/camerasSlice.js';
import { useI18n } from '../i18n/I18nProvider.jsx';
import { api } from '../services/api.js';
import { setInterfacePreference } from '../services/mobileRouting.js';
import { SnapshotBackdrop } from '../components/SnapshotBackdrop.jsx';
import { SeamlessLivePlayer } from '../components/SeamlessLivePlayer.jsx';
import { RecordingArchivePlayer } from '../components/RecordingArchivePlayer.jsx';

function MobileState({ camera, t }) {
  const online = camera.status === 'online';
  return <span className={`mobile-camera-state ${online ? 'online' : 'offline'}`}>
    {online ? <CircleCheck size={13}/> : <CircleAlert size={13}/>}
    {online ? t('common.online') : camera.status === 'stream_error' ? t('common.streamError') : t('common.offline')}
  </span>;
}

export function MobileOverviewPage() {
  const dispatch = useDispatch();
  const { t } = useI18n();
  const { items: cameras, status, error } = useSelector((state) => state.cameras);
  const [search, setSearch] = useState('');
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return cameras.filter((camera) => !query ||
      String(camera.name || '').toLocaleLowerCase().includes(query) ||
      String(camera.location || '').toLocaleLowerCase().includes(query));
  }, [search, cameras]);
  const online = cameras.filter((camera) => camera.status === 'online').length;

  return <section className="mobile-page mobile-cameras-page">
    <div className="mobile-page-title">
      <div><span className="mobile-eyebrow">{t('mobile.monitoring')}</span><h1>{t('mobile.cameras.title')}</h1>
        <p>{t('mobile.cameras.subtitle')}</p></div>
      <button type="button" className="mobile-icon-button" disabled={status === 'loading'} onClick={() => dispatch(loadCameras())} aria-label={t('common.refresh')}><RefreshCw size={20}/></button>
    </div>
    <div className="mobile-summary">
      <div><strong>{cameras.length}</strong><span>{t('overview.total')}</span></div>
      <div><strong>{online}</strong><span>{t('common.online')}</span></div>
      <div><strong>{Math.max(0, cameras.length - online)}</strong><span>{t('overview.needsAttention')}</span></div>
    </div>
    <label className="mobile-search"><Search size={19}/><span className="mobile-sr-only">{t('mobile.cameras.search')}</span>
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('mobile.cameras.search')} autoComplete="off" type="search"/>
    </label>
    {status === 'error' && <div className="mobile-error" role="alert">{error || t('mobile.loadFailed')}</div>}
    {status === 'loading' && !cameras.length && <div className="mobile-loading">{t('common.loading')}</div>}
    <div className="mobile-camera-list">
      {visible.map((camera) => <Link key={camera.id} to={`/mobile/cameras/${encodeURIComponent(camera.id)}`} className="mobile-camera-card"
        aria-label={t('mobile.cameras.open', { name: camera.name })}>
        <div className="mobile-camera-thumb"><SnapshotBackdrop cameraId={camera.id} refreshMs={60000}/><Video size={22} className="mobile-camera-thumb-icon"/></div>
        <div className="mobile-camera-info"><strong>{camera.name}</strong><span>{camera.location || t('overview.locationUnknown')}</span>
          <MobileState camera={camera} t={t}/></div>
        <ChevronRight size={19} className="mobile-camera-chevron"/>
      </Link>)}
      {!visible.length && status !== 'loading' && <div className="mobile-empty"><Camera size={34}/>
        <strong>{cameras.length ? t('mobile.cameras.noMatches') : t('overview.emptyTitle')}</strong>
      </div>}
    </div>
  </section>;
}

export function MobileCameraPage() {
  const { id } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { t } = useI18n();
  const cameras = useSelector((state) => state.cameras.items);
  const camera = cameras.find((item) => item.id === id);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [playbackState, setPlaybackState] = useState(null);

  useEffect(() => {
    if (!cameras.length) dispatch(loadCameras());
  }, [dispatch, cameras.length]);
  useEffect(() => {
    let alive = true;
    setDetail(null);
    if (!id) return undefined;
    api.camera(id).then((result) => { if (alive) setDetail(result); })
      .catch(() => { if (alive) setDetail(null); });
    return () => { alive = false; };
  }, [id]);

  async function snapshot() {
    if (!camera) return;
    setSnapshotBusy(true); setError('');
    try {
      const blob = await api.snapshot(camera.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${camera.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${new Date().toISOString().replaceAll(':', '-')}.jpg`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setError(reason.message || t('mobile.loadFailed')); }
    finally { setSnapshotBusy(false); }
  }

  return <section className="mobile-page mobile-camera-detail">
    <div className="mobile-detail-head">
      <button type="button" className="mobile-icon-button" onClick={() => navigate('/mobile')} aria-label={t('mobile.back')}><ArrowLeft size={21}/></button>
      <div><h1>{camera?.name || t('mobile.cameras.title')}</h1><span>{camera?.location || t('overview.locationUnknown')}</span></div>
      {camera && <MobileState camera={camera} t={t}/>}
    </div>
    {camera
      ? <>
        <div className="mobile-live-wrap">
          <SeamlessLivePlayer key={camera.id} camera={camera} quality="low" profileToken=""
            transportMode="local-hls" compact isolateFailure onStatusChange={(next) => setPlaybackState(next?.state || null)}/>
        </div>
        <p className="mobile-video-note"><ShieldCheck size={14}/> {t('mobile.video.central')}
          {playbackState === 'ready' ? <span className="mobile-video-ready">{t('mobile.video.ready')}</span> : null}</p>
        <div className="mobile-actions">
          <button type="button" onClick={snapshot} disabled={snapshotBusy} className="mobile-action-primary"><Download size={19}/> {snapshotBusy ? t('common.loading') : t('live.snapshot')}</button>
          <Link to="/mobile/recordings" className="mobile-action-secondary"><Play size={18}/>{t('mobile.tabs.recordings')}</Link>
        </div>
        <div className="mobile-detail-card"><h2>{t('mobile.camera.details')}</h2>
          <div><span>{t('mobile.camera.connection')}</span><strong>{camera.connectionType === 'stream' ? 'RTSP' : 'ONVIF'}</strong></div>
          <div><span>{t('mobile.camera.stream')}</span><strong>{t('mobile.video.low')}</strong></div>
          {detail?.camera?.model && <div><span>{t('mobile.camera.model')}</span><strong>{detail.camera.model}</strong></div>}
        </div>
      </>
      : <div className="mobile-empty"><WifiOff size={30}/><strong>{t('mobile.camera.notFound')}</strong></div>}
    {error && <p className="mobile-error" role="alert">{error}</p>}
  </section>;
}

function recordingTime(value, locale) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(locale, { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

export function MobileRecordingsPage() {
  const { t, locale } = useI18n();
  const cameras = useSelector((state) => state.cameras.items);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [recordings, setRecordings] = useState([]);
  const [active, setActive] = useState([]);
  const [playing, setPlaying] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cameraNames = useMemo(() => Object.fromEntries(cameras.map((item) => [item.id, item.name])), [cameras]);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const result = await api.recordings(selectedCamera);
        if (alive) {
          setRecordings(result.items || []);
          setActive(result.active || []);
          setError('');
        }
      } catch (reason) { if (alive) setError(reason.message || t('mobile.loadFailed')); }
      finally { if (alive) setLoading(false); }
    }
    void load();
    return () => { alive = false; };
  }, [selectedCamera, t]);

  async function open(recording) {
    setBusy(true); setError('');
    try {
      const token = await api.recordingToken(recording.id);
      setPlaying({ ...recording, url: token.url, format: token.format || 'file' });
    } catch (reason) { setError(reason.message || t('mobile.loadFailed')); }
    finally { setBusy(false); }
  }

  const items = recordings.filter((item) => item.status !== 'recording')
    .slice().sort((a,b) => Date.parse(b.startedAt || 0) - Date.parse(a.startedAt || 0));

  return <section className="mobile-page mobile-recordings-page">
    <div className="mobile-page-title"><div><span className="mobile-eyebrow">{t('mobile.monitoring')}</span><h1>{t('mobile.recordings.title')}</h1>
      <p>{t('mobile.recordings.subtitle')}</p></div></div>
    <label className="mobile-filter"><span>{t('mobile.recordings.filter')}</span>
      <select value={selectedCamera} onChange={(event) => setSelectedCamera(event.target.value)}>
        <option value="">{t('mobile.recordings.all')}</option>
        {cameras.map((camera) => <option value={camera.id} key={camera.id}>{camera.name}</option>)}
      </select>
    </label>
    {!!active.length && <div className="mobile-recording-active"><span className="mobile-recording-dot"/> {t('mobile.recordings.active', { count: active.length })}</div>}
    {error && <div className="mobile-error" role="alert">{error}</div>}
    {loading ? <div className="mobile-loading">{t('common.loading')}</div> :
      <div className="mobile-recording-list">
        {items.slice(0, 100).map((recording) => <button type="button" className="mobile-recording-card" key={recording.id} onClick={() => open(recording)} disabled={busy}>
          <span className="mobile-recording-icon"><Video size={22}/></span>
          <span className="mobile-recording-info"><strong>{cameraNames[recording.cameraId] || t('mobile.recordings.unknownCamera')}</strong>
            <small>{recordingTime(recording.startedAt || recording.timelineStartedAt, locale)}</small>
            <small>{recording.trigger || recording.mode || t('mobile.recordings.recording')}</small></span>
          <Play size={18}/>
        </button>)}
        {!items.length && <div className="mobile-empty"><Video size={30}/><strong>{t('mobile.recordings.empty')}</strong></div>}
      </div>}
    {playing && <div className="mobile-recording-modal" role="dialog" aria-modal="true" aria-label={t('mobile.recordings.playback')}>
      <div className="mobile-recording-modal-head"><strong>{cameraNames[playing.cameraId] || t('mobile.recordings.playback')}</strong>
        <button type="button" onClick={() => setPlaying(null)} aria-label={t('mobile.close')}><X size={22}/></button></div>
      <RecordingArchivePlayer source={playing}/>
    </div>}
  </section>;
}

export function MobileMorePage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { t } = useI18n();
  const user = useSelector((state) => state.auth.user);
  function desktop() { setInterfacePreference('desktop'); navigate('/', { replace:true }); }
  function signout() { dispatch(logout()); navigate('/login', { replace:true }); }
  return <section className="mobile-page mobile-more-page">
    <div className="mobile-page-title"><div><span className="mobile-eyebrow">{t('mobile.monitoring')}</span><h1>{t('mobile.tabs.more')}</h1></div></div>
    <div className="mobile-profile"><ShieldCheck size={25}/><span><strong>{user?.username}</strong>
      <small>{t(`role.${user?.role}`)}</small></span></div>
    <button type="button" className="mobile-more-button" onClick={desktop}><Monitor size={21}/>{t('mobile.desktop')}<ChevronRight size={18}/></button>
    <button type="button" className="mobile-more-button" onClick={signout}><LogOut size={21}/>{t('nav.logout')}<ChevronRight size={18}/></button>
    <p className="mobile-more-hint">{t('mobile.more.hint')}</p>
  </section>;
}
