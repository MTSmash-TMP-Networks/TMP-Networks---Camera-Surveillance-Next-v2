import { api } from './api.js';
import { connectWhep } from './whep.js';
import { connectHls } from './hlsPlayer.js';
import { runStreamCleanup } from '../utils/asyncCleanup.js';

function positiveSeconds(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// v2.18.1 used an effective browser cache of 0 seconds. That made route
// changes destroy the decoder immediately and caused visible reloads when
// switching between Kiosk and Live. Treat 0/invalid as the stable default.
const CACHE_MS = Math.max(10_000, positiveSeconds(import.meta.env.VITE_STREAM_BROWSER_CACHE_SECONDS, 120) * 1000);
const PREWARM_ENABLED = String(import.meta.env.VITE_STREAM_BROWSER_PREWARM_ENABLED || 'false').toLowerCase() !== 'false';
const TRANSCODE_FALLBACK = String(import.meta.env.VITE_BROWSER_TRANSCODE_FALLBACK_ENABLED || 'false').toLowerCase() === 'true';
const PLAYBACK_ORDER = String(import.meta.env.VITE_STREAM_PLAYBACK_ORDER || 'hls-first').trim().toLowerCase();
const STALL_MS = Math.max(8000, positiveSeconds(import.meta.env.VITE_STREAM_BROWSER_STALL_SECONDS, 30) * 1000);
const HEARTBEAT_MS = Math.max(8000, positiveSeconds(import.meta.env.VITE_STREAM_HEARTBEAT_SECONDS, 15) * 1000);
const HLS_RECOVERY_ESCALATION_MS = Math.max(6000, positiveSeconds(import.meta.env.VITE_HLS_RECOVERY_ESCALATION_SECONDS, 10) * 1000);
const PTZ_BROWSER_RESYNC_MS = Math.max(500, Number(import.meta.env.VITE_PTZ_BROWSER_RESYNC_MS || import.meta.env.PTZ_BROWSER_RESYNC_MS || 3500));

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function keyOf({ cameraId, quality, profileToken, purpose = 'live', transportMode = 'auto' }) { return `${cameraId}|${purpose}|${quality}|${profileToken || 'auto'}|${transportMode || 'auto'}`; }
function wantsLocalHls(entry) { return String(entry?.transportMode || '').toLowerCase() === 'local-hls'; }
function resetVideo(video) {
  try { video.pause(); } catch { /* ignored */ }
  video.srcObject = null;
  video.removeAttribute('src');
  try { video.load(); } catch { /* ignored */ }
}

function decodedFrames(video) {
  try {
    return Number(video.getVideoPlaybackQuality?.().totalVideoFrames || 0);
  } catch {
    return 0;
  }
}

function browserVisible() {
  return typeof document === 'undefined' || !document.hidden;
}

function hasActiveConsumer(entry) {
  return Boolean(entry && entry.refs > 0 && entry.host?.isConnected);
}

function hasRecentBrowserFrames(entry, maxAgeMs = STALL_MS) {
  if (!entry) return false;
  if (entry.state?.snapshotMode) return true;
  return Number(entry.lastFrameAt || 0) > 0 && Date.now() - Number(entry.lastFrameAt || 0) <= maxAgeMs;
}

function markBrowserProgress(entry, source = 'browser') {
  if (!entry) return;
  const now = Date.now();
  entry.lastFrameAt = now;
  entry.lastProgressSource = source;
  entry.frameVersion += 1;
}

function markTransportStatsProgress(entry, stats = {}) {
  if (!entry || !stats) return false;
  const framesDecoded = Number(stats.framesDecoded ?? NaN);
  const bytesReceived = Number(stats.bytesReceived ?? NaN);
  const packetsReceived = Number(stats.packetsReceived ?? NaN);
  const frameDelta = Number(stats.frameDelta || 0);
  const byteDelta = Number(stats.byteDelta || 0);
  const packetDelta = Number(stats.packetDelta || 0);
  const progressed = frameDelta > 0 || byteDelta > 0 || packetDelta > 0
    || (Number.isFinite(framesDecoded) && framesDecoded > Number(entry.lastStatsFramesDecoded || 0))
    || (Number.isFinite(bytesReceived) && bytesReceived > Number(entry.lastStatsBytesReceived || 0))
    || (Number.isFinite(packetsReceived) && packetsReceived > Number(entry.lastStatsPacketsReceived || 0));
  if (!progressed) return false;
  if (Number.isFinite(framesDecoded)) entry.lastStatsFramesDecoded = framesDecoded;
  if (Number.isFinite(bytesReceived)) entry.lastStatsBytesReceived = bytesReceived;
  if (Number.isFinite(packetsReceived)) entry.lastStatsPacketsReceived = packetsReceived;
  entry.lastStatsProgressAt = Date.now();
  markBrowserProgress(entry, 'webrtc-stats');
  return true;
}

function stopFrameProbe(entry) {
  if (!entry?.frameCallbackId || !entry.video?.cancelVideoFrameCallback) return;
  try { entry.video.cancelVideoFrameCallback(entry.frameCallbackId); } catch { /* ignored */ }
  entry.frameCallbackId = null;
}

function startFrameProbe(entry) {
  stopFrameProbe(entry);
  if (!entry.video?.requestVideoFrameCallback) return;
  let lastPresentedFrames = 0;
  const tick = (_now, metadata = {}) => {
    entry.frameCallbackObserved = true;
    const frames = Number(metadata.presentedFrames || 0);
    if (frames > lastPresentedFrames) {
      lastPresentedFrames = frames;
      entry.frameVersion = Math.max(entry.frameVersion || 0, frames);
      entry.frameCounterObserved = true;
      entry.lastDecodedFrames = Math.max(entry.lastDecodedFrames || 0, frames);
    }
    if (entry.video?.readyState >= 2 && !entry.video.paused) markBrowserProgress(entry, 'requestVideoFrameCallback');
    if (entry.monitor && entry.video?.requestVideoFrameCallback) entry.frameCallbackId = entry.video.requestVideoFrameCallback(tick);
  };
  entry.frameCallbackId = entry.video.requestVideoFrameCallback(tick);
}

function waitForPlaying(video, timeout = 12000, signal = null) {
  if (signal?.aborted) return Promise.reject(new DOMException('Verbindungsaufbau abgebrochen', 'AbortError'));
  if (!video.paused && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Keine Videodaten empfangen')); }, timeout);
    const success = () => { cleanup(); resolve(); };
    const aborted = () => { cleanup(); reject(new DOMException('Verbindungsaufbau abgebrochen', 'AbortError')); };
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('playing', success);
      video.removeEventListener('loadeddata', success);
      signal?.removeEventListener('abort', aborted);
    };
    video.addEventListener('playing', success, { once: true });
    video.addEventListener('loadeddata', success, { once: true });
    signal?.addEventListener('abort', aborted, { once: true });
  });
}


function waitForFrameProgress(video, timeout = 7000, signal = null) {
  if (signal?.aborted) return Promise.reject(new DOMException('Verbindungsaufbau abgebrochen', 'AbortError'));
  const initialFrames = decodedFrames(video);
  const initialTime = Number(video.currentTime || 0);
  return new Promise((resolve, reject) => {
    let frameCallbackId = null;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      if (frameCallbackId !== null && video.cancelVideoFrameCallback) {
        try { video.cancelVideoFrameCallback(frameCallbackId); } catch { /* ignored */ }
      }
      signal?.removeEventListener('abort', aborted);
      callback(value);
    };
    const progressed = () => decodedFrames(video) > initialFrames
      || Number(video.currentTime || 0) > initialTime + 0.02;
    const check = () => {
      if (progressed()) finish(resolve);
    };
    const aborted = () => finish(reject, new DOMException('Verbindungsaufbau abgebrochen', 'AbortError'));
    const timer = setTimeout(() => finish(reject, new Error('Browser hat keine fortlaufenden Videoframes dekodiert')), timeout);
    const poll = setInterval(check, 100);
    signal?.addEventListener('abort', aborted, { once: true });
    if (video.requestVideoFrameCallback) {
      frameCallbackId = video.requestVideoFrameCallback(() => finish(resolve));
    }
    check();
  });
}
async function waitForServerSession(entry, isStale, forceTranscode = false) {
  const input = {
    quality: entry.quality,
    viewportWidth: entry.viewportWidth,
    profileToken: entry.profileToken || null,
    purpose: entry.purpose || 'live',
    forceTranscode,
    wait: false,
  };
  let session = await api.streamSession(entry.cameraId, input);
  let trackedQuality = session.quality || input.quality;
  entry.update({ state: session.state === 'failed' ? 'failed' : 'starting', protocol: session.transport?.toUpperCase() || 'ONVIF', message: session.phaseMessage || 'Kamerastream wird vorbereitet …' });
  if (session.state === 'ready') {
    const ready = await api.streamSession(entry.cameraId, { ...input, quality: trackedQuality, wait: true });
    if (forceTranscode && !ready.forceTranscode) throw new Error('Browser-Transcode-Fallback ist serverseitig nicht verfügbar');
    return ready;
  }
  const deadline = Date.now() + 180000;
  const expectedPurposes = forceTranscode
    ? ['browser-fallback']
    : entry.purpose === 'kiosk'
      ? ['ingest']
      : entry.purpose === 'live'
        ? ['mainstream', 'live']
        : [entry.purpose || 'live'];
  let poll = 0;
  while (Date.now() < deadline) {
    if (isStale()) throw new DOMException('Verbindungsaufbau abgebrochen', 'AbortError');
    await sleep(700);
    const response = await api.streamStatus(entry.cameraId);
    const matchingSessions = (response.items || []).filter((item) => expectedPurposes.includes(item.purpose || 'live')
      && ((item.purpose || 'live') === 'mainstream' || !item.consumerPurpose || item.consumerPurpose === (entry.purpose || 'live')));
    const matching = matchingSessions.find((item) => item.quality === trackedQuality
      && (item.requestedProfileToken || '') === (entry.profileToken || '')) || matchingSessions[0];
    if (matching) {
      trackedQuality = matching.quality || trackedQuality;
      entry.update({ state: matching.state === 'failed' ? 'failed' : 'starting', protocol: matching.transport?.toUpperCase() || 'ONVIF', message: matching.phaseMessage || 'Streamstatus wird geprüft …' });
      if (matching.state === 'ready') {
        const ready = await api.streamSession(entry.cameraId, { ...input, quality: trackedQuality, wait: true });
        if (forceTranscode && !ready.forceTranscode) throw new Error('Browser-Transcode-Fallback ist serverseitig nicht verfügbar');
        return ready;
      }
      if (matching.state === 'failed') throw new Error(matching.lastError || matching.phaseMessage || 'Kamerastream konnte nicht gestartet werden');
    }
    poll += 1;
    if (poll % 20 === 0) session = await api.streamSession(entry.cameraId, { ...input, quality: trackedQuality, wait: false });
  }
  throw new Error('Zeitlimit beim Aufbau des Live-Streams überschritten');
}

class LiveStreamPool {
  constructor() {
    this.entries = new Map();
    this.staging = null;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.reconnectAll('Netzwerkverbindung wiederhergestellt'));
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) this.entries.forEach((entry) => this.ensure(entry));
      });
    }
  }

  clearHlsRecovery(entry) {
    if (!entry) return;
    if (entry.hlsRecoveryTimer) clearTimeout(entry.hlsRecoveryTimer);
    entry.hlsRecoveryTimer = null;
    entry.hlsRecoveryStartedAt = 0;
  }

  finishHlsRecovery(entry, source = 'media-progress', details = {}) {
    if (!entry) return;
    const wasRecovering = entry.state.state === 'recovering' || Boolean(entry.hlsRecoveryTimer);
    this.clearHlsRecovery(entry);
    if (!wasRecovering) return;
    markBrowserProgress(entry, `hls-recovered-${source}`);
    entry.update({ state: 'ready', message: `${entry.state.protocol || 'HLS'} \u00b7 Verbindung automatisch wiederhergestellt` });
    entry.video.play?.().catch(() => {});
    this.startMonitor(entry);
    this.report(entry, 'info', 'HLS_PLAYER_RECOVERED', 'HLS-Wiedergabe wurde ohne Seitenwechsel wiederhergestellt', entry.state.protocol || 'HLS', { source, recoveryMs: Date.now() - Number(entry.lastHlsRecoveryAt || Date.now()), ...details });
  }

  beginHlsRecovery(entry, details = {}) {
    if (!entry || !this.entries.has(entry.key)) return;
    if (entry.state.state !== 'recovering') {
      entry.lastHlsRecoveryAt = Date.now();
      entry.hlsRecoveryStartedAt = entry.lastHlsRecoveryAt;
    }
    entry.update({ state: 'recovering', message: 'HLS-Puffer wird automatisch repariert \u2026' });
    if (entry.hlsRecoveryTimer) return;
    entry.hlsRecoveryTimer = setTimeout(() => {
      entry.hlsRecoveryTimer = null;
      if (!this.entries.has(entry.key) || entry.state.state !== 'recovering') return;
      this.report(entry, 'warn', 'HLS_RECOVERY_ESCALATED', 'HLS-Puffer konnte nicht rechtzeitig repariert werden; Stream-Sitzung wird neu aufgebaut', entry.state.protocol || 'HLS', { recoveryMs: Date.now() - Number(entry.hlsRecoveryStartedAt || Date.now()), ...details });
      this.reconnect(entry, 'HLS-Wiederherstellung dauert zu lange \u2013 Stream wird neu verbunden \u2026', 0);
    }, HLS_RECOVERY_ESCALATION_MS);
  }

  stagingRoot() {
    if (this.staging || typeof document === 'undefined') return this.staging;
    const root = document.createElement('div');
    root.id = 'tmp-stream-cache';
    root.setAttribute('aria-hidden', 'true');
    Object.assign(root.style, { position: 'fixed', width: '1px', height: '1px', overflow: 'hidden', opacity: '0', pointerEvents: 'none', left: '-10000px', top: '-10000px' });
    document.body.appendChild(root);
    this.staging = root;
    return root;
  }

  create(options) {
    const video = document.createElement('video');
    video.className = 'live-layer';
    video.playsInline = true;
    video.autoplay = true;
    video.muted = true;
    const entry = {
      key: keyOf(options), cameraId: options.cameraId, quality: options.quality, profileToken: options.profileToken || '', purpose: options.purpose || 'live', transportMode: options.transportMode || 'auto', viewportWidth: options.viewportWidth || 1280,
      video, refs: 0, pins: new Set(), subscribers: new Set(), host: null, cleanup: null, abort: null,
      connectPromise: null, generation: 0, idleTimer: null, reconnectTimer: null, heartbeat: null, monitor: null, hlsRecoveryTimer: null, hlsRecoveryStartedAt: 0, lastHlsRecoveryAt: 0,
      reconnectAttempt: 0, forceTranscode: false, hlsTokenRef: { current: '' }, lastCurrentTime: 0, lastFrameAt: Date.now(), lastProgressSource: 'created', lastDecodedFrames: 0, frameCounterObserved: false, frameCallbackObserved: false, frameCallbackId: null, frameVersion: 0, lastStatsFramesDecoded: 0, lastStatsBytesReceived: 0, lastStatsPacketsReceived: 0, lastStatsProgressAt: 0, controlWatchTimer: null, controlActiveUntil: 0, lastUsedAt: Date.now(), lastBackendSoftStallReportAt: 0,
      state: { state: 'starting', protocol: null, message: 'Live-Stream wird vorbereitet …', hasAudio: null, snapshotMode: false },
      update: (patch) => {
        entry.state = { ...entry.state, ...patch };
        entry.video.classList.toggle('is-active', ['ready', 'recovering'].includes(entry.state.state) && !entry.state.snapshotMode);
        entry.subscribers.forEach((callback) => callback(entry.state));
      },
    };
    video.addEventListener('playing', () => {
      markBrowserProgress(entry, 'playing');
      entry.lastDecodedFrames = decodedFrames(video);
      entry.reconnectAttempt = 0;
      if (entry.state.state === 'recovering') this.finishHlsRecovery(entry, 'playing');
    });
    this.stagingRoot()?.appendChild(video);
    this.entries.set(entry.key, entry);
    return entry;
  }

  compatibleEntry(options) {
    const candidates = [...this.entries.values()].filter((entry) => entry.cameraId === options.cameraId
      && entry.purpose === (options.purpose || 'live')
      && (entry.transportMode || 'auto') === (options.transportMode || 'auto')
      && ['ready', 'connecting', 'recovering', 'starting'].includes(entry.state.state));
    return candidates.sort((left, right) => {
      const leftProfile = Number((left.profileToken || '') === (options.profileToken || ''));
      const rightProfile = Number((right.profileToken || '') === (options.profileToken || ''));
      if (leftProfile !== rightProfile) return rightProfile - leftProfile;
      const leftIdle = Number(left.refs === 0);
      const rightIdle = Number(right.refs === 0);
      if (leftIdle !== rightIdle) return rightIdle - leftIdle;
      return Number(right.lastUsedAt || 0) - Number(left.lastUsedAt || 0);
    })[0] || null;
  }

  acquire(options, host, subscriber) {
    const key = keyOf(options);
    const entry = this.entries.get(key)
      || (options.allowCompatibleReuse ? this.compatibleEntry(options) : null)
      || this.create(options);
    entry.viewportWidth = options.viewportWidth || entry.viewportWidth;
    entry.lastUsedAt = Date.now();
    entry.refs += 1;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
    entry.subscribers.add(subscriber);
    subscriber(entry.state);
    entry.host = host;
    host.appendChild(entry.video); // Moving the same node keeps MediaSource/WebRTC alive.
    entry.video.muted = options.muted !== false;
    if (entry.state.state === 'ready') {
      entry.video.play?.().catch(() => this.reconnect(entry, 'Browser-Wiedergabe wird nach dem Ansichtswechsel neu synchronisiert …', 0));
      this.startMonitor(entry);
    } else {
      this.ensure(entry);
    }
    let released = false;
    return {
      entry,
      setMuted: (muted) => { entry.video.muted = muted; },
      reconnect: () => this.reconnect(entry, 'Manuell neu verbunden', 0),
      release: () => {
        if (released) return;
        released = true;
        entry.refs = Math.max(0, entry.refs - 1);
        entry.lastUsedAt = Date.now();
        entry.subscribers.delete(subscriber);
        if (entry.refs === 0) {
          this.stagingRoot()?.appendChild(entry.video);
          entry.host = null;
          if (entry.pins.size === 0) entry.idleTimer = setTimeout(() => this.destroy(entry.key), CACHE_MS);
        }
      },
    };
  }

  prewarm(options, reason = 'configured-camera') {
    if (!PREWARM_ENABLED || !options?.cameraId) return null;
    const entry = this.entries.get(keyOf(options))
      || this.compatibleEntry({ ...options, profileToken: options.profileToken || '' })
      || this.create(options);
    entry.viewportWidth = options.viewportWidth || entry.viewportWidth;
    entry.lastUsedAt = Date.now();
    entry.pins.add(reason);
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
    if (!entry.host) this.stagingRoot()?.appendChild(entry.video);
    entry.video.muted = true;
    this.ensure(entry);
    return entry;
  }

  unpinCamera(cameraId, reason = 'configured-camera') {
    for (const entry of this.entries.values()) {
      if (String(entry.cameraId) !== String(cameraId)) continue;
      entry.pins.delete(reason);
      if (entry.refs === 0 && entry.pins.size === 0 && !entry.idleTimer) {
        entry.idleTimer = setTimeout(() => this.destroy(entry.key), CACHE_MS);
      }
    }
  }

  syncPersistentCameras(cameras = []) {
    if (!PREWARM_ENABLED) return;
    const activeIds = new Set(cameras.filter((camera) => camera?.enabled !== false).map((camera) => String(camera.id)));
    for (const camera of cameras) {
      if (!camera?.id || camera.enabled === false) continue;
      this.prewarm({
        cameraId: camera.id,
        quality: 'low',
        profileToken: '',
        purpose: 'kiosk',
        transportMode: 'local-hls',
        viewportWidth: 1280,
      });
    }
    for (const entry of this.entries.values()) {
      if (entry.pins.has('configured-camera') && !activeIds.has(String(entry.cameraId))) {
        entry.pins.delete('configured-camera');
        if (entry.refs === 0 && entry.pins.size === 0 && !entry.idleTimer) {
          entry.idleTimer = setTimeout(() => this.destroy(entry.key), CACHE_MS);
        }
      }
    }
  }

  report(entry, level, code, message, protocol = 'browser', details = {}) {
    api.streamClientEvent(entry.cameraId, { level, code, message, protocol, details }).catch(() => {});
  }

  ensure(entry) {
    if (entry.connectPromise || entry.state.state === 'ready' || entry.state.state === 'connecting') return entry.connectPromise;
    entry.connectPromise = this.connect(entry).finally(() => { entry.connectPromise = null; });
    return entry.connectPromise;
  }

  async connect(entry) {
    const generation = ++entry.generation;
    const stale = () => generation !== entry.generation;
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
    this.clearHlsRecovery(entry);
    if (entry.abort) entry.abort.abort();
    stopFrameProbe(entry);
    if (entry.heartbeat) clearInterval(entry.heartbeat);
    if (entry.monitor) clearInterval(entry.monitor);
    entry.heartbeat = null;
    entry.monitor = null;
    await runStreamCleanup(entry.cleanup);
    entry.cleanup = null;
    entry.abort = new AbortController();
    entry.forceTranscode = false;
    resetVideo(entry.video);
    entry.update({ state: 'starting', protocol: null, message: 'Stream-Sitzung wird vorbereitet …', hasAudio: null, snapshotMode: false });

    const attempts = TRANSCODE_FALLBACK ? [false, true] : [false];
    let lastError = null;
    for (const forceTranscode of attempts) {
      if (stale()) return;
      try {
        if (forceTranscode) {
          entry.update({ state: 'starting', protocol: null, message: 'Direkte Wiedergabe nicht möglich – Browser-Fallback wird nur für diese Ansicht gestartet …' });
          this.report(entry, 'warn', 'BROWSER_TRANSCODE_FALLBACK_START', wantsLocalHls(entry) ? 'Lokaler HLS-Ring schlug fehl; separater Browser-Transcode wird als lokaler HLS-Ring gestartet' : 'Direkte WebRTC- und HLS-Wiedergabe schlug fehl; separater Browser-Transcode wird gestartet', 'browser', { error: lastError?.message, purpose: entry.purpose, transportMode: entry.transportMode });
        }
        const session = await waitForServerSession(entry, stale, forceTranscode);
        if (stale()) return;
        await this.connectSession(entry, session, stale, forceTranscode);
        return;
      } catch (error) {
        if (stale() || error?.name === 'AbortError') return;
        lastError = error;
        await runStreamCleanup(entry.cleanup);
        entry.cleanup = null;
        resetVideo(entry.video);
        if (!forceTranscode && TRANSCODE_FALLBACK) continue;
      }
    }

    const error = lastError || new Error('Livebild nicht verfügbar');
    entry.update({ state: 'failed', protocol: null, message: error.message || 'Livebild nicht verfügbar' });
    this.report(entry, 'error', 'LIVE_CONNECT_FAILED', 'Liveansicht konnte nicht aufgebaut werden', 'browser', { error: error.message, purpose: entry.purpose, forceTranscode: entry.forceTranscode });
    this.reconnect(entry, 'Verbindung wird automatisch wiederhergestellt …');
  }

  async connectSession(entry, session, stale, forceTranscode) {
    entry.forceTranscode = Boolean(forceTranscode);
    entry.hlsTokenRef.current = session.tokens?.hls || '';
    entry.update({ hasAudio: Boolean(session.media?.audio) });
    if (session.mode === 'snapshot') {
      entry.update({ state: 'ready', protocol: 'Snapshot', message: 'Snapshot-Livemodus · stabiler Notfallweg ohne Audio', hasAudio: false, snapshotMode: true });
      this.startHeartbeat(entry);
      return;
    }

    const forceLocalHls = wantsLocalHls(entry) || session.mode === 'local-hls-ring';
    const preferHlsFirst = forceLocalHls || PLAYBACK_ORDER !== 'webrtc-first';
    const localHlsUrl = session.localHlsUrl || (session.hlsUrl && session.hlsUrl.includes('/live-hls/') ? session.hlsUrl : null);
    let hlsError = new Error(forceLocalHls ? 'Lokaler HLS-Ring ist nicht verfügbar' : 'HLS-Ausgabe ist nicht verfügbar');
    let webrtcError = new Error('WebRTC-Ausgabe ist nicht verfügbar');

    const tryHls = async () => {
      const hlsSourceUrl = forceLocalHls ? localHlsUrl : (localHlsUrl || session.hlsUrl);
      if (!hlsSourceUrl) throw hlsError;
      entry.update({ state: 'connecting', protocol: forceLocalHls ? 'Local-HLS' : 'LL-HLS', message: forceLocalHls ? 'Lokaler HLS-Ring wird verbunden …' : preferHlsFirst ? 'Low-Latency-HLS wird gestartet …' : 'WebRTC nicht verfügbar – Low-Latency-HLS wird gestartet …' });
      const cleanup = connectHls({
        url: hlsSourceUrl, tokenRef: entry.hlsTokenRef, video: entry.video,
        onState: (state, details = {}) => {
          if (stale()) return;
          if (state === 'connected') {
            if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
            entry.reconnectTimer = null;
            entry.reconnectAttempt = 0;
            if (details.recovered || entry.state.state === 'recovering') this.finishHlsRecovery(entry, details.source || 'hls-event', details);
          }
          if (state === 'recovering') this.beginHlsRecovery(entry, details);
          if (state === 'failed') {
            this.clearHlsRecovery(entry);
            this.report(entry, 'warn', 'HLS_PLAYER_FATAL', 'HLS-Player meldet einen fatalen Fehler', forceLocalHls ? 'Local-HLS' : 'LL-HLS', details);
            if (['ready', 'recovering'].includes(entry.state.state)) this.reconnect(entry, 'HLS-Verbindung wird sofort neu aufgebaut \u2026', 0);
          }
        },
      });
      entry.cleanup = cleanup;
      await waitForPlaying(entry.video, 18000, entry.abort.signal);
      await waitForFrameProgress(entry.video, 10000, entry.abort.signal);
      if (stale()) return true;
      entry.update({ state: 'ready', protocol: forceLocalHls ? 'Local-HLS' : 'LL-HLS', message: forceTranscode ? `${session.profile?.name || 'Live'} · Browser-Fallback aktiv` : forceLocalHls ? `${session.profile?.name || 'Live'} · lokaler HLS-Ring` : `${session.profile?.name || 'Live'} · stabiler Live-Stream` });
      this.startHeartbeat(entry);
      this.startMonitor(entry);
      this.report(entry, 'info', forceTranscode ? 'HLS_FALLBACK_PLAYING' : forceLocalHls ? 'LOCAL_HLS_PLAYING' : 'HLS_PLAYING', forceTranscode ? 'Browser spielt den bedarfsgesteuerten lokalen HLS-Transcode ab' : forceLocalHls ? 'Browser spielt den lokalen HLS-Ring ab' : 'Browser spielt den HLS-Livestream ab', forceLocalHls ? 'Local-HLS' : 'LL-HLS', { url: hlsSourceUrl, transportMode: entry.transportMode });
      return true;
    };

    const tryWhep = async () => {
      if (!session.webrtcUrl || !session.tokens?.webrtc) throw webrtcError;
      entry.update({ state: 'connecting', protocol: 'WebRTC', message: `${session.profile?.name || 'Kameraprofil'} · WebRTC wird verbunden …` });
      const cleanup = await connectWhep({
        url: session.webrtcUrl, token: session.tokens.webrtc, video: entry.video, signal: entry.abort.signal,
        includeAudio: Boolean(session.webrtcAudio),
        onStats: (stats) => {
          entry.state.stats = stats;
          markTransportStatsProgress(entry, stats);
        },
        onState: (state) => {
          if (stale()) return;
          if (state === 'connected') {
            if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
            entry.reconnectTimer = null;
            entry.reconnectAttempt = 0;
            if (entry.state.state === 'recovering') entry.update({ state: 'ready', protocol: 'WebRTC', message: `${session.profile?.name || 'Live'} · Verbindung wiederhergestellt` });
          }
          if (state === 'failed' && ['ready', 'recovering'].includes(entry.state.state)) this.reconnect(entry, 'WebRTC-Verbindung wird wiederhergestellt …', 1000);
          if (state === 'disconnected' && ['ready', 'recovering'].includes(entry.state.state)) this.reconnect(entry, 'WebRTC-Verbindung wurde unterbrochen …', 3000);
        },
      });
      if (stale()) { await cleanup(); return true; }
      entry.cleanup = cleanup;
      await waitForPlaying(entry.video, 9000, entry.abort.signal);
      await waitForFrameProgress(entry.video, 7000, entry.abort.signal);
      if (stale()) return true;
      entry.update({ state: 'ready', protocol: 'WebRTC', message: forceTranscode ? `${session.profile?.name || 'Live'} · Browser-Fallback aktiv` : `${session.profile?.name || 'Live'} · niedrige Latenz` });
      this.startHeartbeat(entry);
      this.startMonitor(entry);
      this.report(entry, 'info', forceTranscode ? 'WEBRTC_FALLBACK_PLAYING' : 'WEBRTC_PLAYING', forceTranscode ? 'Browser spielt den bedarfsgesteuerten WebRTC-Transcode ab' : 'Browser spielt den WebRTC-Stream direkt ab', 'WebRTC');
      return true;
    };

    const attempts = forceLocalHls ? [tryHls] : preferHlsFirst ? [tryHls, tryWhep] : [tryWhep, tryHls];
    for (const attempt of attempts) {
      try {
        const ok = await attempt();
        if (ok) return;
      } catch (error) {
        if (error?.name === 'AbortError' || stale()) throw error;
        if (attempt === tryHls) {
          hlsError = error;
          this.report(entry, preferHlsFirst ? 'error' : 'warn', forceLocalHls ? 'LOCAL_HLS_CONNECT_FAILED' : 'HLS_CONNECT_FAILED', forceLocalHls ? 'Browser konnte den lokalen HLS-Ring nicht abspielen' : preferHlsFirst ? 'Browser konnte den HLS-Livestream nicht abspielen' : 'Browser konnte auch den HLS-Fallback nicht abspielen', forceLocalHls ? 'Local-HLS' : 'LL-HLS', { error: error.message, purpose: entry.purpose, forceTranscode, transportMode: entry.transportMode });
        } else {
          webrtcError = error;
          this.report(entry, 'warn', 'WEBRTC_CONNECT_FAILED', 'Browser konnte WebRTC/WHEP nicht abspielen; HLS-Fallback wird versucht', 'WebRTC', { error: error.message, purpose: entry.purpose, forceTranscode });
        }
        await runStreamCleanup(entry.cleanup);
        entry.cleanup = null;
        resetVideo(entry.video);
      }
    }
    throw hlsError || webrtcError;
  }

  startHeartbeat(entry) {
    if (entry.heartbeat) clearInterval(entry.heartbeat);
    entry.heartbeat = setInterval(async () => {
      try {
        const heartbeat = await api.streamHeartbeat(entry.cameraId, { quality: entry.quality, viewportWidth: entry.viewportWidth, profileToken: entry.profileToken || null, purpose: entry.purpose || 'live', forceTranscode: entry.forceTranscode });
        const session = heartbeat.session || heartbeat;
        entry.hlsTokenRef.current = heartbeat.tokens?.hls || session?.tokens?.hls || entry.hlsTokenRef.current;
        const backendFailed = session?.state === 'failed' || session?.ffmpegRunning === false;
        const backendSoftStall = Boolean(session?.stalled || Number(session?.progressAgeMs || 0) > STALL_MS * 1.5);
        if (backendFailed) {
          this.report(entry, 'warn', 'BACKEND_STREAM_HEARTBEAT_FAILED', 'Backend meldet einen ausgefallenen Streamprozess', entry.state.protocol || 'browser', { progressAgeMs: session?.progressAgeMs, stalled: session?.stalled, ffmpegRunning: session?.ffmpegRunning });
          if (hasActiveConsumer(entry)) this.reconnect(entry, 'Backend-Stream wird wiederhergestellt …', 0);
        } else if (backendSoftStall && hasActiveConsumer(entry) && browserVisible() && !hasRecentBrowserFrames(entry, STALL_MS)) {
          this.report(entry, 'warn', 'BACKEND_STREAM_HEARTBEAT_STALLED', 'Backend und Browser liefern keine neuen Frames; Verbindung wird neu aufgebaut', entry.state.protocol || 'browser', { progressAgeMs: session?.progressAgeMs, stalled: session?.stalled });
          this.reconnect(entry, 'Backend-Heartbeat fordert Neuverbindung an …', 0);
        } else if (backendSoftStall) {
          const now = Date.now();
          if (now - Number(entry.lastBackendSoftStallReportAt || 0) > 60000) {
            entry.lastBackendSoftStallReportAt = now;
            this.report(entry, 'debug', 'BACKEND_STREAM_SOFT_STALL_IGNORED', 'Backend-Fortschritt wirkt alt, Browserstream wird aber nicht aggressiv neu gestartet', entry.state.protocol || 'browser', { progressAgeMs: session?.progressAgeMs, stalled: session?.stalled, activeConsumer: hasActiveConsumer(entry), browserVisible: browserVisible(), recentFrames: hasRecentBrowserFrames(entry, STALL_MS) });
          }
          if (session?.state === 'ready' && entry.state.state === 'ready') entry.update({ backendHeartbeatAt: heartbeat.serverTime || session.heartbeatAt || new Date().toISOString() });
        } else if (session?.state === 'ready' && entry.state.state === 'ready') {
          entry.update({ backendHeartbeatAt: heartbeat.serverTime || session.heartbeatAt || new Date().toISOString() });
        }
      } catch { /* Active media remains usable; monitor handles a real stall. */ }
    }, HEARTBEAT_MS);
  }

  startMonitor(entry) {
    if (entry.monitor) clearInterval(entry.monitor);
    stopFrameProbe(entry);
    entry.lastCurrentTime = entry.video.currentTime || 0;
    entry.lastDecodedFrames = decodedFrames(entry.video);
    entry.frameCounterObserved = entry.lastDecodedFrames > 0;
    entry.frameCallbackObserved = false;
    markBrowserProgress(entry, 'monitor-start');
    startFrameProbe(entry);
    entry.monitor = setInterval(() => {
      if (entry.state.snapshotMode || !['ready', 'recovering'].includes(entry.state.state)) return;
      // Cached / hidden video nodes are intentionally kept warm between pages.
      // Browsers may throttle them, so they must not trigger reconnect storms.
      if (!hasActiveConsumer(entry) || !browserVisible()) return;
      const frames = decodedFrames(entry.video);
      const current = entry.video.currentTime || 0;
      if (frames > 0) entry.frameCounterObserved = true;
      const frameAdvanced = frames > entry.lastDecodedFrames;
      const timelineAdvanced = current > entry.lastCurrentTime + 0.05;
      const statsAdvanced = Number(entry.lastStatsProgressAt || 0) > Number(entry.lastMonitorStatsProgressAt || 0);
      const hasReliableFrameSignal = entry.frameCounterObserved || entry.frameCallbackObserved || Number(entry.lastStatsProgressAt || 0) > 0;
      if (frameAdvanced || timelineAdvanced || statsAdvanced) {
        if (entry.state.state === 'recovering') this.finishHlsRecovery(entry, frameAdvanced ? 'decoded-frames' : statsAdvanced ? 'transport-stats' : 'media-timeline');
        entry.lastDecodedFrames = Math.max(frames, entry.lastDecodedFrames || 0);
        entry.lastCurrentTime = current;
        entry.lastMonitorStatsProgressAt = Number(entry.lastStatsProgressAt || 0);
        markBrowserProgress(entry, frameAdvanced ? 'decoded-frames' : statsAdvanced ? 'webrtc-stats' : 'media-timeline');
      } else if (!entry.video.paused && Date.now() - entry.lastFrameAt > STALL_MS) {
        this.report(entry, 'warn', 'BROWSER_STREAM_STALLED', 'Browserstream lieferte keine neuen Frames', entry.state.protocol || 'browser', { decodedFrames: frames, currentTime: current, hasReliableFrameSignal, lastProgressSource: entry.lastProgressSource });
        this.reconnect(entry, 'Stillstehenden Stream erkannt – Verbindung wird erneuert …', 0);
      }
    }, 2500);
  }

  reconnect(entry, message, requestedDelay = null) {
    if (!this.entries.has(entry.key)) return;
    this.clearHlsRecovery(entry);
    if (!hasActiveConsumer(entry) && entry.pins.size === 0) return;
    entry.update({ state: 'recovering', message });
    if (entry.reconnectTimer) return;
    const delay = requestedDelay ?? Math.min(1000 * (2 ** Math.min(entry.reconnectAttempt, 5)), 30000);
    entry.reconnectAttempt += 1;
    entry.reconnectTimer = setTimeout(() => {
      entry.reconnectTimer = null;
      const pending = entry.connectPromise;
      entry.generation += 1; // Invalidates the current asynchronous connect path.
      entry.abort?.abort();
      entry.state.state = 'starting';
      const restart = () => {
        if (!this.entries.has(entry.key)) return;
        this.ensure(entry);
      };
      // A transport callback can request reconnect while connect() still owns
      // the single-flight promise. Restart only after that promise is released.
      if (pending) Promise.resolve(pending).catch(() => {}).finally(restart);
      else restart();
    }, delay);
  }

  activeCameraEntries(cameraId) {
    return [...this.entries.values()].filter((entry) => String(entry.cameraId) === String(cameraId)
      && (entry.refs > 0 || entry.host || entry.pins.size > 0));
  }

  markControlActivity(cameraId, reason = 'ptz-move') {
    const until = Date.now() + Math.max(PTZ_BROWSER_RESYNC_MS, 1500);
    for (const entry of this.activeCameraEntries(cameraId)) {
      entry.controlActiveUntil = until;
      if (entry.controlWatchTimer) clearTimeout(entry.controlWatchTimer);
      entry.controlWatchTimer = null;
      if (entry.state.state === 'ready') {
        entry.update({ message: `${entry.state.protocol || 'Live'} · PTZ aktiv` });
      }
      this.report(entry, 'debug', 'PTZ_BROWSER_CONTROL_ACTIVITY', 'PTZ-Aktivitaet wurde fuer den Browserstream markiert', entry.state.protocol || 'browser', { reason });
    }
  }

  verifyAfterControl(cameraId, reason = 'ptz-stop') {
    for (const entry of this.activeCameraEntries(cameraId)) {
      if (entry.controlWatchTimer) clearTimeout(entry.controlWatchTimer);
      const generation = entry.generation;
      const beforeFrames = decodedFrames(entry.video);
      const beforeFrameVersion = Number(entry.frameVersion || 0);
      const beforeTime = Number(entry.video?.currentTime || 0);
      const beforeFrameAt = Number(entry.lastFrameAt || 0);
      const beforeStatsProgressAt = Number(entry.lastStatsProgressAt || 0);
      entry.controlActiveUntil = 0;
      entry.controlWatchTimer = setTimeout(() => {
        entry.controlWatchTimer = null;
        if (!this.entries.has(entry.key) || generation !== entry.generation) return;
        if (entry.state.snapshotMode || !['ready', 'recovering', 'connecting'].includes(entry.state.state)) return;
        const afterFrames = decodedFrames(entry.video);
        const afterFrameVersion = Number(entry.frameVersion || 0);
        const afterTime = Number(entry.video?.currentTime || 0);
        const now = Date.now();
        const frameAdvanced = afterFrames > beforeFrames || afterFrameVersion > beforeFrameVersion;
        const timelineAdvanced = afterTime > beforeTime + 0.05;
        const recentlyRendered = Number(entry.lastFrameAt || 0) > beforeFrameAt && now - Number(entry.lastFrameAt || 0) < Math.max(PTZ_BROWSER_RESYNC_MS, 1500);
        const statsAdvanced = Number(entry.lastStatsProgressAt || 0) > beforeStatsProgressAt;
        if (frameAdvanced || timelineAdvanced || recentlyRendered || statsAdvanced) {
          this.report(entry, 'debug', 'PTZ_BROWSER_CONTINUITY_OK', 'PTZ beendet; Browserstream liefert weiter Frames, kein Neuaufbau erforderlich', entry.state.protocol || 'browser', {
            reason, beforeFrames, afterFrames, beforeTime, afterTime,
          });
          return;
        }
        this.report(entry, 'warn', 'PTZ_BROWSER_RESYNC_NEEDED', 'PTZ beendet; Browserstream liefert keine neuen Frames und wird neu verbunden', entry.state.protocol || 'browser', {
          reason, beforeFrames, afterFrames, beforeTime, afterTime,
        });
        this.reconnect(entry, 'PTZ beendet – Livebild wird neu synchronisiert …', 0);
      }, PTZ_BROWSER_RESYNC_MS);
    }
  }

  reconnectAll(message) { this.entries.forEach((entry) => this.reconnect(entry, message, 0)); }

  async destroy(key) {
    const entry = this.entries.get(key);
    if (!entry || entry.refs > 0 || entry.pins.size > 0) return;
    this.entries.delete(key);
    entry.generation += 1;
    if (entry.abort) entry.abort.abort();
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    this.clearHlsRecovery(entry);
    if (entry.controlWatchTimer) clearTimeout(entry.controlWatchTimer);
    if (entry.heartbeat) clearInterval(entry.heartbeat);
    if (entry.monitor) clearInterval(entry.monitor);
    stopFrameProbe(entry);
    if (entry.heartbeat) clearInterval(entry.heartbeat);
    if (entry.monitor) clearInterval(entry.monitor);
    entry.heartbeat = null;
    entry.monitor = null;
    await runStreamCleanup(entry.cleanup);
    entry.cleanup = null;
    resetVideo(entry.video);
    entry.video.remove();
  }

  async destroyAll({ force = false } = {}) {
    if (force) this.entries.forEach((entry) => entry.pins.clear());
    return Promise.all([...this.entries.keys()].map((key) => this.destroy(key)));
  }
}

export const liveStreamPool = new LiveStreamPool();
