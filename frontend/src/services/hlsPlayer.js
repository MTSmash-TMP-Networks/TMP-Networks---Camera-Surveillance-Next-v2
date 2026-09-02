import Hls from 'hls.js';

const RECOVERY_WATCHDOG_MS = 8000;
const WAITING_GRACE_MS = 3000;
const MAX_NETWORK_RECOVERIES = 3;
const MAX_MEDIA_RECOVERIES = 2;
const MAX_SOFT_RECOVERIES = 2;

function cacheBustUrl(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    parsed.searchParams.set('_live', `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    return parsed.href;
  } catch {
    const separator = String(url).includes('?') ? '&' : '?';
    return `${url}${separator}_live=${Date.now()}`;
  }
}

function safePlay(video) {
  try {
    const result = video.play?.();
    if (result?.catch) result.catch(() => {});
  } catch { /* ignored */ }
}

function seekToLiveEdge(hls, video) {
  try {
    const livePosition = Number(hls?.liveSyncPosition);
    if (Number.isFinite(livePosition) && Math.abs(Number(video.currentTime || 0) - livePosition) > 1.5) {
      video.currentTime = Math.max(0, livePosition);
      return;
    }
    const ranges = video.seekable;
    if (ranges?.length) {
      const end = ranges.end(ranges.length - 1);
      if (Number.isFinite(end) && end - Number(video.currentTime || 0) > 4) video.currentTime = Math.max(0, end - 1);
    }
  } catch { /* ignored */ }
}

function nativeHls({ url, video, onState }) {
  let destroyed = false;
  let recoveryTimer = null;
  let waitingTimer = null;
  let recoveryAttempts = 0;
  let recovering = false;

  const clearRecovery = () => {
    if (recoveryTimer) clearTimeout(recoveryTimer);
    if (waitingTimer) clearTimeout(waitingTimer);
    recoveryTimer = null;
    waitingTimer = null;
  };
  const markConnected = (source) => {
    if (destroyed) return;
    const wasRecovering = recovering;
    recovering = false;
    recoveryAttempts = 0;
    clearRecovery();
    onState?.('connected', { recovered: wasRecovering, source, transport: 'native-hls' });
  };
  const fail = (details) => {
    if (destroyed) return;
    recovering = false;
    clearRecovery();
    onState?.('failed', { type: 'native', responseCode: null, ...details });
  };
  const applySource = () => {
    if (destroyed) return;
    video.src = cacheBustUrl(url);
    try { video.load(); } catch { /* ignored */ }
    safePlay(video);
  };
  const recover = (reason) => {
    if (destroyed) return;
    recoveryAttempts += 1;
    if (recoveryAttempts > MAX_NETWORK_RECOVERIES) {
      fail({ details: reason, reason: 'native-hls-recovery-exhausted' });
      return;
    }
    recovering = true;
    onState?.('recovering', { type: 'native', details: reason, attempt: recoveryAttempts });
    clearRecovery();
    recoveryTimer = setTimeout(() => {
      if (destroyed || !recovering) return;
      applySource();
      recoveryTimer = setTimeout(() => {
        if (recovering) fail({ details: reason, reason: 'native-hls-recovery-timeout' });
      }, RECOVERY_WATCHDOG_MS);
    }, 250);
  };
  const onWaiting = () => {
    if (destroyed || video.paused || waitingTimer) return;
    waitingTimer = setTimeout(() => {
      waitingTimer = null;
      if (!destroyed && !video.paused && video.readyState < 3) recover('video-waiting');
    }, WAITING_GRACE_MS);
  };
  const onPlaying = () => markConnected('playing');
  const onLoaded = () => markConnected('loadeddata');
  const onError = () => recover(video.error?.message || 'video-error');

  video.addEventListener('playing', onPlaying);
  video.addEventListener('loadeddata', onLoaded);
  video.addEventListener('waiting', onWaiting);
  video.addEventListener('stalled', onWaiting);
  video.addEventListener('error', onError);
  applySource();

  return () => {
    destroyed = true;
    clearRecovery();
    video.removeEventListener('playing', onPlaying);
    video.removeEventListener('loadeddata', onLoaded);
    video.removeEventListener('waiting', onWaiting);
    video.removeEventListener('stalled', onWaiting);
    video.removeEventListener('error', onError);
    video.removeAttribute('src');
    try { video.load(); } catch { /* ignored */ }
  };
}

export function connectHls({ url, tokenRef, video, onState }) {
  if (!Hls.isSupported()) {
    const nativeSupported = video.canPlayType('application/vnd.apple.mpegurl') || video.canPlayType('application/x-mpegURL');
    if (!nativeSupported) throw new Error('HLS wird von diesem Browser nicht ueber Media Source Extensions unterstuetzt');
    return nativeHls({ url, video, onState });
  }

  let destroyed = false;
  let recovering = false;
  let recoveryTimer = null;
  let waitingTimer = null;
  let networkRecoveries = 0;
  let mediaRecoveries = 0;
  let softRecoveries = 0;
  let lastRecoveryDetails = null;
  let activeSourceUrl = cacheBustUrl(url);

  const hls = new Hls({
    lowLatencyMode: true,
    liveSyncDurationCount: 2,
    liveMaxLatencyDurationCount: 6,
    maxLiveSyncPlaybackRate: 1.15,
    backBufferLength: 6,
    maxBufferLength: 12,
    maxBufferHole: 0.7,
    manifestLoadingTimeOut: 10000,
    manifestLoadingMaxRetry: 3,
    manifestLoadingRetryDelay: 500,
    manifestLoadingMaxRetryTimeout: 4000,
    levelLoadingTimeOut: 10000,
    levelLoadingMaxRetry: 4,
    levelLoadingRetryDelay: 500,
    fragLoadingTimeOut: 20000,
    fragLoadingMaxRetry: 4,
    fragLoadingRetryDelay: 500,
    fragLoadingMaxRetryTimeout: 5000,
    enableWorker: true,
    xhrSetup: (xhr) => {
      if (tokenRef.current) xhr.setRequestHeader('Authorization', `Bearer ${tokenRef.current}`);
      xhr.setRequestHeader('Cache-Control', 'no-cache, no-store, max-age=0');
      xhr.setRequestHeader('Pragma', 'no-cache');
    },
  });

  const clearRecoveryTimer = () => {
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = null;
  };
  const clearWaitingTimer = () => {
    if (waitingTimer) clearTimeout(waitingTimer);
    waitingTimer = null;
  };
  const markConnected = (source) => {
    if (destroyed) return;
    const wasRecovering = recovering;
    recovering = false;
    networkRecoveries = 0;
    mediaRecoveries = 0;
    softRecoveries = 0;
    lastRecoveryDetails = null;
    clearRecoveryTimer();
    clearWaitingTimer();
    onState?.('connected', { recovered: wasRecovering, source, transport: 'hls.js' });
  };
  const failRecovery = (details = {}) => {
    if (destroyed) return;
    recovering = false;
    clearRecoveryTimer();
    clearWaitingTimer();
    onState?.('failed', {
      ...(lastRecoveryDetails || {}),
      ...details,
      recoveryTimedOut: Boolean(details.recoveryTimedOut),
    });
  };
  const armRecoveryWatchdog = () => {
    clearRecoveryTimer();
    recoveryTimer = setTimeout(() => {
      if (recovering) failRecovery({ recoveryTimedOut: true, recoveryTimeoutMs: RECOVERY_WATCHDOG_MS });
    }, RECOVERY_WATCHDOG_MS);
  };
  const beginRecovery = (details, action) => {
    if (destroyed) return;
    recovering = true;
    lastRecoveryDetails = details;
    onState?.('recovering', details);
    armRecoveryWatchdog();
    try { action(); } catch (error) {
      failRecovery({ reason: error?.message || String(error) });
    }
  };
  const reloadLiveSource = () => {
    try { hls.stopLoad(); } catch { /* ignored */ }
    activeSourceUrl = cacheBustUrl(url);
    hls.loadSource(activeSourceUrl);
    hls.startLoad(-1);
    seekToLiveEdge(hls, video);
    safePlay(video);
  };
  const resumeLiveLoad = () => {
    try { hls.stopLoad(); } catch { /* ignored */ }
    hls.startLoad(-1);
    seekToLiveEdge(hls, video);
    safePlay(video);
  };
  const recoverNetwork = (details) => {
    networkRecoveries += 1;
    if (networkRecoveries > MAX_NETWORK_RECOVERIES) {
      failRecovery({ ...details, reason: details.reason || 'network-recovery-exhausted', attempts: networkRecoveries });
      return;
    }
    const reloadManifest = /manifest|level/i.test(String(details.details || ''));
    beginRecovery({ ...details, attempt: networkRecoveries, stage: reloadManifest ? 'reload-source' : 'resume-load' }, () => {
      setTimeout(() => {
        if (destroyed || !recovering) return;
        if (reloadManifest) reloadLiveSource();
        else resumeLiveLoad();
      }, Math.min(250 * networkRecoveries, 750));
    });
  };
  const recoverMedia = (details) => {
    mediaRecoveries += 1;
    if (mediaRecoveries > MAX_MEDIA_RECOVERIES) {
      failRecovery({ ...details, reason: details.reason || 'media-recovery-exhausted', attempts: mediaRecoveries });
      return;
    }
    beginRecovery({ ...details, attempt: mediaRecoveries, stage: mediaRecoveries === 1 ? 'recover-media' : 'swap-audio-codec' }, () => {
      seekToLiveEdge(hls, video);
      if (mediaRecoveries > 1) hls.swapAudioCodec();
      hls.recoverMediaError();
      safePlay(video);
    });
  };
  const recoverSoftStall = (reason) => {
    if (destroyed || recovering) return;
    softRecoveries += 1;
    if (softRecoveries > MAX_SOFT_RECOVERIES) {
      failRecovery({ type: 'media', details: reason, reason: 'soft-stall-recovery-exhausted', attempts: softRecoveries });
      return;
    }
    beginRecovery({ type: 'media', details: reason, attempt: softRecoveries, stage: 'live-edge-resync' }, () => {
      seekToLiveEdge(hls, video);
      hls.startLoad(-1);
      safePlay(video);
    });
  };
  const onWaiting = () => {
    if (destroyed || video.paused || waitingTimer) return;
    waitingTimer = setTimeout(() => {
      waitingTimer = null;
      if (!destroyed && !video.paused && video.readyState < 3) recoverSoftStall('video-waiting');
    }, WAITING_GRACE_MS);
  };
  const onPlaying = () => markConnected('playing');
  const onTimeUpdate = () => {
    if (recovering && video.readyState >= 2 && !video.paused) markConnected('timeupdate');
  };

  video.addEventListener('playing', onPlaying);
  video.addEventListener('timeupdate', onTimeUpdate);
  video.addEventListener('waiting', onWaiting);
  video.addEventListener('stalled', onWaiting);

  hls.attachMedia(video);
  hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(activeSourceUrl));
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    safePlay(video);
    if (!recovering) markConnected('manifest-parsed');
  });
  hls.on(Hls.Events.FRAG_BUFFERED, () => {
    if (recovering) {
      seekToLiveEdge(hls, video);
      safePlay(video);
    }
  });
  hls.on(Hls.Events.ERROR, (_event, data) => {
    const details = {
      type: data.type,
      details: data.details,
      fatal: Boolean(data.fatal),
      responseCode: data.response?.code || null,
      reason: data.reason || data.error?.message || null,
      url: data.context?.url || null,
    };
    if (!data.fatal) {
      if (/bufferStalledError|bufferNudgeOnStall|bufferSeekOverHole/i.test(String(data.details || ''))) recoverSoftStall(data.details);
      return;
    }
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) recoverNetwork(details);
    else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) recoverMedia(details);
    else failRecovery(details);
  });

  return () => {
    destroyed = true;
    clearRecoveryTimer();
    clearWaitingTimer();
    video.removeEventListener('playing', onPlaying);
    video.removeEventListener('timeupdate', onTimeUpdate);
    video.removeEventListener('waiting', onWaiting);
    video.removeEventListener('stalled', onWaiting);
    hls.destroy();
    video.removeAttribute('src');
    try { video.load(); } catch { /* ignored */ }
  };
}

export { cacheBustUrl };
