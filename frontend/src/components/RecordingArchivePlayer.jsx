import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { useI18n } from '../i18n/index.js';

export function RecordingArchivePlayer({ source, onEnded }) {
  const { t } = useI18n();
  const videoRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source?.url) return undefined;
    setError('');
    let hls = null;
    let cancelled = false;
    let startApplied = false;
    const requestedStart = Math.max(0, Number(source?.startOffsetSeconds || 0));

    const startPlayback = () => {
      if (cancelled) return;
      if (!startApplied && requestedStart > 0 && video.readyState >= 1) {
        const maxSeek = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, video.duration - 0.05) : requestedStart;
        try { video.currentTime = Math.min(requestedStart, maxSeek); } catch { /* Browser will retry once metadata is available. */ }
        startApplied = true;
      }
      video.play().catch(() => {});
    };
    const handleLoadedMetadata = () => startPlayback();
    video.addEventListener('loadedmetadata', handleLoadedMetadata);

    if (source.format !== 'hls') {
      video.src = source.url;
      video.load();
      if (video.readyState >= 1) startPlayback();
      return () => {
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        video.pause();
        video.removeAttribute('src');
        video.load();
      };
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = source.url;
      video.load();
      if (video.readyState >= 1) startPlayback();
    } else if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        maxBufferLength: 60,
        manifestLoadingTimeOut: 15000,
        fragLoadingTimeOut: 30000,
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (cancelled || !data?.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setError(t('recordings.player.networkError'));
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          setError(t('recordings.player.mediaError'));
          hls.recoverMediaError();
        } else {
          setError(t('recordings.player.playbackError'));
          hls.destroy();
        }
      });
      hls.loadSource(source.url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => startPlayback());
    } else {
      setError(t('recordings.player.unsupported'));
    }

    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      hls?.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [source?.url, source?.format, source?.startOffsetSeconds, t]);

  return <div className="recording-archive-player">
    <video ref={videoRef} controls autoPlay playsInline onEnded={onEnded}/>
    {error && <div className="inline-warning">{error}</div>}
  </div>;
}
