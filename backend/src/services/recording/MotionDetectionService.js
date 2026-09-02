import { spawn } from 'node:child_process';
import { config } from '../../config.js';
import { cameraRepository } from '../cameraRepository.js';
import { cameraEventLog, sanitizeLogText } from '../CameraEventLog.js';
import { snapshotService } from '../media/SnapshotService.js';
import { streamOrchestrator } from '../media/StreamOrchestrator.js';
import { buildMediaInputArgs } from '../media/FfmpegInputOptions.js';
import { prepareMediaReadSource } from '../media/MediaReadAuth.js';
import { authService } from '../authService.js';
import { recordingPolicyRepository } from './RecordingPolicyRepository.js';
import { recordingEventDispatcher } from './RecordingEventDispatcher.js';
import { logger } from '../../utils/logger.js';
import { cameraRuntimeCoordinator, PtzActiveError } from '../runtime/CameraRuntimeCoordinator.js';
import { motionZoneKey, normalizeMotionZone } from './MotionZone.js';

export {
  chooseMotionComparison,
  compareMotionFrames,
  hasActiveMotionPlan,
  pushMotionWindow,
  selectMotionBaseline,
  summarizeMotionWindow,
} from './MotionDetectionAlgorithm.js';
import {
  chooseMotionComparison,
  compareMotionFrames,
  hasActiveMotionPlan,
  pushMotionWindow,
  selectMotionBaseline,
  summarizeMotionWindow,
} from './MotionDetectionAlgorithm.js';

const ERROR_LOG_COOLDOWN_MS = 60_000;
const REARM_LOG_COOLDOWN_MS = 30_000;

async function mapLimit(items, limit, mapper) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(Math.max(1, limit), queue.length || 1) }, async () => {
    while (queue.length) await mapper(queue.shift());
  });
  await Promise.all(workers);
}

function hlsUrlForPath(mediaPath) {
  const base = String(config.go2RtcHlsInternal || '').replace(/\/$/, '');
  return `${base}/api/stream.m3u8?src=${encodeURIComponent(String(mediaPath || '').replace(/^\//, ''))}`;
}

function rtspUrlForPath(mediaPath) {
  const base = String(config.go2RtcPublishBase || '').replace(/\/$/, '');
  return `${base}/${String(mediaPath || '').replace(/^\//, '')}`;
}

function noCacheReadUri(uri) {
  try {
    const parsed = new URL(uri);
    if (['http:', 'https:'].includes(parsed.protocol.toLowerCase())) {
      parsed.searchParams.set('_motion', `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    }
    return parsed.toString();
  } catch {
    return uri;
  }
}

function grayVideoFilter(width, height) {
  const filters = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
    'format=gray',
  ];
  const blurRadius = Math.max(0, Math.min(4, Number(config.motionDetectionBlurRadius) || 0));
  if (blurRadius > 0) filters.push(`boxblur=luma_radius=${blurRadius}:luma_power=1`);
  return filters.join(',');
}

function checkedGrayFrame(chunks, { width, height, label }) {
  const expectedBytes = Number(width) * Number(height);
  const frame = Buffer.concat(chunks);
  if (frame.length < expectedBytes) {
    throw new Error(`${label} lieferte nur ${frame.length} von ${expectedBytes} erwarteten Graustufenbytes`);
  }
  // FFmpeg should emit exactly one frame. Trimming protects the comparator from
  // builds that flush a few trailing bytes while still rejecting short frames.
  return frame.subarray(0, expectedBytes);
}

function decodeSnapshotToGray(buffer, { width, height, timeoutMs = 7000, signal = null } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-nostdin', '-loglevel', 'error',
      '-f', 'image2pipe', '-vcodec', 'mjpeg', '-i', 'pipe:0',
      '-frames:v', '1', '-vf', grayVideoFilter(width, height),
      '-f', 'rawvideo', 'pipe:1',
    ];
    const child = spawn(config.ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let stderr = '';
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already exited */ }
      finish(reject, new Error('Motion-Snapshot-Konvertierung lief in ein Zeitlimit'));
    }, timeoutMs);
    timer.unref?.();
    const abort = () => {
      try { child.kill('SIGKILL'); } catch { /* already exited */ }
      finish(reject, signal?.reason || new Error('Motion-Snapshot-Konvertierung wurde abgebrochen'));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-1200); });
    child.once('error', (error) => finish(reject, error));
    child.once('exit', (code) => {
      if (code !== 0) {
        finish(reject, new Error(stderr || `FFmpeg ${code}`));
        return;
      }
      try { finish(resolve, checkedGrayFrame(chunks, { width, height, label: 'Motion-Snapshot' })); }
      catch (error) { finish(reject, error); }
    });
    child.stdin.on('error', () => { /* process may exit before input has flushed */ });
    child.stdin.end(buffer);
  });
}

function captureStreamToGray(uri, { width, height, timeoutMs = 9000, mediaToken = null, signal = null } = {}) {
  return new Promise((resolve, reject) => {
    const preparedSource = prepareMediaReadSource(noCacheReadUri(uri), mediaToken);
    const args = [
      '-hide_banner', '-nostdin', '-loglevel', 'error',
      ...buildMediaInputArgs(preparedSource.uri, 'tcp'),
      '-analyzeduration', '1000000', '-probesize', '1000000',
      ...preparedSource.inputArgs,
      '-i', preparedSource.uri,
      '-map', '0:v:0', '-frames:v', '1',
      '-vf', grayVideoFilter(width, height),
      '-f', 'rawvideo', 'pipe:1',
    ];
    const child = spawn(config.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let stderr = '';
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already exited */ }
      finish(reject, new Error('Motion-Liveframe-Zeitlimit ueberschritten'));
    }, timeoutMs);
    timer.unref?.();
    const abort = () => {
      try { child.kill('SIGKILL'); } catch { /* already exited */ }
      finish(reject, signal?.reason || new Error('Motion-Liveframe-Erfassung wurde abgebrochen'));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-1200); });
    child.once('error', (error) => finish(reject, error));
    child.once('exit', (code) => {
      if (code !== 0) {
        finish(reject, new Error(stderr || `FFmpeg ${code}`));
        return;
      }
      try { finish(resolve, checkedGrayFrame(chunks, { width, height, label: 'Motion-Liveframe' })); }
      catch (error) { finish(reject, error); }
    });
  });
}

function liveSourceCandidates(sourceMode, mediaPath) {
  const rtsp = { name: 'live-rtsp', uri: rtspUrlForPath(mediaPath) };
  const hls = { name: 'live-hls', uri: hlsUrlForPath(mediaPath) };
  if (['hls', 'live-hls', 'hls-only'].includes(sourceMode)) return [hls];
  if (['rtsp', 'live-rtsp', 'rtsp-only'].includes(sourceMode)) return [rtsp];
  return [rtsp, hls];
}

function comparisonOptions(camera = null) {
  return {
    width: config.motionDetectionFrameWidth,
    height: config.motionDetectionFrameHeight,
    pixelThreshold: config.motionDetectionPixelThreshold,
    minChangedRatio: config.motionDetectionMinChangedRatio,
    minAverageDiff: config.motionDetectionMinAverageDiff,
    minChangedPixels: config.motionDetectionMinChangedPixels,
    maxShiftPixels: config.motionDetectionStabilizationPixels,
    compensateBrightness: config.motionDetectionBrightnessCompensation,
    sceneChangeRatio: config.motionDetectionSceneChangeRatio,
    sceneChangeMinAverageDiff: config.motionDetectionSceneChangeMinAverageDiff,
    suppressSceneChanges: config.motionDetectionSuppressSceneChanges,
    motionZone: normalizeMotionZone(camera?.motionZone),
  };
}

function cleanSeconds(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function createState() {
  return {
    previousFrame: null,
    referenceFrame: null,
    lastFrameSourceKey: null,
    referenceSourceKey: null,
    motionActive: false,
    motionArmed: true,
    motionWindow: [],
    motionEpisodeId: 0,
    eventSequence: 0,
    lastMotionAt: 0,
    lastEventAt: 0,
    lastDetectedAt: 0,
    lastQuietStartedAt: 0,
    lastRearmedAt: 0,
    lastRearmLoggedAt: 0,
    lastEventId: null,
    lastError: null,
    motionZoneKey: null,
    motionZone: null,
    consecutiveErrors: 0,
    lastErrorLoggedAt: 0,
    lastLoggedError: null,
  };
}

class MotionDetectionService {
  constructor() {
    this.timer = null;
    this.running = false;
    this.states = new Map();
    this.leases = new Map();
    this.lastRunAt = null;
    this.lastCompletedAt = null;
    this.lastError = null;
  }

  mediaTokenForLease(lease) {
    const ttlSeconds = Math.max(60, Number(config.mediaTokenTtlSeconds) || 3600);
    const refreshBeforeMs = Math.min(120_000, Math.max(15_000, ttlSeconds * 100));
    if (!lease.mediaToken || Date.now() >= Number(lease.mediaTokenExpiresAt || 0) - refreshBeforeMs) {
      lease.mediaToken = authService.signMediaToken({
        userId: 'motion-detection-service',
        path: lease.path,
        action: 'read',
        expiresIn: ttlSeconds,
      });
      lease.mediaTokenExpiresAt = Date.now() + ttlSeconds * 1000;
    }
    return lease.mediaToken;
  }

  start() {
    if (this.timer || !config.motionDetectionEnabled) return;
    const run = () => this.tick().catch((error) => logger.error({ err: error }, 'Bewegungserkennung fehlgeschlagen'));
    this.timer = setInterval(run, config.motionDetectionIntervalMs);
    this.timer.unref?.();
    setTimeout(run, Math.min(2000, config.motionDetectionIntervalMs)).unref?.();
    logger.info({ intervalMs: config.motionDetectionIntervalMs, source: config.motionDetectionSource }, 'Bildbasierte Bewegungserkennung wurde gestartet');
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const cameraId of [...this.leases.keys()]) this.releaseMotionLease(cameraId, 'service-stopped');
    this.states.clear();
  }

  status() {
    return {
      enabled: config.motionDetectionEnabled,
      running: Boolean(this.timer),
      busy: this.running,
      intervalMs: config.motionDetectionIntervalMs,
      source: config.motionDetectionSource,
      snapshotFallback: config.motionDetectionSnapshotFallback,
      thresholds: {
        pixelThreshold: config.motionDetectionPixelThreshold,
        minChangedRatio: config.motionDetectionMinChangedRatio,
        minAverageDiff: config.motionDetectionMinAverageDiff,
        minChangedPixels: config.motionDetectionMinChangedPixels,
        stabilizationPixels: config.motionDetectionStabilizationPixels,
        brightnessCompensation: config.motionDetectionBrightnessCompensation,
        blurRadius: config.motionDetectionBlurRadius,
        sceneChangeRatio: config.motionDetectionSceneChangeRatio,
        suppressSceneChanges: config.motionDetectionSuppressSceneChanges,
        cooldownSeconds: config.motionDetectionCooldownSeconds,
        rearmSeconds: config.motionDetectionRearmSeconds,
        retriggerSeconds: config.motionDetectionRetriggerSeconds,
        debounceFrames: config.motionDetectionDebounceFrames,
        windowFrames: config.motionDetectionWindowFrames,
        windowMinMotionFrames: config.motionDetectionWindowMinMotionFrames,
        skipDuringPtz: config.motionDetectionSkipDuringPtz,
      },
      lastRunAt: this.lastRunAt,
      lastCompletedAt: this.lastCompletedAt,
      lastError: this.lastError,
      cameras: [...this.states.entries()].map(([cameraId, state]) => ({
        cameraId,
        initialized: Boolean(state.previousFrame),
        watched: Boolean(this.leases.get(cameraId)),
        source: state.source || null,
        sourceUrl: state.sourceUrl || null,
        lastMotionAt: state.lastMotionAt ? new Date(state.lastMotionAt).toISOString() : null,
        lastEventAt: state.lastEventAt ? new Date(state.lastEventAt).toISOString() : null,
        lastDetectedAt: state.lastDetectedAt ? new Date(state.lastDetectedAt).toISOString() : null,
        lastCheckedAt: state.lastCheckedAt ? new Date(state.lastCheckedAt).toISOString() : null,
        motionActive: Boolean(state.motionActive),
        motionArmed: state.motionArmed !== false,
        motionEpisodeId: state.motionEpisodeId || 0,
        eventSequence: state.eventSequence || 0,
        lastEventId: state.lastEventId || null,
        lastSuppressedAt: state.lastSuppressedAt ? new Date(state.lastSuppressedAt).toISOString() : null,
        lastSuppressedReason: state.lastSuppressedReason || null,
        lastChangedRatio: state.lastChangedRatio || 0,
        lastAverageDiff: state.lastAverageDiff || 0,
        lastChangedPixels: state.lastChangedPixels || 0,
        lastPixels: state.lastPixels || 0,
        lastActiveRegions: state.lastActiveRegions || 0,
        lastGlobalBrightnessShift: state.lastGlobalBrightnessShift || 0,
        lastAlignmentX: state.lastAlignmentX || 0,
        lastAlignmentY: state.lastAlignmentY || 0,
        lastSceneChange: Boolean(state.lastSceneChange),
        motionZone: state.motionZone || null,
        motionZoneActive: Boolean(state.motionZone),
        lastSourceChanged: Boolean(state.lastSourceChanged),
        lastPtzSuppressedAt: state.lastPtzSuppressedAt ? new Date(state.lastPtzSuppressedAt).toISOString() : null,
        lastComparisonBasis: state.lastComparisonBasis || null,
        shortTermMotion: Boolean(state.shortTermMotion),
        shortTermChangedRatio: state.shortTermChangedRatio || 0,
        referenceMotion: Boolean(state.referenceMotion),
        referenceChangedRatio: state.referenceChangedRatio || 0,
        motionWindow: state.motionWindowSummary || summarizeMotionWindow(state.motionWindow || [], config.motionDetectionWindowMinMotionFrames),
        consecutiveErrors: state.consecutiveErrors || 0,
        lastReason: state.lastReason || null,
        lastTriggerReason: state.lastTriggerReason || null,
        lastError: state.lastError || null,
      })),
    };
  }

  releaseMotionLease(cameraId, reason = 'not-required') {
    const lease = this.leases.get(cameraId);
    if (!lease) return;
    this.leases.delete(cameraId);
    try { streamOrchestrator.release(lease.key); } catch { /* best effort */ }
    cameraEventLog.append(cameraId, {
      level: 'info', component: 'motion-detection', code: 'MOTION_STREAM_RELEASED',
      message: 'Bewegungserkennung hat die Live-Medien-Sitzung freigegeben', details: { reason, source: lease.source },
    });
  }

  async ensureMotionLease(camera, motionPlan) {
    const quality = config.motionPreferSubstream ? 'low' : (motionPlan.quality || 'balanced');
    const profileToken = motionPlan.profileToken || motionPlan.plan.profileToken || null;
    const current = this.leases.get(camera.id);
    if (current && current.quality === quality && current.profileToken === profileToken) {
      try {
        await streamOrchestrator.retainedSession(current.key, { ensureHls: true });
        return current;
      } catch {
        this.releaseMotionLease(camera.id, 'stale-stream');
      }
    } else if (current) {
      this.releaseMotionLease(camera.id, 'plan-changed');
    }

    const retained = await streamOrchestrator.retain(camera.id, {
      quality,
      profileToken,
      viewportWidth: Math.max(640, config.motionDetectionFrameWidth * 8),
      purpose: 'motion',
    });
    const lease = {
      key: retained.key,
      path: retained.path,
      quality,
      profileToken,
      source: 'preview-substream',
      createdAt: new Date().toISOString(),
    };
    this.leases.set(camera.id, lease);
    cameraEventLog.append(camera.id, {
      level: 'info', component: 'motion-detection', code: 'MOTION_STREAM_READY',
      message: 'Bewegungserkennung nutzt den ressourcenschonenden Preview-/Substream-Pfad; RTSP wird fuer aktuelle Frames bevorzugt',
      details: { quality, profileToken: profileToken ? 'gesetzt' : 'auto', path: retained.path },
    });
    return lease;
  }

  async captureMotionFrame(camera, motionPlan, state) {
    return cameraRuntimeCoordinator.runMotionFrameTask(camera.id, ({ signal }) => this.captureMotionFrameUnsafe(camera, motionPlan, state, signal));
  }

  async captureMotionFrameUnsafe(camera, motionPlan, state, signal = null) {
    const sourceMode = String(config.motionDetectionSource || 'live').trim().toLowerCase();
    const forceSnapshotFallback = sourceMode === 'snapshot-fallback';
    const allowSnapshot = sourceMode === 'snapshot' || forceSnapshotFallback || config.motionDetectionSnapshotFallback;
    const errors = [];

    if (sourceMode !== 'snapshot') {
      try {
        const lease = await this.ensureMotionLease(camera, motionPlan);
        const mediaToken = this.mediaTokenForLease(lease);
        for (const candidate of liveSourceCandidates(sourceMode, lease.path)) {
          try {
            const frame = await captureStreamToGray(candidate.uri, {
              width: config.motionDetectionFrameWidth,
              height: config.motionDetectionFrameHeight,
              timeoutMs: config.motionDetectionFrameTimeoutMs,
              mediaToken,
              signal,
            });
            const displayUri = prepareMediaReadSource(candidate.uri).displayUri;
            state.source = candidate.name;
            state.sourceUrl = displayUri;
            state.captureSourceKey = `${candidate.name}|${displayUri}|${lease.createdAt || ''}`;
            state.lastLiveErrors = errors;
            if (errors.length) {
              const fallbackSignature = `${candidate.name}|${errors.join('|')}`;
              const fallbackChanged = state.lastSourceFallbackSignature !== fallbackSignature;
              if (fallbackChanged || Date.now() - Number(state.lastSourceFallbackAt || 0) >= ERROR_LOG_COOLDOWN_MS) {
                cameraEventLog.append(camera.id, {
                  level: 'warn', component: 'motion-detection', code: 'MOTION_SOURCE_FALLBACK_USED',
                  message: 'Bewegungserkennung hat nach einem Quellfehler automatisch auf die naechste Live-Quelle gewechselt',
                  details: { selectedSource: candidate.name, previousErrors: errors.slice(-3) },
                });
                state.lastSourceFallbackAt = Date.now();
                state.lastSourceFallbackSignature = fallbackSignature;
              }
            } else {
              state.lastSourceFallbackSignature = null;
            }
            return frame;
          } catch (error) {
            if (error?.code === 'MOTION_SUPPRESSED_DURING_PTZ') throw error;
            errors.push(`${candidate.name}: ${sanitizeLogText(error.message || String(error), 500)}`);
          }
        }
      } catch (error) {
        if (error?.code === 'MOTION_SUPPRESSED_DURING_PTZ') throw error;
        errors.push(`shared-live: ${sanitizeLogText(error.message || String(error), 500)}`);
      }
      state.lastLiveErrors = errors;
      if (!allowSnapshot) throw new Error(errors.join(' | ') || 'Live-Bewegungsquelle nicht verfuegbar');
    }

    const profileToken = motionPlan.profileToken || motionPlan.plan.profileToken || null;
    const snapshot = await snapshotService.capture(camera.id, profileToken);
    state.source = 'snapshot';
    state.sourceUrl = null;
    state.captureSourceKey = `snapshot|${camera.id}|${profileToken || 'auto'}`;
    return decodeSnapshotToGray(snapshot.buffer, {
      width: config.motionDetectionFrameWidth,
      height: config.motionDetectionFrameHeight,
      timeoutMs: Math.min(config.motionDetectionFrameTimeoutMs, 12_000),
      signal,
    });
  }

  async tick(date = new Date()) {
    if (this.running || !config.motionDetectionEnabled) return this.status();
    this.running = true;
    this.lastRunAt = date.toISOString();
    this.lastError = null;
    try {
      const cameras = cameraRepository.listEnabled();
      const candidates = cameras
        .map((camera) => ({ camera, motionPlan: hasActiveMotionPlan(recordingPolicyRepository.listPlans(camera.id), date) }))
        .filter((entry) => entry.motionPlan);
      const activeIds = new Set(candidates.map((entry) => entry.camera.id));
      for (const cameraId of [...this.states.keys()]) {
        if (!activeIds.has(cameraId)) this.states.delete(cameraId);
      }
      for (const cameraId of [...this.leases.keys()]) {
        if (!activeIds.has(cameraId)) this.releaseMotionLease(cameraId, 'no-active-motion-plan');
      }
      await mapLimit(candidates, config.motionDetectionConcurrency, (entry) => this.evaluateCamera(entry.camera, entry.motionPlan));
      this.lastCompletedAt = new Date().toISOString();
      return this.status();
    } catch (error) {
      this.lastError = 'Bewegungserkennung konnte nicht ausgewertet werden.';
      throw error;
    } finally {
      this.running = false;
    }
  }

  resetBaseline(state, frame, sourceKey, reason, now) {
    state.previousFrame = frame;
    state.referenceFrame = frame;
    state.lastFrameSourceKey = sourceKey;
    state.referenceSourceKey = sourceKey;
    state.lastSourceChanged = reason === 'source-changed';
    state.lastCheckedAt = now;
    state.lastReason = reason;
    state.motionActive = false;
    state.motionArmed = true;
    state.motionWindow = [];
    state.motionWindowSummary = summarizeMotionWindow([], config.motionDetectionWindowMinMotionFrames);
    state.lastQuietStartedAt = 0;
    state.lastError = null;
    state.consecutiveErrors = 0;
  }

  applyMetrics(state, comparison, previousComparison, referenceComparison, windowSummary, now) {
    state.lastCheckedAt = now;
    state.lastChangedRatio = comparison.changedRatio || 0;
    state.lastAverageDiff = comparison.averageDiff || 0;
    state.lastChangedPixels = comparison.changedPixels || 0;
    state.lastPixels = comparison.pixels || 0;
    state.lastActiveRegions = comparison.activeRegions || 0;
    state.lastGlobalBrightnessShift = comparison.globalBrightnessShift || 0;
    state.lastAlignmentX = comparison.alignmentX || 0;
    state.lastAlignmentY = comparison.alignmentY || 0;
    state.lastSceneChange = Boolean(comparison.sceneChange);
    state.lastReason = comparison.reason;
    state.lastComparisonBasis = comparison.comparisonBasis || comparison.basis || null;
    state.shortTermMotion = Boolean(previousComparison.motion);
    state.shortTermChangedRatio = previousComparison.changedRatio || 0;
    state.shortTermAverageDiff = previousComparison.averageDiff || 0;
    state.referenceMotion = Boolean(referenceComparison.motion);
    state.referenceChangedRatio = referenceComparison.changedRatio || 0;
    state.referenceAverageDiff = referenceComparison.averageDiff || 0;
    state.motionWindowSummary = windowSummary;
    state.lastError = null;
    state.consecutiveErrors = 0;
  }

  updateRearmState(cameraId, state, frame, sourceKey, now, shortTermMotion, confirmedMotion) {
    const rearmMs = Math.max(0, cleanSeconds(config.motionDetectionRearmSeconds, 3) * 1000);
    if (confirmedMotion || shortTermMotion) {
      state.lastQuietStartedAt = 0;
      return;
    }

    if (state.motionActive) {
      if (!state.lastQuietStartedAt) state.lastQuietStartedAt = now;
      if (now - state.lastQuietStartedAt >= rearmMs) {
        state.motionActive = false;
        state.motionArmed = true;
        state.lastRearmedAt = now;
        state.referenceFrame = frame;
        state.referenceSourceKey = sourceKey;
        state.motionWindow = [];
        state.motionWindowSummary = summarizeMotionWindow([], config.motionDetectionWindowMinMotionFrames);
        const shouldLog = now - Number(state.lastRearmLoggedAt || 0) >= REARM_LOG_COOLDOWN_MS;
        if (shouldLog) {
          state.lastRearmLoggedAt = now;
          cameraEventLog.append(cameraId, {
            level: 'info', component: 'motion-detection', code: 'MOTION_REARMED',
            message: 'Bewegungserkennung wurde nach ruhigem Bild erneut scharf geschaltet',
            details: { rearmSeconds: config.motionDetectionRearmSeconds, episodeId: state.motionEpisodeId || 0 },
          });
        }
      }
      return;
    }

    state.motionArmed = true;
    state.referenceFrame = frame;
    state.referenceSourceKey = sourceKey;
  }

  shouldEmitEvent(state, confirmedMotion, now) {
    if (!confirmedMotion) return { emit: false, triggerReason: null };
    const minGapMs = Math.max(0, cleanSeconds(config.motionDetectionCooldownSeconds, 3) * 1000);
    const retriggerMs = Math.max(minGapMs, cleanSeconds(config.motionDetectionRetriggerSeconds, 12) * 1000);
    const elapsedSinceEvent = now - Number(state.lastEventAt || 0);

    if (!state.motionActive) {
      state.motionActive = true;
      state.motionArmed = false;
      state.motionEpisodeId = Number(state.motionEpisodeId || 0) + 1;
      return elapsedSinceEvent >= minGapMs
        ? { emit: true, triggerReason: 'new-episode' }
        : { emit: false, triggerReason: 'min-gap-hold' };
    }

    if (elapsedSinceEvent >= retriggerMs) return { emit: true, triggerReason: 'continuous-retrigger' };
    return { emit: false, triggerReason: 'active-hold' };
  }

  emitMotionEvent(camera, motionPlan, state, comparison, previousComparison, referenceComparison, windowSummary, triggerReason, now) {
    state.eventSequence = Number(state.eventSequence || 0) + 1;
    const event = recordingEventDispatcher.publish(camera.id, {
      type: 'motion',
      source: 'motion-detector',
      state: 'pulse',
      durationSeconds: motionPlan.eventSeconds,
      severity: comparison.sceneChange || comparison.changedRatio > 0.15 ? 'warn' : 'info',
      metadata: {
        algorithm: 'go2rtc-live-frame-difference-v5-ptz-isolated-window',
        source: state.source || 'unknown',
        comparisonBasis: comparison.comparisonBasis || comparison.basis || null,
        triggerReason,
        episodeId: state.motionEpisodeId || 0,
        eventSequence: state.eventSequence,
        changedRatio: Number((comparison.changedRatio || 0).toFixed(4)),
        averageDiff: Number((comparison.averageDiff || 0).toFixed(2)),
        changedPixels: comparison.changedPixels,
        pixels: comparison.pixels,
        activeRegions: comparison.activeRegions,
        motionZone: comparison.motionZone || null,
        motionZoneActive: Boolean(comparison.motionZoneActive),
        shortTermMotion: Boolean(previousComparison.motion),
        shortTermChangedRatio: Number((previousComparison.changedRatio || 0).toFixed(4)),
        referenceMotion: Boolean(referenceComparison.motion),
        referenceChangedRatio: Number((referenceComparison.changedRatio || 0).toFixed(4)),
        windowMotionFrames: windowSummary.motionFrames,
        windowFrames: windowSummary.frames,
        globalBrightnessShift: Number((comparison.globalBrightnessShift || 0).toFixed(2)),
        alignmentX: comparison.alignmentX,
        alignmentY: comparison.alignmentY,
        sceneChange: comparison.sceneChange,
        threshold: comparison.threshold,
        minChangedRatio: config.motionDetectionMinChangedRatio,
        minAverageDiff: config.motionDetectionMinAverageDiff,
        minChangedPixels: config.motionDetectionMinChangedPixels,
        rearmSeconds: config.motionDetectionRearmSeconds,
        retriggerSeconds: config.motionDetectionRetriggerSeconds,
        planId: motionPlan.plan.id || null,
      },
    }, { reason: triggerReason, log: false });
    state.lastMotionAt = now;
    state.lastDetectedAt = now;
    state.lastTriggerReason = triggerReason;
    if (event.suppressed) {
      state.lastSuppressedAt = now;
      state.lastSuppressedReason = event.code || 'RECORDING_EVENT_SUPPRESSED_PTZ';
      state.lastEventId = null;
      cameraEventLog.append(camera.id, {
        level: 'info', component: 'motion-detection', code: 'MOTION_EVENT_SUPPRESSED_PTZ',
        message: 'Bewegung wurde erkannt, aber waehrend der PTZ-Bedienung nicht als Aufnahmeereignis verarbeitet',
        details: {
          triggerReason,
          episodeId: state.motionEpisodeId || 0,
          eventSequence: state.eventSequence,
          settleUntil: event.settleUntil || null,
        },
      });
      return event;
    }
    state.lastEventAt = now;
    state.lastEventId = event.id;
    state.lastSuppressedReason = null;
    cameraEventLog.append(camera.id, {
      level: 'info', component: 'motion-detection', code: triggerReason === 'continuous-retrigger' ? 'MOTION_RETRIGGERED' : 'MOTION_DETECTED',
      message: triggerReason === 'continuous-retrigger'
        ? 'Andauernde oder erneute Bildveraenderung hat ein weiteres Bewegungsereignis ausgeloest'
        : 'Bildveraenderung erkannt; Ereignisaufnahme wurde ausgeloest',
      details: {
        eventId: event.id,
        triggerReason,
        episodeId: state.motionEpisodeId || 0,
        eventSequence: state.eventSequence,
        source: state.source,
        comparisonBasis: comparison.comparisonBasis || comparison.basis || null,
        changedRatio: comparison.changedRatio,
        averageDiff: comparison.averageDiff,
        changedPixels: comparison.changedPixels,
        activeRegions: comparison.activeRegions,
        motionZone: comparison.motionZone || null,
        motionZoneActive: Boolean(comparison.motionZoneActive),
        window: windowSummary,
        durationSeconds: motionPlan.eventSeconds,
      },
    });
    logger.info({ cameraId: camera.id, eventId: event.id, triggerReason, source: state.source, changedRatio: comparison.changedRatio, averageDiff: comparison.averageDiff }, 'Bewegung erkannt');
  }

  async evaluateCamera(camera, motionPlan) {
    const state = this.states.get(camera.id) || createState();
    const now = Date.now();
    try {
      const previousSourceKey = state.lastFrameSourceKey || null;
      const frame = await this.captureMotionFrame(camera, motionPlan, state);
      const currentSourceKey = state.captureSourceKey || state.source || 'unknown';
      const sourceChanged = Boolean(previousSourceKey && currentSourceKey && previousSourceKey !== currentSourceKey);
      const zone = normalizeMotionZone(camera.motionZone);
      const currentMotionZoneKey = motionZoneKey(zone);
      const motionZoneChanged = Boolean(state.previousFrame && state.motionZoneKey && state.motionZoneKey !== currentMotionZoneKey);
      const options = comparisonOptions(camera);

      if (!state.previousFrame || sourceChanged || motionZoneChanged) {
        const resetReason = sourceChanged ? 'source-changed' : motionZoneChanged ? 'motion-zone-changed' : 'initializing';
        this.resetBaseline(state, frame, currentSourceKey, resetReason, now);
        state.motionZoneKey = currentMotionZoneKey;
        state.motionZone = zone;
        this.states.set(camera.id, state);
        return;
      }
      state.motionZoneKey = currentMotionZoneKey;
      state.motionZone = zone;

      const previousBaseline = selectMotionBaseline(state.previousFrame, previousSourceKey, currentSourceKey);
      const previousComparison = compareMotionFrames(previousBaseline.frame, frame, options);
      if (previousBaseline.sourceChanged && previousComparison.reason === 'initializing') previousComparison.reason = 'source-changed';

      const referenceBaseline = selectMotionBaseline(state.referenceFrame, state.referenceSourceKey || previousSourceKey, currentSourceKey);
      const referenceComparison = compareMotionFrames(referenceBaseline.frame, frame, options);
      if (referenceBaseline.sourceChanged && referenceComparison.reason === 'initializing') referenceComparison.reason = 'source-changed';

      const comparison = chooseMotionComparison(previousComparison, referenceComparison, { motionActive: state.motionActive });
      const observedMotion = Boolean(comparison.motion || previousComparison.motion);
      state.motionWindow = pushMotionWindow(state.motionWindow, observedMotion, config.motionDetectionWindowFrames);
      const windowSummary = summarizeMotionWindow(state.motionWindow, config.motionDetectionWindowMinMotionFrames);
      const debounceFrames = Math.max(1, Number(config.motionDetectionDebounceFrames) || 1);
      const recentWindow = (state.motionWindow || []).slice(-debounceFrames);
      const debounced = recentWindow.length >= debounceFrames && recentWindow.every(Boolean);
      const confirmedMotion = observedMotion && windowSummary.active && debounced;

      state.previousFrame = frame;
      state.lastFrameSourceKey = currentSourceKey;
      state.lastSourceChanged = Boolean(previousBaseline.sourceChanged || referenceBaseline.sourceChanged);
      this.applyMetrics(state, comparison, previousComparison, referenceComparison, windowSummary, now);

      const eventDecision = this.shouldEmitEvent(state, confirmedMotion, now);
      state.lastTriggerReason = eventDecision.triggerReason || state.lastTriggerReason || null;
      if (observedMotion) state.lastDetectedAt = now;
      if (confirmedMotion && !eventDecision.emit) {
        state.motionActive = true;
        state.motionArmed = false;
      }

      if (eventDecision.emit) {
        this.emitMotionEvent(camera, motionPlan, state, comparison, previousComparison, referenceComparison, windowSummary, eventDecision.triggerReason, now);
      }

      this.updateRearmState(camera.id, state, frame, currentSourceKey, now, Boolean(previousComparison.motion), confirmedMotion);
      this.states.set(camera.id, state);
    } catch (error) {
      if (error?.code === 'MOTION_SUPPRESSED_DURING_PTZ' || error instanceof PtzActiveError) {
        state.lastCheckedAt = now;
        state.lastPtzSuppressedAt = now;
        state.lastReason = 'ptz-suppressed';
        state.lastError = null;
        state.consecutiveErrors = 0;
        state.previousFrame = null;
        state.referenceFrame = null;
        state.lastFrameSourceKey = null;
        state.referenceSourceKey = null;
        state.motionActive = false;
        state.motionArmed = true;
        state.motionWindow = [];
        state.motionWindowSummary = summarizeMotionWindow([], config.motionDetectionWindowMinMotionFrames);
        this.states.set(camera.id, state);
        return;
      }
      const message = sanitizeLogText(error.message || String(error), 500);
      state.lastCheckedAt = now;
      state.lastError = message;
      state.consecutiveErrors = (state.consecutiveErrors || 0) + 1;
      if (state.consecutiveErrors >= 3) {
        state.previousFrame = null;
        state.referenceFrame = null;
        state.lastFrameSourceKey = null;
        state.referenceSourceKey = null;
        state.motionActive = false;
        state.motionArmed = true;
        state.motionWindow = [];
      }
      this.states.set(camera.id, state);

      const shouldLog = state.lastLoggedError !== message || now - (state.lastErrorLoggedAt || 0) >= ERROR_LOG_COOLDOWN_MS;
      if (shouldLog) {
        state.lastLoggedError = message;
        state.lastErrorLoggedAt = now;
        cameraEventLog.append(camera.id, {
          level: 'warn', component: 'motion-detection', code: 'MOTION_DETECTION_FAILED',
          message: 'Bewegungserkennung konnte kein Vergleichsbild erzeugen',
          details: { error: message, source: state.source || config.motionDetectionSource, consecutiveErrors: state.consecutiveErrors },
        });
      }
    }
  }
}

export const motionDetectionService = new MotionDetectionService();
