import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { useI18n } from '../i18n/index.js';

export function RecordingArchivePlayer({ source }) {
  const { t } = useI18n();
  const videoRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source?.url) return undefined;
    setError('');
    let hls = null;
    let cancelled = false;

    if (source.format !== 'hls') {
      video.src = source.url;
      video.load();
      video.play().catch(() => {});
      return () => {
        video.pause();
        video.removeAttribute('src');
        video.load();
      };
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = source.url;
      video.load();
      video.play().catch(() => {});
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
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    } else {
      setError(t('recordings.player.unsupported'));
    }

    return () => {
      cancelled = true;
      hls?.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [source?.url, source?.format, t]);

  return <div className="recording-archive-player">
    <video ref={videoRef} controls autoPlay playsInline/>
    {error && <div className="inline-warning">{error}</div>}
  </div>;
}
