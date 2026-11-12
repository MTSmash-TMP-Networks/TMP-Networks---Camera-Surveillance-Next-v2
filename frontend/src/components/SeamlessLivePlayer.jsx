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

export function SeamlessLivePlayer({ camera, quality, profileToken, transportMode = 'auto', onQualityChange, onShowDiagnostics, onStatusChange, compact = false, reconnectSignal = 0, kioskStatus = null, connectDelayMs = 0, isolateFailure = false }) {
  const { t } = useI18n();
  const containerRef = useRef(null);
  const mediaHostRef = useRef(null);
  const handleRef = useRef(null);
  const previousRequestRef = useRef(null);
  const reconnectSignalRef = useRef(reconnectSignal);
  const onStatusChangeRef = useRef(onStatusChange);
  const [viewportWidth, setViewportWidth] = useState(null);
  const [muted, setMuted] = useState(true);
  const [status, setStatus] = useState({ state: 'starting', protocol: null, message: t('live.streamPreparing'), hasAudio: null, snapshotMode: false });
  const [clock, setClock] = useState(() => new Date());
  const [fullscreen, setFullscreen] = useState(false);
  const automaticQuality = qualityForWidth(viewportWidth || 1280);
  const effectiveQuality = quality === 'auto' ? automaticQuality : quality;
  const requestedQuality = compact ? effectiveQuality : quality;

  useEffect(() => { onStatusChangeRef.current = onStatusChange; }, [onStatusChange]);

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
    if (!host || !viewportWidth) return undefined;
    let cancelled = false;
    let handle = null;
    const previous = previousRequestRef.current;
    const request = { cameraId: camera.id, quality: requestedQuality, profileToken: profileToken || '', purpose: compact ? 'kiosk' : 'live', transportMode };
    const allowCompatibleReuse = !previous
      || previous.cameraId !== request.cameraId
      || (previous.quality === request.quality && previous.profileToken === request.profileToken && previous.purpose === request.purpose && previous.transportMode === request.transportMode);
    previousRequestRef.current = request;
    const attach = () => {
      if (cancelled) return;
      handle = liveStreamPool.acquire({
        ...request,
        viewportWidth,
        muted: compact ? true : muted,
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
  }, [camera.id, requestedQuality, profileToken, transportMode, viewportWidth, compact, connectDelayMs, isolateFailure]);

  useEffect(() => {
    handleRef.current?.setMuted(compact ? true : muted);
  }, [muted, compact]);


  useEffect(() => {
    if (reconnectSignalRef.current === reconnectSignal) return;
    reconnectSignalRef.current = reconnectSignal;
    handleRef.current?.reconnect();
  }, [reconnectSignal]);

  return (
    <section ref={containerRef} className={`live-player ${compact ? 'live-player-compact' : ''}`} aria-label={t('live.liveAria', { name: camera.name })} data-camera-id={camera.id}>
      <SnapshotBackdrop cameraId={camera.id} refreshMs={status.snapshotMode ? 1000 : 15000} enabled={!['ready', 'recovering'].includes(status.state) || status.snapshotMode} />
      <div ref={mediaHostRef} className="live-media-host" />
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
      {!compact && <div className="live-controls">
        <button disabled={status.hasAudio === false} onClick={() => setMuted((value) => !value)} title={status.hasAudio === false ? t('live.noAudio') : muted ? t('live.enableAudio') : t('live.muteAudio')}>{muted || status.hasAudio === false ? <VolumeX /> : <Volume2 />}</button>
        <button onClick={() => handleRef.current?.reconnect()} title={t('live.reconnect')} aria-label={t('live.reconnect')}><RefreshCw /></button>
        <button onClick={toggleFullscreen} title={fullscreen ? t('live.exitFullscreen') : t('live.fullscreen')} aria-label={fullscreen ? t('live.exitFullscreen') : t('live.fullscreen')}>{fullscreen ? <Minimize2 /> : <Maximize2 />}</button>
      </div>}
    </section>
  );
}
