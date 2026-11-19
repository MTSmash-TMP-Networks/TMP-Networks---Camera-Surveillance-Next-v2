import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Activity, Video, Volume2, VolumeX, RefreshCw, Wifi, TriangleAlert, Gauge, FileSearch, Maximize2, Minimize2 } from 'lucide-react';
import { SnapshotBackdrop } from './SnapshotBackdrop.jsx';
import { qualityForWidth } from '../services/quality.js';
import { liveStreamPool } from '../services/liveStreamPool.js';
import { useI18n } from '../i18n/I18nProvider.jsx';

/**
 * React only mounts a host container. The actual video element and its WebRTC /
 * MediaSource connection live in liveStreamPool and are moved between routes.
 * Moving the same DOM node preserves decoder state and buffered media.
 */
function KioskStatusBadges({ status }) {
  const { t } = useI18n();
  if (!status?.motionActive && !status?.recordingActive) return null;
  return <div className="kiosk-status-badges" aria-live="polite">
    {status.motionActive && <span className="kiosk-status-badge motion" title={status.motionTimeLabel ? `${t('live.motion')} ${status.motionTimeLabel}` : t('live.motionDetected')}><Activity/> {t('live.motion')}</span>}
    {status.recordingActive && <span className={`kiosk-status-badge recording ${status.continuousRecording ? 'continuous' : ''} ${status.recovering ? 'recovering' : ''}`} title={status.recordingTimeLabel ? `${status.recordingLabel} · ${status.recordingTimeLabel}` : status.recordingLabel}><Video/> {status.continuousRecording ? t('live.continuousRecording') : 'REC'}{status.recovering ? ` · ${t('live.reconnect')}` : ''}</span>}
  </div>;
}

export function SeamlessLivePlayer({ camera, quality, profileToken, transportMode = 'auto', onQualityChange, onShowDiagnostics, onStatusChange, onAudioStatusChange, compact = false, reconnectSignal = 0, kioskStatus = null, connectDelayMs = 0, isolateFailure = false }) {
  const { t } = useI18n();
  const containerRef = useRef(null);
  const mediaHostRef = useRef(null);
  const audioHostRef = useRef(null);
  const audioHandleRef = useRef(null);
  const onAudioStatusChangeRef = useRef(onAudioStatusChange);
  const handleRef = useRef(null);
  const previousRequestRef = useRef(null);
  const reconnectSignalRef = useRef(reconnectSignal);
  const onStatusChangeRef = useRef(onStatusChange);
  const [viewportWidth, setViewportWidth] = useState(null);
  const [audioMuted, setMuted] = useState(true);
  const [audioRequestedRaw, setAudioRequested] = useState(false);
  const [audioCameraId, setAudioCameraId] = useState(null);
  const [audioQuality, setAudioQuality] = useState('auto');
  const [audioStatus, setAudioStatus] = useState({ state: 'idle', hasAudio: null });
  const [audioNotice, setAudioNotice] = useState('');
  // Ignore audio state from the previously selected camera before effects run.
  const audioRequested = audioRequestedRaw && audioCameraId === camera.id;
  const muted = !audioRequested || audioMuted;
  const [status, setStatus] = useState({ state: 'starting', protocol: null, message: t('live.streamPreparing'), hasAudio: null, snapshotMode: false });
  const [clock, setClock] = useState(() => new Date());
  const [fullscreen, setFullscreen] = useState(false);
  const automaticQuality = qualityForWidth(viewportWidth || 1280);
  // Kiosk is a pure reader of the backend-owned central preview. Tile size,
  // browser resize and UI quality must never create another camera session.
  // The visible player never changes streams when the user requests audio.
  const requestedQuality = compact ? 'low' : (quality === 'auto' ? 'auto' : quality);
  const requestedPurpose = compact ? 'kiosk' : 'live';
  const connectionViewportWidth = compact ? 640 : requestedQuality === 'low' ? 640 : requestedQuality === 'high' ? 1920 : 1280;
  const waitingForAdaptiveMeasurement = false;

  useEffect(() => { onStatusChangeRef.current = onStatusChange; }, [onStatusChange]);
  useEffect(() => { onAudioStatusChangeRef.current = onAudioStatusChange; }, [onAudioStatusChange]);
  useEffect(() => {
    setAudioRequested(false);
    setAudioCameraId(null);
    setAudioQuality('auto');
    setAudioStatus({ state: 'idle', hasAudio: null });
    setAudioNotice('');
    setMuted(true);
  }, [camera.id]);

  useEffect(() => {
    if (compact) return undefined;
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, [compact]);

  useEffect(() => {
    if (compact) return undefined;
    const update = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, [compact]);

  async function toggleFullscreen() {
    if (document.fullscreenElement === containerRef.current) {
      await document.exitFullscreen?.();
      return;
    }
    await containerRef.current?.requestFullscreen?.();
  }

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    setViewportWidth(Math.max(160, Math.round(element.getBoundingClientRect().width || window.innerWidth || 1280)));
    if (typeof ResizeObserver === 'undefined') return undefined;
    let timer;
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = Math.max(160, Math.round(entry.contentRect.width));
      clearTimeout(timer);
      timer = setTimeout(() => setViewportWidth((current) => current && Math.abs(current - nextWidth) < 64 ? current : nextWidth), 300);
    });
    observer.observe(element);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, []);

  useEffect(() => {
    const host = mediaHostRef.current;
    if (!host || waitingForAdaptiveMeasurement) return undefined;
    let cancelled = false;
    let handle = null;
    const previous = previousRequestRef.current;
    const request = { cameraId: camera.id, quality: requestedQuality, profileToken: profileToken || '', purpose: requestedPurpose, transportMode };
    const allowCompatibleReuse = !previous
      || previous.cameraId !== request.cameraId
      || (previous.quality === request.quality && previous.profileToken === request.profileToken && previous.purpose === request.purpose && previous.transportMode === request.transportMode);
    previousRequestRef.current = request;
    const attach = () => {
      if (cancelled) return;
      handle = liveStreamPool.acquire({
        ...request,
        viewportWidth: connectionViewportWidth,
        muted: true,
        allowCompatibleReuse,
        isolateFailure,
      }, host, (next) => {
        if (cancelled) return;
        setStatus(next);
        onStatusChangeRef.current?.(next);
        if (next.state === 'failed') onShowDiagnostics?.();
      });
      handleRef.current = handle;
    };
    const delay = Math.max(0, Number(connectDelayMs) || 0);
    const timer = delay ? window.setTimeout(attach, delay) : null;
    if (!delay) attach();
    else setStatus((current) => ({ ...current, state: 'starting', protocol: current.protocol, message: t('live.kioskPreparing', { seconds: Math.round(delay / 1000) }) }));
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      if (handleRef.current === handle) handleRef.current = null;
      handle?.release();
    };
  }, [camera.id, requestedQuality, requestedPurpose, profileToken, transportMode, connectionViewportWidth, waitingForAdaptiveMeasurement, compact, connectDelayMs, isolateFailure]);

  // A failed AAC source must never interrupt the working visible live image.
  useEffect(() => {
    if (compact || !audioRequested) return undefined;
    const host = audioHostRef.current;
    if (!host) return undefined;
    let cancelled = false;
    const handle = liveStreamPool.acquire({
      cameraId: camera.id,
      quality: audioQuality,
      profileToken: profileToken || '',
      purpose: 'live-audio',
      transportMode,
      viewportWidth: audioQuality === 'high' ? 1920 : audioQuality === 'low' ? 640 : 1280,
      muted: true,
      allowCompatibleReuse: false,
      isolateFailure: true,
    }, host, (next) => {
      if (cancelled) return;
      setAudioStatus(next);
      onAudioStatusChangeRef.current?.(next);
      if (next.state === 'failed' || (next.state === 'ready' && next.hasAudio === false)) {
        if (quality === 'auto' && audioQuality !== 'high') {
          // Some cameras only send microphone frames with their main profile.
          // Attempt it once, but never replace the visible preview.
          setAudioNotice('Keine Audiospur im Vorschaustream – Hauptstream wird geprüft …');
          setAudioQuality('high');
        } else {
          setAudioNotice(next.state === 'failed'
            ? 'Audiokanal konnte nicht aufgebaut werden. Das Livebild bleibt aktiv.'
            : 'Die Kamera liefert in diesem Profil keine nutzbare AAC-Audiospur.');
          setAudioRequested(false);
          setAudioCameraId(null);
          setMuted(true);
        }
      } else if (next.state === 'ready' && next.hasAudio === true) {
        setAudioNotice('Audiokanal bereit – Lautsprechertaste erneut drücken, um Ton zu starten.');
      } else if (next.state === 'starting' || next.state === 'connecting') {
        setAudioNotice('Audiokanal wird separat vorbereitet – Livebild bleibt aktiv …');
      }
    });
    audioHandleRef.current = handle;
    return () => {
      cancelled = true;
      if (audioHandleRef.current === handle) audioHandleRef.current = null;
      handle.release({ immediate: true });
      onAudioStatusChangeRef.current?.(null);
    };
  }, [compact, audioRequested, camera.id, audioQuality, profileToken, transportMode, quality]);

  useEffect(() => {
    if (audioRequested) audioHandleRef.current?.setMuted(muted);
  }, [audioRequested, muted]);

  function toggleAudio() {
    if (compact) return;
    if (!audioRequested) {
      // Keep the existing preview playing silently while a dedicated audio
      // source starts. Browser autoplay must never be required to carry sound.
      setMuted(true);
      setAudioQuality(quality === 'auto' ? 'auto' : quality);
      setAudioStatus({ state: 'starting', hasAudio: null });
      setAudioNotice('Audiokanal wird separat vorbereitet – Livebild bleibt aktiv …');
      setAudioCameraId(camera.id);
      setAudioRequested(true);
      return;
    }
    if (audioStatus.state !== 'ready' || audioStatus.hasAudio !== true) {
      setMuted(true);
      setAudioRequested(false);
      setAudioCameraId(null);
      return;
    }
    const nextMuted = !muted;
    // This synchronous user gesture allows Safari to start unmuted playback.
    audioHandleRef.current?.setMuted(nextMuted);
    setMuted(nextMuted);
    setAudioNotice(nextMuted ? 'Ton stummgeschaltet.' : 'Ton eingeschaltet.');
  }


  useEffect(() => {
    if (reconnectSignalRef.current === reconnectSignal) return;
    reconnectSignalRef.current = reconnectSignal;
    handleRef.current?.reconnect();
  }, [reconnectSignal]);

  return (
    <section ref={containerRef} className={`live-player ${compact ? 'live-player-compact' : ''}`} aria-label={t('live.liveAria', { name: camera.name })} data-camera-id={camera.id}>
      <SnapshotBackdrop cameraId={camera.id} refreshMs={status.snapshotMode ? 1000 : 15000} enabled={!['ready', 'recovering'].includes(status.state) || status.snapshotMode} />
      <div ref={mediaHostRef} className="live-media-host" />
      {!compact && <div ref={audioHostRef} className="live-audio-media-host" aria-hidden="true" />}
      <div className="live-gradient" />
      {compact
        ? <>
          <div className="kiosk-camera-label"><strong>{camera.name}</strong><span>{camera.location || t('overview.locationUnknown')}</span></div>
          <KioskStatusBadges status={kioskStatus} />
        </>
        : <div className="live-clock"><strong>{clock.toLocaleTimeString(globalThis.document?.documentElement?.lang || 'en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong><span>{clock.toLocaleDateString(globalThis.document?.documentElement?.lang || 'en', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}</span>{camera.location && <small>{camera.location}</small>}</div>}
      <div className="live-topbar">
        <span className={`signal signal-${status.state}`}><Wifi size={14} /> {status.protocol || 'ONVIF'}</span>
        {quality === 'auto' && !profileToken && <span className="adaptive-chip"><Gauge size={14}/> {automaticQuality}</span>}
        {!compact && <select value={quality} onChange={(event) => onQualityChange?.(event.target.value)} aria-label={t('live.qualityLabel')}>
          <option value="auto">{t('live.automatic')}</option><option value="high">{t('live.qualityHigh')}</option><option value="balanced">{t('live.qualityBalanced')}</option><option value="low">{t('live.qualityLow')}</option>
        </select>}
      </div>
      {(!compact || status.state !== 'ready') && <div className="live-status">
        {status.state === 'failed' && <TriangleAlert size={18} />}
        <span>{status.message}</span>
        {status.state === 'failed' && onShowDiagnostics && <button className="inline-diagnostics" onClick={onShowDiagnostics}><FileSearch /> {t('live.diagnostics')}</button>}
      </div>}
      {!compact && audioNotice && <div className="live-audio-notice" role="status">{audioNotice}</div>}
      {!compact && <div className="live-controls">
        <button type="button" onClick={toggleAudio} title={!audioRequested ? t('live.enableAudio') : audioStatus.state !== 'ready' ? 'Audiokanal wird vorbereitet (erneut klicken zum Abbrechen)' : muted ? 'Ton starten' : t('live.muteAudio')} aria-label={!audioRequested ? t('live.enableAudio') : audioStatus.state !== 'ready' ? 'Audioaufbau abbrechen' : muted ? 'Ton starten' : t('live.muteAudio')} aria-pressed={audioRequested && !muted}>{audioRequested && audioStatus.hasAudio === true ? <Volume2 /> : <VolumeX />}</button>
        <button onClick={() => handleRef.current?.reconnect()} title={t('live.reconnect')} aria-label={t('live.reconnect')}><RefreshCw /></button>
        <button onClick={toggleFullscreen} title={fullscreen ? t('live.exitFullscreen') : t('live.fullscreen')} aria-label={fullscreen ? t('live.exitFullscreen') : t('live.fullscreen')}>{fullscreen ? <Minimize2 /> : <Maximize2 />}</button>
      </div>}
    </section>
  );
}
