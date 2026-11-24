import { useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import { useI18n } from '../i18n/index.js';
import { normalizeArchiveTimeline, seekArchiveWallTime, archiveWallTimeAtMedia, timelinePercent } from '../services/archivePlaybackTimeline.js';

function formatClock(ms, locale, timeZone, withDate = false) {
  if (!Number.isFinite(ms)) return '—';
  return new Intl.DateTimeFormat(locale, { ...(withDate ? { year: 'numeric', month: '2-digit', day: '2-digit' } : {}),
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    ...(timeZone ? { timeZone } : {}) }).format(new Date(ms));
}

export function RecordingArchivePlayer({ source, onEnded }) {
  const { t, locale } = useI18n();
  const videoRef = useRef(null);
  const [error, setError] = useState('');
  const [wallMs, setWallMs] = useState(null);
  const [draftMs, setDraftMs] = useState(null);
  const [gap, setGap] = useState(false);
  const dragRef = useRef(false);
  const pendingSeekRef = useRef(null);
  const skipRef = useRef(null);
  const model = useMemo(() => normalizeArchiveTimeline(source?.timeline), [source?.timeline]);
  const initial = useMemo(() => model ? seekArchiveWallTime(model, Date.parse(source?.initialWallIso || '')) : null,
    [model, source?.initialWallIso]);

  function setVideoTime(seconds) {
    const video = videoRef.current;
    pendingSeekRef.current = seconds;
    if (!video || video.readyState < 1) return;
    const max = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, video.duration - 0.05) : seconds;
    try {
      video.currentTime = Math.min(seconds, max);
      pendingSeekRef.current = null;
    } catch { /* Retry when metadata is ready. */ }
  }

  function seekWall(targetMs) {
    const target = seekArchiveWallTime(model, targetMs);
    if (!target) return;
    skipRef.current = null;
    setWallMs(target.wallMs);
    setGap(target.gap);
    setVideoTime(target.mediaSeconds);
  }

  function updatePosition() {
    const video = videoRef.current;
    if (!model || !video || video.seeking || dragRef.current || pendingSeekRef.current !== null) return;
    const position = archiveWallTimeAtMedia(model, video.currentTime);
    if (!position) return;
    if (position.ended) {
      if (!video.paused) video.pause();
      if (video.currentTime > model.spans.at(-1).mediaEnd + 0.25) setVideoTime(model.spans.at(-1).mediaEnd - 0.05);
    } else if (Number.isFinite(position.skipTo) && skipRef.current !== position.skipTo) {
      skipRef.current = position.skipTo;
      setVideoTime(position.skipTo);
    } else if (!Number.isFinite(position.skipTo)) skipRef.current = null;
    setWallMs(position.wallMs);
    if (!video.paused) setGap(false);
  }

  function finishDrag(event) {
    if (!dragRef.current) return;
    dragRef.current = false;
    const target = model.startMs + Number(event.currentTarget.value) * 1000;
    setDraftMs(null);
    seekWall(target);
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source?.url) return undefined;
    setError('');
    setWallMs(initial?.wallMs ?? null);
    setDraftMs(null);
    setGap(Boolean(initial?.gap));
    dragRef.current = false;
    skipRef.current = null;
    let hls = null;
    let cancelled = false;
    let started = false;
    let networkRetries = 0;
    let mediaRetries = 0;
    const requestedStart = Math.max(0, initial?.mediaSeconds ?? (Number(source?.startOffsetSeconds) || 0));
    pendingSeekRef.current = requestedStart;

    const startPlayback = () => {
      if (cancelled || video.readyState < 1) return;
      if (pendingSeekRef.current !== null) setVideoTime(pendingSeekRef.current);
      if (!started) {
        started = true;
        video.play().catch(() => {});
      }
    };
    const onVideoError = () => {
      if (!cancelled) setError(t('recordings.player.playbackError'));
    };
    video.addEventListener('loadedmetadata', startPlayback);
    video.addEventListener('canplay', startPlayback);
    video.addEventListener('error', onVideoError);

    if (source.format !== 'hls' || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = source.url;
      video.load();
      if (video.readyState >= 1) startPlayback();
    } else if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true, lowLatencyMode: false, backBufferLength: 30, maxBufferLength: 60,
        startPosition: requestedStart, manifestLoadingTimeOut: 15000, fragLoadingTimeOut: 30000,
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (cancelled || !data?.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries++ < 2) {
          setError(t('recordings.player.networkError'));
          hls.startLoad(video.readyState >= 1 ? video.currentTime : (pendingSeekRef.current ?? requestedStart));
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries++ < 2) {
          setError(t('recordings.player.mediaError'));
          hls.recoverMediaError();
        } else {
          setError(t('recordings.player.playbackError'));
          hls.destroy();
        }
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        if (cancelled) return;
        networkRetries = 0;
        mediaRetries = 0;
        setError('');
      });
      hls.on(Hls.Events.MANIFEST_PARSED, startPlayback);
      hls.loadSource(source.url);
      hls.attachMedia(video);
    } else {
      setError(t('recordings.player.unsupported'));
    }

    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', startPlayback);
      video.removeEventListener('canplay', startPlayback);
      video.removeEventListener('error', onVideoError);
      hls?.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
      pendingSeekRef.current = null;
    };
  }, [source?.url, source?.format, source?.startOffsetSeconds, initial, t]);

  const displayMs = draftMs ?? wallMs ?? initial?.wallMs ?? model?.startMs;
  const spanSeconds = model ? Math.max(1, Math.ceil(model.duration)) : 1;
  const sliderSeconds = model ? Math.max(0, Math.min(spanSeconds, Math.round((displayMs - model.startMs) / 1000))) : 0;
  const formatTime = (ms, date = false) => formatClock(ms, locale, model?.timezone, date);

  return <div className={'recording-archive-player' + (model ? ' has-archive-timeline' : '')}>
    <video ref={videoRef} controls autoPlay playsInline onTimeUpdate={updatePosition} onSeeked={updatePosition}
      onEnded={() => { if (model) setWallMs(model.spans.at(-1).endMs); onEnded?.(); }}/>
    {model && <section className="archive-player-timeline" dir="ltr" aria-label={t('recordings.timeline.aria', { camera: source.cameraName || '' })}>
      <div className="archive-player-timeline-heading">
        <strong>{t(model.scope === 'day' ? 'recordings.timeline.title' : 'recordings.archive.rangeLabel')}</strong>
        <output className="archive-player-clock">{formatTime(displayMs, true)}</output>
      </div>
      <div className="archive-player-timeline-scale">
        {[0, .25, .5, .75, 1].map((ratio) => <span key={ratio} style={{ left: (ratio * 100) + '%' }}>
          {formatTime(model.startMs + ratio * (model.endMs - model.startMs))}
        </span>)}
      </div>
      <div className="archive-player-timeline-track">
        {model.coverage.map((range) => <i key={range.startMs}
          style={{ left: timelinePercent(model, range.startMs) + '%',
            width: Math.max(0.08, timelinePercent(model, range.endMs) - timelinePercent(model, range.startMs)) + '%' }}/>)}
        <input type="range" min="0" max={spanSeconds} step="1" value={sliderSeconds}
          aria-label={t('recordings.timeline.aria', { camera: source.cameraName || '' })}
          aria-valuetext={formatTime(displayMs, true)}
          onPointerDown={() => { dragRef.current = true; }}
          onPointerUp={finishDrag}
          onPointerCancel={() => { dragRef.current = false; setDraftMs(null); }}
          onChange={(event) => {
            const target = model.startMs + Number(event.currentTarget.value) * 1000;
            if (dragRef.current) { setDraftMs(target); }
            else seekWall(target);
          }}/>
      </div>
      <div className="archive-player-timeline-footer">
        <div className="archive-player-step-buttons">
          <button type="button" onClick={() => seekWall(displayMs - 60000)}>−60 s</button>
          <button type="button" onClick={() => seekWall(displayMs - 10000)}>−10 s</button>
          <button type="button" onClick={() => seekWall(displayMs + 10000)}>+10 s</button>
          <button type="button" onClick={() => seekWall(displayMs + 60000)}>+60 s</button>
        </div>
        <small className="archive-player-gap-legend"><i/>{t('recordings.timeline.gaps')}</small>
      </div>
      {gap && <small className="archive-player-gap-hint" role="status">{t('recordings.timeline.noPlayableRange')}</small>}
    </section>}
    {error && <div className="inline-warning">{error}</div>}
  </div>;
}
