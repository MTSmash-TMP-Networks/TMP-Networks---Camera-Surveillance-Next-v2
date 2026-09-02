import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { cameraRepository } from './cameraRepository.js';
import { cameraEventLog, sanitizeLogText } from './CameraEventLog.js';
import { recordingRepository } from './recordingRepository.js';
import { streamOrchestrator } from './media/StreamOrchestrator.js';
import { AppError } from '../utils/errors.js';
import { safePathPart } from '../utils/url.js';
import { logger } from '../utils/logger.js';
import { authService } from './authService.js';
import { adminAlertService } from './AdminAlertService.js';
import { recordingPolicyRepository } from './recording/RecordingPolicyRepository.js';
import { cameraRuntimeCoordinator } from './runtime/CameraRuntimeCoordinator.js';
import { ptzAutomationInterlock } from './runtime/PtzAutomationInterlock.js';
import { recordingCompressionService } from './recording/RecordingCompressionService.js';
import { networkRecordingStorageService } from './NetworkRecordingStorageService.js';
import { isRecordingStoragePath } from './recording/RecordingStoragePaths.js';
import { buildRecordingArgs, buildRecordingRemuxArgs, nextRecordingSegmentNumber, reconnectDelay, waitForRecordingStartup } from './recording/RecordingCommand.js';
import { isRecoverableInitialRecordingFailure, ptzDeferredRetryDelay, recordingRecoveryDecision } from './recording/RecordingRecoveryPolicy.js';
import {
  assessProbe,
  blockIndexFromName,
  blockPaths,
  buildVodPlaylist,
  finalizeBlock,
  isPlayableBlock,
  probeMedia,
  scanSessionBlocks,
  summarizeBlocks,
  writeJournal,
} from './recording/BlockArchive.js';

export { buildRecordingArgs, buildRecordingRemuxArgs, nextRecordingSegmentNumber, reconnectDelay, waitForRecordingStartup } from './recording/RecordingCommand.js';

const ARCHIVE_FORMAT = 'block_archive_v1';

function timestampName(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function recordingSourceDescriptor(mediaPath, protocol = 'hls') {
  const normalized = String(protocol || 'hls').trim().toLowerCase();
  if (normalized === 'hls' || normalized === 'll-hls' || normalized === 'http') {
    return {
      uri: `${config.go2RtcHlsInternal.replace(/\/$/, '')}/api/stream.m3u8?src=${encodeURIComponent(mediaPath)}`,
      protocol: 'hls',
      label: 'go2rtc-HLS',
      needsMediaToken: true,
    };
  }
  return {
    uri: `${config.go2RtcPublishBase.replace(/\/$/, '')}/${mediaPath}`,
    protocol: 'rtsp',
    label: 'go2rtc-RTSP',
    needsMediaToken: true,
  };
}

function recordingSourceCandidates(mediaPath) {
  const raw = String(config.recordingSourceProtocol || 'auto').trim().toLowerCase();
  const rtsp = recordingSourceDescriptor(mediaPath, 'rtsp');
  const hls = recordingSourceDescriptor(mediaPath, 'hls');

  if (raw === 'hls-only' || raw === 'http-only' || raw === 'll-hls-only') return [hls];
  if (raw === 'rtsp-only' || raw === 'rtsps-only') return [rtsp];

  if (raw === 'hls' || raw === 'http' || raw === 'll-hls') return [hls, rtsp];
  // Existing installations may already contain RECORDING_SOURCE_PROTOCOL=rtsp
  // from 2.12.5. Keep RTSP as preferred path, but never let a local
  // go2rtc RTSP reader failure make recording impossible when HLS works.
  return [rtsp, hls];
}

function waitForClose(child, timeoutMs = 8000) {
  if (!child || child.exitCode !== null) return Promise.resolve({ code: child?.exitCode ?? 0, signal: child?.signalCode || null });
  return Promise.race([
    new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal }))),
    new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

async function stopFfmpegGracefully(child, gracefulTimeoutMs = 20_000) {
  if (!child || child.exitCode !== null) return { code: child?.exitCode ?? 0, signal: child?.signalCode || null, method: 'already-stopped' };
  let method = 'stdin-q';
  try {
    if (child.stdin && !child.stdin.destroyed && child.stdin.writable) {
      child.stdin.write('q\n');
      child.stdin.end();
    } else {
      method = 'sigint';
      child.kill('SIGINT');
    }
  } catch {
    method = 'sigint';
    try { child.kill('SIGINT'); } catch { /* process may have ended */ }
  }

  let result = await waitForClose(child, gracefulTimeoutMs);
  if (result) return { ...result, method };

  method = 'sigint-timeout';
  try { child.kill('SIGINT'); } catch { /* process may have ended */ }
  result = await waitForClose(child, 5000);
  if (result) return { ...result, method };

  method = 'sigkill';
  try { child.kill('SIGKILL'); } catch { /* process may have ended */ }
  result = await waitForClose(child, 2500);
  return { ...(result || { code: child.exitCode, signal: child.signalCode || 'SIGKILL' }), method };
}

async function waitForSessionFilesStable(sessionDir, { timeoutMs = 4000, stableMs = 600 } = {}) {
  const started = Date.now();
  let lastSignature = '';
  let stableSince = Date.now();
  while (Date.now() - started < timeoutMs) {
    const signature = scanSessionBlocks(sessionDir)
      .map((file) => `${file.filename}:${file.sizeBytes}`)
      .join('|');
    if (signature === lastSignature && signature) {
      if (Date.now() - stableSince >= stableMs) return;
    } else {
      lastSignature = signature;
      stableSince = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

function safeFileSize(file) {
  try { return fs.statSync(file).size; } catch { return 0; }
}

function parseMetadata(value) {
  try { return value ? JSON.parse(value) : {}; } catch { return {}; }
}

function spawnAndWait(command, args, timeoutMs = config.recordingFinalizeTimeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
      finish(new Error('Zeitlimit beim Abschließen der Aufnahme überschritten'));
    }, timeoutMs);
    timer.unref?.();
    function finish(error = null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    }
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-12000); });
    child.once('error', finish);
    child.once('exit', (code, signal) => {
      if (code === 0) finish();
      else finish(new Error(sanitizeLogText(stderr || `FFmpeg beendet (${code ?? signal})`, 2000)));
    });
  });
}

async function concatenateFiles(files, target) {
  await fs.promises.rm(target, { force: true });
  const output = fs.createWriteStream(target, { flags: 'w' });
  const outputError = once(output, 'error').then(([error]) => { throw error; });
  for (const file of files) {
    const input = fs.createReadStream(file);
    const finished = new Promise((resolve, reject) => {
      input.once('error', reject);
      input.once('end', resolve);
    });
    input.pipe(output, { end: false });
    await Promise.race([finished, outputError]);
  }
  output.end();
  await Promise.race([once(output, 'finish'), outputError]);
}

function isRecordingPath(filePath) {
  return isRecordingStoragePath(filePath);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function recoverableLegacyParts(row) {
  if (!isRecordingPath(row?.file_path)) return [];
  const directory = path.dirname(path.resolve(row.file_path));
  if (!fs.existsSync(directory)) return [];
  const base = path.parse(row.file_path).name;
  const pattern = new RegExp(`^${escapeRegExp(base)}\\.part-(\\d+)\\.ts$`);
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => {
      const match = entry.name.match(pattern);
      const filePath = path.join(directory, entry.name);
      const stat = fs.statSync(filePath);
      return { segmentIndex: Number(match[1]), filePath, sizeBytes: stat.size, mtime: stat.mtime };
    })
    .filter((entry) => entry.sizeBytes > 0 && isRecordingPath(entry.filePath))
    .sort((left, right) => left.segmentIndex - right.segmentIndex);
}

function clearBlockTimers(state) {
  if (state.rotationTimer) clearTimeout(state.rotationTimer);
  if (state.rotationKillTimer) clearTimeout(state.rotationKillTimer);
  if (state.watchdogTimer) clearInterval(state.watchdogTimer);
  state.rotationTimer = null;
  state.rotationKillTimer = null;
  state.watchdogTimer = null;
}

function freeBytes(directory) {
  try {
    const stats = fs.statfsSync(directory);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch { return Number.POSITIVE_INFINITY; }
}

function dateDirectory(cameraId, date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return path.join(config.recordingsDir, safePathPart(cameraId), year, month, day);
}

class RecordingService {
  constructor() {
    this.active = new Map();
    this.recoveryPromise = null;
  }

  log(cameraId, level, code, message, details = null) {
    cameraEventLog.append(cameraId, { level, component: 'recording', code, message, details });
    const payload = { cameraId, code, ...(details || {}) };
    if (level === 'error') logger.error(payload, message);
    else if (level === 'warn') logger.warn(payload, message);
    else logger.info(payload, message);
  }

  ensureStorage() {
    fs.mkdirSync(config.recordingsDir, { recursive: true });
    fs.accessSync(config.recordingsDir, fs.constants.R_OK | fs.constants.W_OK);
    const available = freeBytes(config.recordingsDir);
    if (Number.isFinite(available) && available < config.recordingMinFreeBytes) {
      throw new AppError(507, 'RECORDING_STORAGE_LOW', 'Nicht genügend freier Speicherplatz für eine sichere Aufnahme');
    }
  }

  journal(state, status, extra = {}) {
    try {
      const segments = recordingRepository.segmentsInternal(state.id);
      writeJournal(state.sessionDir, {
        schema: 1,
        product: 'tmp-camera-surveillance-next',
        recordingId: state.id,
        cameraId: state.cameraId,
        status,
        startedAt: state.startedAt,
        updatedAt: new Date().toISOString(),
        blockSeconds: state.blockSeconds || config.recordingBlockSeconds,
        interruptions: state.interruptions,
        gapSeconds: Number(state.gapSeconds.toFixed(3)),
        blocks: segments.map((segment) => ({
          index: segment.segment_index,
          file: path.basename(segment.file_path),
          status: segment.status,
          sizeBytes: Number(segment.size_bytes || 0),
          durationSeconds: Number(segment.duration_seconds || 0),
          gapSeconds: Number(segment.gap_seconds || 0),
        })),
        ...extra,
      });
    } catch (error) {
      logger.warn({ cameraId: state.cameraId, recordingId: state.id, err: error }, 'Aufnahmejournal konnte nicht aktualisiert werden');
    }
  }

  async start(cameraId, options = {}) {
    return cameraRuntimeCoordinator.runRecordingTask(cameraId, 'start-recording', () => this.startImmediate(cameraId, options));
  }

  async startImmediate(cameraId, options = {}) {
    const {
      profileToken = null,
      quality = 'balanced',
      triggerType = 'manual',
      planId = null,
      planIds = [],
      eventId = null,
      retentionClass = triggerType === 'event' ? 'event' : 'standard',
      protectedUntil = null,
      requestedBy = triggerType === 'manual' ? 'user' : 'scheduler',
      prebufferSeconds = 0,
      automatic = triggerType !== 'manual',
      automationPermit: providedAutomationPermit = null,
    } = options;
    const camera = cameraRepository.get(cameraId);
    if (!camera || !camera.enabled) throw new AppError(404, 'CAMERA_NOT_FOUND', 'Kamera nicht gefunden oder deaktiviert');
    if (this.active.has(cameraId)) throw new AppError(409, 'RECORDING_ALREADY_ACTIVE', 'Für diese Kamera läuft bereits eine Aufnahme');

    let automationPermit = null;
    if (automatic) {
      automationPermit = providedAutomationPermit || ptzAutomationInterlock.acquireAutomaticPermit(cameraId, {
        triggerType, planId, eventId, requestedBy,
      });
      automationPermit.assert('recording-start-enter');
    }

    const cameraRecordingPolicy = recordingPolicyRepository.getRetention(cameraId);
    const blockSeconds = Math.max(30, Math.min(3600, Number(cameraRecordingPolicy.blockSeconds || config.recordingBlockSeconds)));
    let retained = null;
    let row = null;
    let state = null;
    try {
      automationPermit?.assert('before-storage-check');
      this.ensureStorage();
      automationPermit?.assert('before-stream-retain');
      retained = await streamOrchestrator.retain(cameraId, { quality, viewportWidth: 1280, profileToken, purpose: 'recording' });
      const actualQuality = retained.quality || quality;
      automationPermit?.assert('after-stream-retain');
      const startedAt = new Date();
      const base = `${safePathPart(camera.name || 'Kamera')}_${timestampName(startedAt)}`;
      const sessionKey = `${timestampName(startedAt)}_${crypto.randomUUID().slice(0, 8)}`;
      const sessionDir = path.join(dateDirectory(cameraId, startedAt), sessionKey);
      fs.mkdirSync(sessionDir, { recursive: true, mode: 0o750 });
      const metadata = {
        requestedBy,
        planIds: [...new Set([planId, ...planIds].filter(Boolean))],
        quality: actualQuality,
        requestedQuality: quality,
        requestedProfileToken: profileToken,
        prebufferSeconds: Math.min(config.recordingPrebufferMaxSeconds, Math.max(0, Number(prebufferSeconds || 0))),
        blockSeconds,
        segmentSeconds: blockSeconds,
        seamlessRecording: true,
        storageFormat: ARCHIVE_FORMAT,
        sessionKey,
      };
      row = recordingRepository.create({
        cameraId,
        filename: `${base}.m3u8`,
        filePath: sessionDir,
        profileToken: retained.profile?.token || profileToken,
        triggerType,
        planId,
        eventId,
        metadata,
        protectedUntil,
        retentionClass,
        segmentSeconds: blockSeconds,
      });
      state = {
        id: row.id,
        cameraId,
        retainedKey: retained.key,
        profileToken: profileToken || null,
        quality: actualQuality,
        viewportWidth: 1280,
        triggerType,
        automatic: Boolean(automatic),
        hasProducedMedia: false,
        planId,
        planIds: metadata.planIds,
        eventId,
        requestedBy,
        prebufferSeconds: metadata.prebufferSeconds,
        sessionDir,
        sessionKey,
        base,
        filename: `${base}.m3u8`,
        startedAt: row.startedAt,
        startedAtMs: Date.now(),
        blockSeconds,
        stopping: false,
        finalizing: null,
        child: null,
        stderr: '',
        blockCounter: 0,
        currentBlockIndex: null,
        committedBlocks: new Set(),
        finalizingBlocks: new Set(),
        commitQueue: Promise.resolve(),
        pendingGapSeconds: 0,
        pendingDiscontinuityIndex: null,
        nextDiscontinuity: false,
        resumeSegmentStartNumber: null,
        blockFinalizing: null,
        restartTimer: null,
        rotationTimer: null,
        rotationKillTimer: null,
        watchdogTimer: null,
        interruptions: 0,
        gapSeconds: 0,
        outageStartedAt: null,
        reconnectAttempts: 0,
        lastStableAt: Date.now(),
        lastProgressAt: Date.now(),
        lastFileSize: 0,
        recovering: false,
        reconnectInFlight: false,
        terminalReason: null,
        automationPermit,
      };
      this.active.set(cameraId, state);
      this.journal(state, 'recording');
    } catch (error) {
      automationPermit?.release();
      if (retained?.key) streamOrchestrator.release(retained.key);
      if (row?.id) recordingRepository.fail(row.id, new Date().toISOString(), { prepareError: sanitizeLogText(error.message, 500) });
      logger.error({ cameraId, code: error?.code || 'RECORDING_PREPARE_FAILED', err: error }, 'Aufnahme konnte nicht vorbereitet werden');
      if (error instanceof AppError) throw error;
      throw new AppError(500, 'RECORDING_PREPARE_FAILED', 'Aufnahme konnte nicht vorbereitet werden. Details stehen im Backend-Protokoll.');
    }

    try {
      await this.startBlock(state, retained);
    } catch (error) {
      automationPermit?.release();
      if (state.automationPermit === automationPermit) state.automationPermit = null;

      if (isRecoverableInitialRecordingFailure(error) && this.active.has(cameraId) && !state.stopping && !state.finalizing) {
        const recovery = await this.scheduleResume(state, error, { initialStart: true });
        if (recovery?.scheduled) {
          this.log(cameraId, 'warn', 'RECORDING_START_RECOVERY_PENDING', 'Aufnahme konnte noch keine Mediendaten schreiben und bleibt bis zur automatischen Wiederverbindung aktiv', {
            recordingId: state.id,
            triggerType: state.triggerType,
            reconnectAttempt: state.reconnectAttempts,
            retryDelayMs: recovery.delay,
            error: sanitizeLogText(state.stderr || error?.message || 'Aufnahmequelle nicht bereit', 1000),
          });
          return this.activeForCamera(cameraId) || { ...recordingRepository.get(state.id), status: 'recording', recovering: true };
        }
      }

      state.stopping = true;
      clearBlockTimers(state);
      if (state.restartTimer) clearTimeout(state.restartTimer);
      if (state.child?.exitCode === null && !state.child.killed) {
        state.child.__tmpExpectedExit = 'abort';
        state.child.kill('SIGKILL');
      }
      if (this.active.has(cameraId)) {
        this.active.delete(cameraId);
        streamOrchestrator.release(state.retainedKey);
        recordingRepository.fail(state.id, new Date().toISOString(), { startError: sanitizeLogText(error.message, 500) });
        this.journal(state, 'failed', { errorCode: error?.code || 'RECORDING_START_FAILED' });
      }
      if (error?.code === 'AUTOMATIC_RECORDING_SUPPRESSED_PTZ') throw error;
      throw new AppError(502, 'RECORDING_START_FAILED', 'Aufnahme konnte nicht gestartet werden', sanitizeLogText(error.message, 500));
    }

    automationPermit?.release();
    state.automationPermit = null;

    this.log(cameraId, 'info', 'RECORDING_STARTED', triggerType === 'manual'
      ? 'Manuelle Blockaufnahme wurde ueber den gemeinsamen Live-Medienpfad gestartet'
      : 'Geplante Blockaufnahme wurde ueber den gemeinsamen Live-Medienpfad gestartet', {
      recordingId: row.id,
      triggerType,
      planId,
      eventId,
      profile: retained.profile?.name || null,
      audio: Boolean(retained.media?.audio),
      blockSeconds: state.blockSeconds,
      archiveFormat: ARCHIVE_FORMAT,
      recordingSourceProtocol: state.recordingSourceProtocol || null,
    });
    return { ...recordingRepository.get(row.id), status: 'recording' };
  }

  async resolveRecordingSession(state) {
    const retained = await streamOrchestrator.retainedSession(state.retainedKey, { ensureHls: true });
    if (retained?.paths?.hls) return retained;
    return streamOrchestrator.ensure(state.cameraId, {
      quality: state.quality,
      viewportWidth: state.viewportWidth,
      profileToken: state.profileToken,
      purpose: 'live',
    }, { wait: true });
  }

  queueFinalizedBlockForStorage(recordingId, segmentIndex, filePath) {
    const segment = recordingRepository.segmentInternal(recordingId, segmentIndex);
    const resolved = path.resolve(filePath || segment?.file_path || '');
    if (!segment || !['ready', 'recovered'].includes(segment.status) || !resolved || !fs.existsSync(resolved)) return false;
    if (!['remote'].includes(String(segment.storage_state || 'local'))) {
      recordingCompressionService.enqueue({ recordingId, segmentIndex, filePath: resolved });
    }
    if (!segment.storage_profile_id) networkRecordingStorageService.assignSegment(recordingId, segmentIndex, resolved);
    return true;
  }

  async commitCurrentBlock(state, block, { expected = null, error = null } = {}) {
    const endedAt = new Date().toISOString();
    const wallDurationSeconds = Math.max(0, (Date.parse(endedAt) - Date.parse(block.startedAt || endedAt)) / 1000);
    const fallbackDurationSeconds = Math.min(Math.max(1, state.blockSeconds + 10), wallDurationSeconds);
    const result = await finalizeBlock({
      tempPath: block.tempPath,
      finalPath: block.finalPath,
      damagedPath: block.damagedPath,
      ffprobePath: config.ffprobePath,
      probeTimeoutMs: config.recordingBlockProbeTimeoutMs,
      minimumBytes: config.recordingBlockMinimumBytes,
      fallbackDurationSeconds,
    });
    const status = result.playable ? (block.recovered ? 'recovered' : 'ready') : result.status;
    recordingRepository.upsertSegment(state.id, {
      segmentIndex: block.segmentIndex,
      filePath: result.filePath || block.tempPath,
      startedAt: block.startedAt,
      endedAt,
      finalizedAt: endedAt,
      sizeBytes: result.sizeBytes,
      durationSeconds: result.durationSeconds,
      mediaFormat: result.mediaFormat,
      status,
      error: result.error ? sanitizeLogText(result.error, 1000) : (!expected && error ? sanitizeLogText(error.message || state.stderr, 1000) : null),
      gapSeconds: block.gapSeconds || 0,
      discontinuity: Boolean(block.discontinuity || (block.segmentIndex > 1 && !expected && error)),
    });
    this.journal(state, state.stopping ? 'stopping' : 'recording');
    if (!result.playable) {
      this.log(state.cameraId, 'warn', 'RECORDING_BLOCK_DAMAGED', 'Ein Aufnahmeblock war nicht abspielbar; bereits abgeschlossene Blöcke bleiben erhalten', {
        recordingId: state.id,
        block: block.segmentIndex,
        sizeBytes: result.sizeBytes,
        reason: sanitizeLogText(result.error || 'unbekannt', 500),
      });
    } else {
      this.log(state.cameraId, 'info', 'RECORDING_BLOCK_COMMITTED', 'Aufnahmeblock wurde atomar abgeschlossen', {
        recordingId: state.id,
        block: block.segmentIndex,
        sizeBytes: result.sizeBytes,
        durationSeconds: Number(result.durationSeconds.toFixed(3)),
      });
      // Compression and remote transfer are queued from one idempotent helper.
      // Recovery after an update uses the same path so finalized blocks cannot
      // become invisible local-only files.
      this.queueFinalizedBlockForStorage(state.id, block.segmentIndex, result.filePath);
    }
    return result;
  }

  blockDescriptor(state, file, { gapSeconds = 0, discontinuity = false } = {}) {
    const paths = blockPaths(state.sessionDir, file.index);
    const stat = (() => { try { return fs.statSync(file.filePath); } catch { return null; } })();
    const startedAt = stat ? new Date(stat.birthtimeMs || stat.ctimeMs || Date.now()).toISOString() : new Date().toISOString();
    return {
      segmentIndex: file.index,
      ...paths,
      tempPath: file.filePath,
      startedAt,
      gapSeconds,
      discontinuity,
    };
  }

  async commitClosedBlocks(state, { includeLatest = false, error = null, expected = null } = {}) {
    const run = async () => {
      const partials = scanSessionBlocks(state.sessionDir).filter((file) => file.kind === 'partial');
      if (!partials.length) return [];
      const candidates = includeLatest ? partials : partials.slice(0, -1);
      const results = [];
      for (const file of candidates) {
        if (state.committedBlocks.has(file.index) || state.finalizingBlocks.has(file.index)) continue;
        const finalPaths = blockPaths(state.sessionDir, file.index);
        if (fs.existsSync(finalPaths.finalPath) || fs.existsSync(finalPaths.damagedPath)) {
          state.committedBlocks.add(file.index);
          continue;
        }
        state.finalizingBlocks.add(file.index);
        const firstAfterGap = state.pendingDiscontinuityIndex === null || state.pendingDiscontinuityIndex === file.index;
        const gapSeconds = firstAfterGap ? state.pendingGapSeconds : 0;
        const discontinuity = firstAfterGap && (gapSeconds > 0 || state.nextDiscontinuity);
        if (state.pendingDiscontinuityIndex === null && (gapSeconds > 0 || state.nextDiscontinuity)) state.pendingDiscontinuityIndex = file.index;
        const block = this.blockDescriptor(state, file, { gapSeconds, discontinuity });
        recordingRepository.upsertSegment(state.id, {
          segmentIndex: block.segmentIndex,
          filePath: block.tempPath,
          startedAt: block.startedAt,
          endedAt: null,
          sizeBytes: file.sizeBytes,
          durationSeconds: 0,
          mediaFormat: 'mpegts',
          status: 'recording',
          error: null,
          gapSeconds,
          discontinuity,
        });
        try {
          const result = await this.commitCurrentBlock(state, block, { expected, error });
          state.committedBlocks.add(file.index);
          state.blockCounter = Math.max(state.blockCounter, file.index);
          if (state.pendingDiscontinuityIndex === file.index) {
            state.pendingGapSeconds = 0;
            state.pendingDiscontinuityIndex = null;
            state.nextDiscontinuity = false;
          }
          results.push(result);
        } finally {
          state.finalizingBlocks.delete(file.index);
        }
      }
      return results;
    };
    state.commitQueue = state.commitQueue.then(run, run);
    return state.commitQueue;
  }

  markRecordingProgress(state, segmentIndex) {
    if (!state.outageStartedAt) return;
    const recoveredGap = Math.max(0, (Date.now() - state.outageStartedAt) / 1000);
    state.gapSeconds += recoveredGap;
    state.pendingGapSeconds = recoveredGap;
    state.nextDiscontinuity = true;
    state.pendingDiscontinuityIndex = Number(segmentIndex || state.resumeSegmentStartNumber || state.blockCounter + 1);
    state.outageStartedAt = null;
    state.resumeSegmentStartNumber = null;
    state.recovering = false;
    state.lastStableAt = Date.now();
    recordingRepository.updateRecovery(state.id, {
      interruptions: state.interruptions,
      gapSeconds: state.gapSeconds,
      metadata: { recovering: false, lastRecoveredAt: new Date().toISOString() },
    });
    this.log(state.cameraId, 'info', 'RECORDING_RESUMED', 'Blockaufnahme liefert nach einer Streamunterbrechung wieder Mediendaten', {
      recordingId: state.id,
      nextBlock: state.pendingDiscontinuityIndex,
      interruptions: state.interruptions,
      gapSeconds: Number(state.gapSeconds.toFixed(2)),
    });
  }

  monitorBlock(state, child) {
    state.lastProgressAt = Number(state.lastProgressAt || Date.now());
    state.lastFileSize = Math.max(0, Number(state.lastFileSize || 0));
    state.watchdogTimer = setInterval(() => {
      if (state.child !== child || state.stopping || state.finalizing || child.exitCode !== null) return;
      const partials = scanSessionBlocks(state.sessionDir).filter((file) => file.kind === 'partial');
      const current = partials.at(-1);
      const size = current?.sizeBytes || 0;
      if (size > state.lastFileSize || current?.index !== state.currentBlockIndex) {
        state.currentBlockIndex = current?.index || null;
        state.blockCounter = Math.max(state.blockCounter, current?.index || 0);
        state.lastFileSize = size;
        state.lastProgressAt = Date.now();
        if (size > 0) this.markRecordingProgress(state, current?.index);
      }
      this.commitClosedBlocks(state).catch((commitError) => {
        logger.error({ cameraId: state.cameraId, recordingId: state.id, err: commitError }, 'Abgeschlossene Aufnahmeblöcke konnten nicht übernommen werden');
      });
      if (Date.now() - state.lastProgressAt > config.recordingStallSeconds * 1000) {
        this.log(state.cameraId, 'warn', 'RECORDING_STALLED', 'Die Aufnahmequelle lieferte keine neuen Daten und wird neu verbunden', {
          recordingId: state.id,
          block: current?.index || state.blockCounter || null,
          stalledSeconds: Math.round((Date.now() - state.lastProgressAt) / 1000),
        });
        child.__tmpExpectedExit = null;
        child.kill('SIGKILL');
      }
    }, config.recordingWatchdogIntervalMs);
    state.watchdogTimer.unref?.();
  }

  scheduleMediaTokenRefresh(state, child, source, expiresAt) {
    if (source?.protocol !== 'hls' || !Number.isFinite(Number(expiresAt))) return;
    const remainingMs = Math.max(0, Number(expiresAt) - Date.now());
    const safetyMarginMs = Math.min(300_000, Math.max(15_000, remainingMs * 0.1));
    const delayMs = Math.max(5000, remainingMs - safetyMarginMs);
    state.rotationTimer = setTimeout(() => {
      if (state.child !== child || state.stopping || state.finalizing || child.exitCode !== null) return;
      child.__tmpExpectedExit = 'media-token-refresh';
      this.log(state.cameraId, 'info', 'RECORDING_MEDIA_TOKEN_REFRESH', 'HLS-Aufnahme wird kontrolliert mit einem frischen internen Lesetoken fortgesetzt', {
        recordingId: state.id,
        protocol: source.protocol,
        currentBlock: state.currentBlockIndex || state.blockCounter || null,
      });
      void stopFfmpegGracefully(child, config.recordingRotationGraceMs).catch((error) => {
        logger.warn({ cameraId: state.cameraId, recordingId: state.id, err: error }, 'Kontrollierte Erneuerung des Aufnahme-Lesetokens ist fehlgeschlagen');
        try {
          child.__tmpExpectedExit = null;
          if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
        } catch { /* process already ended */ }
      });
    }, delayMs);
    state.rotationTimer.unref?.();
  }

  async startRecoveryBlock(state) {
    let retryPermit = null;
    if (state.automatic && !state.hasProducedMedia) {
      retryPermit = ptzAutomationInterlock.acquireAutomaticPermit(state.cameraId, {
        triggerType: state.triggerType,
        planId: state.planId,
        eventId: state.eventId,
        requestedBy: state.requestedBy,
        recovery: true,
      });
      state.automationPermit = retryPermit;
    }
    try {
      await this.startBlock(state);
    } finally {
      retryPermit?.release();
      if (state.automationPermit === retryPermit) state.automationPermit = null;
    }
  }

  async startBlock(state, retained = null) {
    state.automationPermit?.assert('before-recording-block');
    if (state.stopping || state.finalizing || !this.active.has(state.cameraId)) return;
    this.ensureStorage();
    const session = retained || await this.resolveRecordingSession(state);
    state.automationPermit?.assert('after-recording-session');
    const mediaPath = retained?.path || session.paths?.hls;
    if (!mediaPath) throw new Error('Der unabhaengige Aufnahme-Medienpfad ist nicht verfuegbar');

    const sources = recordingSourceCandidates(mediaPath);
    const segmentPattern = path.join(state.sessionDir, 'block-%06d.ts.partial');
    state.stderr = '';
    state.lastProgressAt = Date.now();
    state.lastFileSize = 0;
    let child = null;
    let source = null;
    let selectedSegmentStartNumber = null;
    let startupFile = null;
    let selectedMediaTokenExpiresAt = null;
    const startupErrors = [];

    for (const candidate of sources) {
      source = candidate;
      const repositorySegments = recordingRepository.segmentsInternal(state.id);
      const sessionFiles = scanSessionBlocks(state.sessionDir);
      const segmentStartNumber = nextRecordingSegmentNumber({
        blockCounter: state.blockCounter,
        segmentIndexes: [
          ...repositorySegments.map((segment) => Number(segment.segment_index || 0)),
          ...sessionFiles.map((file) => Number(file.index || 0)),
        ],
      });
      const hasPlayableMedia = repositorySegments.some(isPlayableBlock)
        || sessionFiles.some((file) => file.kind === 'final' && file.sizeBytes >= config.recordingBlockMinimumBytes);
      const tokenTtlSeconds = Math.max(60, Number(config.recordingTokenTtlSeconds) || 86_400);
      const mediaToken = source.needsMediaToken ? authService.signMediaToken({
        userId: 'recording-service',
        path: mediaPath,
        action: 'read',
        expiresIn: tokenTtlSeconds,
      }) : null;
      const mediaTokenExpiresAt = mediaToken ? Date.now() + tokenTtlSeconds * 1000 : null;

      state.stderr = '';
      state.lastProgressAt = Date.now();
      state.lastFileSize = 0;
      state.automationPermit?.assert('before-ffmpeg-spawn');
      child = spawn(config.ffmpegPath, buildRecordingArgs({
        sourceUri: source.uri,
        mediaToken,
        segmentPattern,
        segmentSeconds: state.blockSeconds,
        segmentStartNumber,
        prebufferSeconds: source.protocol === 'hls' && !hasPlayableMedia ? state.prebufferSeconds : 0,
      }), { stdio: ['pipe', 'pipe', 'pipe'] });
      state.child = child;
      child.__tmpRecordingSource = source.protocol;
      const permitSignal = state.automationPermit?.controller?.signal || null;
      const abortPendingStart = () => {
        if (child.exitCode === null && !child.killed) {
          child.__tmpExpectedExit = 'ptz-interlock-abort';
          try { child.kill('SIGKILL'); } catch { /* process may have ended */ }
        }
      };
      if (permitSignal) {
        if (permitSignal.aborted) abortPendingStart();
        else permitSignal.addEventListener('abort', abortPendingStart, { once: true });
      }
      child.stdin?.on('error', () => { /* FFmpeg may close stdin during a concurrent stop. */ });
      child.stderr.on('data', (chunk) => { state.stderr = `${state.stderr}${chunk}`.slice(-12000); });
      // FFmpeg progress lines alone are not considered media progress. Some HLS
      // reconnect loops keep the process noisy while no new TS bytes are written.
      child.stdout.on('data', () => { /* progress is intentionally ignored for stall detection */ });

      let startup = await waitForRecordingStartup({
        child,
        startIndex: segmentStartNumber,
        timeoutMs: config.recordingStartupMediaTimeoutMs,
        minimumBytes: config.recordingBlockMinimumBytes,
        inspect: () => scanSessionBlocks(state.sessionDir).filter((file) => file.kind === 'partial'),
      });
      if (permitSignal) permitSignal.removeEventListener('abort', abortPendingStart);
      try {
        state.automationPermit?.assert('after-ffmpeg-startup');
      } catch (permitError) {
        child.__tmpHandled = true;
        clearBlockTimers(state);
        if (child.exitCode === null && !child.killed) {
          try { child.kill('SIGKILL'); } catch { /* process may have ended */ }
          await waitForClose(child, 2500);
        }
        await waitForSessionFilesStable(state.sessionDir, { timeoutMs: 1500, stableMs: 200 });
        await this.commitClosedBlocks(state, { includeLatest: true, expected: 'ptz-interlock-abort', error: permitError });
        if (state.child === child) state.child = null;
        throw permitError;
      }
      // Close the tiny handover window between the startup probe and the
      // long-running termination handlers below. A process that exits here
      // must never be reported as a successfully started recording.
      if (startup.ok && child.exitCode !== null) {
        startup = {
          ok: false,
          error: new Error(`FFmpeg wurde unmittelbar nach dem Medienstart beendet (${child.exitCode ?? child.signalCode ?? 'unbekannt'})`),
        };
      }

      if (state.stopping || state.finalizing || !this.active.has(state.cameraId)) {
        child.__tmpHandled = true;
        if (child.exitCode === null && !child.killed) {
          try { child.kill('SIGKILL'); } catch { /* already gone */ }
          await waitForClose(child, 2500);
        }
        if (state.child === child) state.child = null;
        return;
      }

      if (startup.ok) {
        const firstSuccessfulMediaStart = !state.hasProducedMedia;
        state.hasProducedMedia = true;
        selectedSegmentStartNumber = segmentStartNumber;
        startupFile = startup.file || null;
        selectedMediaTokenExpiresAt = mediaTokenExpiresAt;
        state.resumeSegmentStartNumber = state.outageStartedAt ? segmentStartNumber : null;
        state.recordingSourceProtocol = source.protocol;
        state.currentBlockIndex = startupFile?.index || segmentStartNumber;
        state.lastFileSize = startupFile?.sizeBytes || 0;
        state.lastProgressAt = Date.now();
        recordingRepository.updateRecovery(state.id, {
          interruptions: state.interruptions,
          gapSeconds: state.gapSeconds,
          metadata: {
            recordingSourceProtocol: source.protocol,
            recordingSourceLabel: source.label,
            startupMediaBytes: startupFile?.sizeBytes || 0,
            firstSuccessfulMediaStart,
          },
        });
        if (startupErrors.length) {
          this.log(state.cameraId, 'warn', 'RECORDING_SOURCE_FALLBACK_USED', 'Aufnahmequelle wurde nach Startfehler automatisch gewechselt', {
            recordingId: state.id,
            selectedProtocol: source.protocol,
            selectedBlock: segmentStartNumber,
            previousErrors: startupErrors.slice(-3),
          });
        }
        break;
      }

      child.__tmpHandled = true;
      clearBlockTimers(state);
      if (child.exitCode === null && !child.killed) {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
        await waitForClose(child, 2500);
      }
      await waitForSessionFilesStable(state.sessionDir, { timeoutMs: 2000, stableMs: 250 });
      await this.commitClosedBlocks(state, { includeLatest: true, error: startup.error });
      const detail = sanitizeLogText(state.stderr || startup.error?.message || 'unbekannter FFmpeg-Startfehler', 1500);
      startupErrors.push(`${source.protocol} (Block ${segmentStartNumber}): ${detail}`);
      this.log(state.cameraId, 'warn', 'RECORDING_SOURCE_START_FAILED', 'Aufnahmequelle hat keine verwertbaren Mediendaten geliefert; Fallback wird versucht', {
        recordingId: state.id,
        protocol: source.protocol,
        block: segmentStartNumber,
        startupTimeoutMs: config.recordingStartupMediaTimeoutMs,
        minimumBytes: config.recordingBlockMinimumBytes,
        error: detail,
      });
      if (state.child === child) state.child = null;
      child = null;
    }

    if (!child || !source || !selectedSegmentStartNumber) {
      const error = new Error(startupErrors.join(' | ') || 'FFmpeg konnte keine Aufnahmequelle mit Mediendaten starten');
      error.details = startupErrors;
      throw error;
    }

    const handleTermination = (error = null) => {
      if (child.__tmpHandled) return;
      child.__tmpHandled = true;
      state.blockFinalizing = (async () => {
        clearBlockTimers(state);
        const expected = child.__tmpExpectedExit;
        const expectedBoundary = ['stop', 'abort', 'media-token-refresh'].includes(expected);
        const pendingFiles = scanSessionBlocks(state.sessionDir).filter((file) => file.kind === 'partial' && file.sizeBytes > 0);
        if (pendingFiles.length && state.outageStartedAt) this.markRecordingProgress(state, pendingFiles[0].index);
        await this.commitClosedBlocks(state, {
          includeLatest: true,
          expected: expectedBoundary ? expected : null,
          error,
        });
        if (state.child === child) state.child = null;
        if (state.stopping || state.finalizing || expected === 'stop' || expected === 'abort') return;
        if (expected === 'media-token-refresh') {
          await this.startBlock(state);
          return;
        }
        await this.scheduleResume(state, error || new Error(`Aufnahmeprozess beendet (${child.exitCode ?? 'unbekannt'})`));
      })().catch((terminationError) => {
        logger.error({ cameraId: state.cameraId, recordingId: state.id, err: terminationError }, 'Aufnahmeprozess konnte nicht abgeschlossen werden');
        return this.scheduleResume(state, terminationError).catch(() => {});
      }).finally(() => {
        if (state.blockFinalizing) state.blockFinalizing = null;
      });
    };
    child.once('error', handleTermination);
    child.once('close', (code, signal) => handleTermination(code === 0 ? null : new Error(`Aufnahmeprozess beendet (${code ?? signal})`)));

    if (startupFile?.sizeBytes > 0 && state.outageStartedAt) this.markRecordingProgress(state, startupFile.index);
    this.monitorBlock(state, child);
    this.scheduleMediaTokenRefresh(state, child, source, selectedMediaTokenExpiresAt);

    if (!state.outageStartedAt) {
      state.recovering = false;
      state.lastStableAt = Date.now();
    }
  }

  async scheduleResume(state, error, { initialStart = false } = {}) {
    if (!this.active.has(state.cameraId) || state.stopping || state.finalizing || state.restartTimer) {
      return { scheduled: false, reason: 'inactive-or-already-scheduled' };
    }

    const errorCode = String(error?.code || '');
    const deferredByPtz = state.automatic
      && !state.hasProducedMedia
      && errorCode === 'AUTOMATIC_RECORDING_SUPPRESSED_PTZ';
    const stableForMs = Date.now() - state.lastStableAt;
    if (!deferredByPtz && stableForMs >= config.recordingStableResetSeconds * 1000) state.reconnectAttempts = 0;
    const newOutage = !state.outageStartedAt;
    if (newOutage) {
      state.outageStartedAt = Date.now();
      state.interruptions += 1;
    }
    if (!deferredByPtz) state.reconnectAttempts += 1;
    state.recovering = true;
    const outageSeconds = Math.max(0, (Date.now() - state.outageStartedAt) / 1000);
    const decision = recordingRecoveryDecision({
      triggerType: state.triggerType,
      automatic: state.automatic,
      hasProducedMedia: state.hasProducedMedia,
      errorCode,
      outageSeconds,
      reconnectAttempts: state.reconnectAttempts,
      maxOutageSeconds: config.recordingMaxOutageSeconds,
      maxReconnectAttempts: config.recordingMaxReconnectAttempts,
    });
    recordingRepository.updateRecovery(state.id, {
      interruptions: state.interruptions,
      gapSeconds: state.gapSeconds + outageSeconds,
      metadata: {
        recovering: !decision.terminal,
        initialStartRecovery: Boolean(initialStart || (!state.hasProducedMedia && state.blockCounter === 0)),
        recoveryReason: decision.reason,
        lastInterruptionAt: new Date().toISOString(),
      },
    });
    this.journal(state, decision.terminal ? 'recovery-limit' : (decision.deferredByPtz ? 'waiting-ptz' : 'reconnecting'));

    if (decision.terminal) {
      state.terminalReason = decision.reason.replaceAll('-', '_');
      this.log(state.cameraId, 'error', 'RECORDING_RECOVERY_LIMIT', 'Aufnahme konnte innerhalb der konfigurierten Fehlertoleranz nicht wieder verbunden werden', {
        recordingId: state.id,
        reason: state.terminalReason,
        outageSeconds: Math.round(outageSeconds),
        reconnectAttempts: state.reconnectAttempts,
      });
      adminAlertService.notify({
        level: 'error',
        code: 'RECORDING_RECOVERY_LIMIT',
        cameraId: state.cameraId,
        message: 'Eine Blockaufnahme hat die Wiederverbindungsgrenze erreicht.',
        details: { recordingId: state.id, reason: state.terminalReason, outageSeconds: Math.round(outageSeconds) },
      }).catch(() => {});
      state.stopping = true;
      await this.finalizeSession(state, { forcedWithGaps: true });
      return { scheduled: false, terminal: true, reason: state.terminalReason };
    }

    const ptzBlock = decision.deferredByPtz ? ptzAutomationInterlock.blockDetails(state.cameraId) : null;
    const delay = decision.deferredByPtz
      ? ptzDeferredRetryDelay(ptzBlock, { fallbackMs: config.recordingReconnectBaseMs })
      : reconnectDelay(Math.max(1, state.reconnectAttempts));
    this.log(state.cameraId, 'warn', decision.deferredByPtz ? 'RECORDING_RECONNECT_DEFERRED_PTZ' : 'RECORDING_RECONNECT_SCHEDULED', decision.deferredByPtz
      ? 'Wiederverbindung der noch nicht gestarteten automatischen Aufnahme wartet bis zum Ende der PTZ-Bedienung'
      : 'Aufnahmequelle wurde unterbrochen; der nächste Block wird automatisch fortgesetzt', {
      recordingId: state.id,
      delay,
      interruptions: state.interruptions,
      outageSeconds: Math.round(outageSeconds),
      reconnectAttempt: state.reconnectAttempts,
      sourceProtocol: config.recordingSourceProtocol,
      recoveryReason: decision.reason,
      error: sanitizeLogText(state.stderr || error?.message || 'Stream beendet', 1000),
    });
    state.restartTimer = setTimeout(async () => {
      state.restartTimer = null;
      if (state.stopping || state.finalizing || !this.active.has(state.cameraId)) return;
      if (state.reconnectInFlight) {
        await this.scheduleResume(state, new Error('Wiederverbindungsversuch laeuft bereits'));
        return;
      }
      state.reconnectInFlight = true;
      try {
        await this.startRecoveryBlock(state);
      } catch (resumeError) {
        await this.scheduleResume(state, resumeError);
      } finally {
        state.reconnectInFlight = false;
      }
    }, delay);
    state.restartTimer.unref?.();
    return { scheduled: true, terminal: false, delay, deferredByPtz: decision.deferredByPtz, reason: decision.reason };
  }

  async stop(recordingId) {
    const state = [...this.active.values()].find((item) => item.id === Number(recordingId));
    const existing = state ? null : recordingRepository.get(recordingId);
    const cameraId = state?.cameraId || existing?.cameraId || null;
    if (!cameraId) throw new AppError(404, 'RECORDING_NOT_FOUND', 'Aufnahme nicht gefunden');
    return cameraRuntimeCoordinator.runRecordingTask(cameraId, 'stop-recording', () => this.stopImmediate(recordingId));
  }

  async stopImmediate(recordingId) {
    const state = [...this.active.values()].find((item) => item.id === Number(recordingId));
    if (!state) {
      const existing = recordingRepository.get(recordingId);
      if (!existing) throw new AppError(404, 'RECORDING_NOT_FOUND', 'Aufnahme nicht gefunden');
      if (existing.status !== 'recording') return existing;
      recordingRepository.updateRecovery(recordingId, {
        interruptions: existing.interruptions,
        gapSeconds: existing.gapSeconds,
        status: 'interrupted',
        metadata: { processMissing: true },
      });
      throw new AppError(409, 'RECORDING_PROCESS_MISSING', 'Der Aufnahmeauftrag läuft nicht mehr; die Blöcke werden beim Neustart wiederhergestellt');
    }
    state.stopping = true;
    clearBlockTimers(state);
    if (state.restartTimer) clearTimeout(state.restartTimer);
    state.restartTimer = null;
    if (state.child?.exitCode === null && !state.child.killed) {
      const child = state.child;
      child.__tmpExpectedExit = 'stop';
      const stopResult = await stopFfmpegGracefully(child, config.recordingStopGraceMs);
      this.log(state.cameraId, stopResult.method === 'sigkill' ? 'warn' : 'info', 'RECORDING_PROCESS_STOPPED',
        stopResult.method === 'sigkill'
          ? 'Aufnahmeprozess musste nach Ablauf der Abschlussfrist beendet werden'
          : 'Aufnahmeprozess wurde kontrolliert beendet und der letzte Block wird abgeschlossen', {
          recordingId: state.id,
          method: stopResult.method,
          exitCode: stopResult.code,
          signal: stopResult.signal,
        });
    }
    await waitForSessionFilesStable(state.sessionDir);
    if (state.blockFinalizing) await state.blockFinalizing;
    await this.commitClosedBlocks(state, { includeLatest: true, expected: 'stop' });
    await state.commitQueue;
    return this.finalizeSession(state);
  }

  async finalizeSession(state, { forcedWithGaps = false } = {}) {
    if (state.finalizing) return state.finalizing;
    state.finalizing = (async () => {
      this.active.delete(state.cameraId);
      clearBlockTimers(state);
      if (state.restartTimer) clearTimeout(state.restartTimer);
      state.restartTimer = null;
      await this.commitClosedBlocks(state, { includeLatest: true, expected: 'stop' });
      await state.commitQueue;
      streamOrchestrator.release(state.retainedKey);
      const endedAt = new Date().toISOString();
      if (state.outageStartedAt) {
        state.gapSeconds += Math.max(0, (Date.now() - state.outageStartedAt) / 1000);
        state.outageStartedAt = null;
      }
      const durationSeconds = Math.max(0, Math.round((Date.now() - state.startedAtMs) / 1000));
      const segments = recordingRepository.segmentsInternal(state.id);
      const summary = summarizeBlocks(segments);
      if (!summary.playableBlockCount) {
        const failed = recordingRepository.fail(state.id, endedAt, {
          storageFormat: ARCHIVE_FORMAT,
          terminalReason: state.terminalReason,
          blockCount: summary.blockCount,
          damagedBlockCount: summary.damagedBlockCount,
          finalizationError: 'Keine abspielbaren Aufnahmeblöcke vorhanden',
        });
        this.journal(state, 'failed', { terminalReason: state.terminalReason });
        this.log(state.cameraId, 'error', 'RECORDING_NO_PLAYABLE_BLOCKS', 'Aufnahme enthält keinen abspielbaren Block', { recordingId: state.id });
        return failed;
      }
      const hasGaps = forcedWithGaps || state.interruptions > 0 || state.gapSeconds > 0 || summary.damagedBlockCount > 0;
      const completed = recordingRepository.finish(state.id, {
        filename: state.filename,
        filePath: state.sessionDir,
        endedAt,
        durationSeconds,
        fileSizeBytes: summary.fileSizeBytes,
        status: hasGaps ? 'ready_with_gaps' : 'ready',
        interruptions: state.interruptions,
        gapSeconds: Number(state.gapSeconds.toFixed(3)),
        metadata: {
          storageFormat: ARCHIVE_FORMAT,
          recovering: false,
          blockCount: summary.blockCount,
          playableBlockCount: summary.playableBlockCount,
          damagedBlockCount: summary.damagedBlockCount,
          mediaDurationSeconds: Number(summary.mediaDurationSeconds.toFixed(3)),
          terminalReason: state.terminalReason,
          finalizedAt: endedAt,
        },
      });
      this.journal(state, completed.status, { endedAt, terminalReason: state.terminalReason });
      this.log(state.cameraId, 'info', 'RECORDING_FINISHED', hasGaps
        ? 'Blockaufnahme wurde mit erhaltenen Blöcken und dokumentierten Unterbrechungen abgeschlossen'
        : 'Blockaufnahme wurde ohne Unterbrechung abgeschlossen', {
        recordingId: state.id,
        durationSeconds,
        mediaDurationSeconds: Number(summary.mediaDurationSeconds.toFixed(2)),
        fileSizeBytes: summary.fileSizeBytes,
        blocks: summary.playableBlockCount,
        damagedBlocks: summary.damagedBlockCount,
        interruptions: state.interruptions,
        gapSeconds: Number(state.gapSeconds.toFixed(2)),
        status: completed.status,
      });
      return completed;
    })().catch((error) => {
      recordingRepository.fail(state.id, new Date().toISOString(), { finalizationError: sanitizeLogText(error.message, 800) });
      this.journal(state, 'failed', { errorCode: 'RECORDING_FINALIZE_FAILED' });
      this.log(state.cameraId, 'error', 'RECORDING_FINALIZE_FAILED', 'Blockaufnahme konnte nicht abgeschlossen werden', {
        recordingId: state.id,
        error: sanitizeLogText(error.message, 800),
      });
      adminAlertService.notify({
        level: 'error', code: 'RECORDING_FINALIZE_FAILED', cameraId: state.cameraId,
        message: 'Eine Blockaufnahme konnte nicht abgeschlossen werden.', details: { recordingId: state.id },
      }).catch(() => {});
      throw new AppError(502, 'RECORDING_FINALIZE_FAILED', 'Aufnahme konnte nicht abgeschlossen werden', sanitizeLogText(error.message, 500));
    });
    return state.finalizing;
  }

  async recoverInterruptedRecordings(limit = 100) {
    if (this.recoveryPromise) return this.recoveryPromise;
    this.recoveryPromise = this.performInterruptedRecovery(limit);
    try { return await this.recoveryPromise; }
    finally { this.recoveryPromise = null; }
  }

  async performInterruptedRecovery(limit) {
    const rows = recordingRepository.recoverableSessions(Math.max(1, Math.min(1000, Number(limit) || 100)));
    const summary = { examined: rows.length, recovered: 0, failed: 0, skipped: 0, blocksRecovered: 0 };
    for (const row of rows) {
      try {
        const metadata = parseMetadata(row.metadata_json);
        const recovered = metadata.storageFormat === ARCHIVE_FORMAT || (isRecordingPath(row.file_path) && fs.existsSync(row.file_path) && fs.statSync(row.file_path).isDirectory())
          ? await this.recoverBlockArchive(row)
          : await this.recoverLegacyRecording(row);
        if (recovered) {
          summary.recovered += 1;
          summary.blocksRecovered += recovered.playableBlockCount || 0;
        } else summary.skipped += 1;
      } catch (error) {
        summary.failed += 1;
        logger.error({ cameraId: row.camera_id, recordingId: row.id, err: error }, 'Unterbrochene Aufnahme konnte nicht wiederhergestellt werden');
      }
    }
    if (summary.recovered || summary.failed) logger.info(summary, 'Wiederherstellung unterbrochener Aufnahmen wurde abgeschlossen');
    if (summary.failed) {
      adminAlertService.notify({
        level: 'error', code: 'RECORDING_RECOVERY_FAILED',
        message: 'Mindestens eine unterbrochene Aufnahme konnte beim Neustart nicht wiederhergestellt werden.',
        details: { failed: summary.failed, recovered: summary.recovered },
      }).catch(() => {});
    }
    return summary;
  }

  async recoverBlockArchive(row) {
    const sessionDir = path.resolve(row.file_path);
    if (!isRecordingPath(sessionDir) || !fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) return null;
    const files = scanSessionBlocks(sessionDir);
    if (!files.length && !recordingRepository.segmentsInternal(row.id).length) return null;
    const byIndex = new Map();
    for (const file of files) {
      const current = byIndex.get(file.index);
      const rank = { final: 3, partial: 2, damaged: 1 }[file.kind];
      const currentRank = current ? { final: 3, partial: 2, damaged: 1 }[current.kind] : 0;
      if (rank > currentRank) byIndex.set(file.index, file);
    }

    for (const [index, file] of byIndex) {
      if (file.kind === 'partial') {
        const paths = blockPaths(sessionDir, index);
        const result = await finalizeBlock({
          tempPath: file.filePath,
          finalPath: paths.finalPath,
          damagedPath: paths.damagedPath,
          ffprobePath: config.ffprobePath,
          probeTimeoutMs: config.recordingBlockProbeTimeoutMs,
          minimumBytes: config.recordingBlockMinimumBytes,
        });
        recordingRepository.upsertSegment(row.id, {
          segmentIndex: index,
          filePath: result.filePath || file.filePath,
          startedAt: row.started_at,
          endedAt: file.mtime.toISOString(),
          finalizedAt: new Date().toISOString(),
          sizeBytes: result.sizeBytes,
          durationSeconds: result.durationSeconds,
          mediaFormat: result.mediaFormat,
          status: result.playable ? 'recovered' : result.status,
          error: result.error,
          gapSeconds: index > 1 ? Number(row.gap_seconds || 0) : 0,
          discontinuity: index > 1,
        });
        if (result.playable) this.queueFinalizedBlockForStorage(row.id, index, result.filePath || file.filePath);
      } else if (file.kind === 'final') {
        let assessment;
        try {
          assessment = assessProbe(await probeMedia(file.filePath, { ffprobePath: config.ffprobePath, timeoutMs: config.recordingBlockProbeTimeoutMs }), file.sizeBytes, { minimumBytes: config.recordingBlockMinimumBytes });
        } catch (error) {
          assessment = { playable: false, durationSeconds: 0, formatName: 'mpegts', reason: sanitizeLogText(error.message, 800) };
        }
        recordingRepository.upsertSegment(row.id, {
          segmentIndex: index,
          filePath: file.filePath,
          startedAt: row.started_at,
          endedAt: file.mtime.toISOString(),
          finalizedAt: file.mtime.toISOString(),
          sizeBytes: file.sizeBytes,
          durationSeconds: assessment.durationSeconds || 0,
          mediaFormat: assessment.formatName || 'mpegts',
          status: assessment.playable ? 'recovered' : 'damaged',
          error: assessment.playable ? null : assessment.reason,
          gapSeconds: index > 1 ? Number(row.gap_seconds || 0) : 0,
          discontinuity: index > 1,
        });
        if (assessment.playable) this.queueFinalizedBlockForStorage(row.id, index, file.filePath);
      } else {
        recordingRepository.upsertSegment(row.id, {
          segmentIndex: index,
          filePath: file.filePath,
          startedAt: row.started_at,
          endedAt: file.mtime.toISOString(),
          finalizedAt: file.mtime.toISOString(),
          sizeBytes: file.sizeBytes,
          durationSeconds: 0,
          mediaFormat: 'mpegts',
          status: 'damaged',
          error: 'Block war bereits als beschädigt markiert.',
          gapSeconds: 0,
          discontinuity: index > 1,
        });
      }
    }

    const segments = recordingRepository.segmentsInternal(row.id);
    const summary = summarizeBlocks(segments);
    const endedAt = row.ended_at || new Date().toISOString();
    if (!summary.playableBlockCount) {
      recordingRepository.fail(row.id, endedAt, {
        storageFormat: ARCHIVE_FORMAT,
        recoveredAfterRestart: false,
        damagedBlockCount: summary.damagedBlockCount,
        recoveryError: 'Keine abspielbaren Blöcke vorhanden',
      });
      return null;
    }
    const durationSeconds = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(row.started_at).getTime()) / 1000));
    const completed = recordingRepository.finish(row.id, {
      filename: row.filename.endsWith('.m3u8') ? row.filename : `${path.parse(row.filename).name}.m3u8`,
      filePath: sessionDir,
      endedAt,
      durationSeconds,
      fileSizeBytes: summary.fileSizeBytes,
      status: 'ready_with_gaps',
      interruptions: Math.max(1, Number(row.interruption_count || 0)),
      gapSeconds: Number(row.gap_seconds || 0),
      metadata: {
        storageFormat: ARCHIVE_FORMAT,
        recoveredAfterRestart: true,
        recoveredAt: new Date().toISOString(),
        blockCount: summary.blockCount,
        playableBlockCount: summary.playableBlockCount,
        damagedBlockCount: summary.damagedBlockCount,
        mediaDurationSeconds: summary.mediaDurationSeconds,
      },
    });
    try {
      writeJournal(sessionDir, {
        schema: 1,
        product: 'tmp-camera-surveillance-next',
        recordingId: row.id,
        cameraId: row.camera_id,
        status: 'ready_with_gaps',
        startedAt: row.started_at,
        endedAt,
        recoveredAt: new Date().toISOString(),
        blocks: recordingRepository.segments(row.id),
      });
    } catch {}
    this.log(row.camera_id, 'warn', 'RECORDING_RECOVERED_AFTER_RESTART', 'Unterbrochene Blockaufnahme wurde aus atomar gespeicherten Blöcken wiederhergestellt', {
      recordingId: row.id,
      blocks: summary.playableBlockCount,
      damagedBlocks: summary.damagedBlockCount,
      fileSizeBytes: summary.fileSizeBytes,
    });
    return completed;
  }

  async recoverLegacyRecording(row) {
    const parts = recoverableLegacyParts(row);
    if (!parts.length) return null;
    const finalPath = path.resolve(row.file_path);
    const directory = path.dirname(finalPath);
    const base = path.parse(finalPath).name;
    const combinedPath = path.join(directory, `${base}.recovery-${row.id}.combined.ts`);
    for (const part of parts) {
      recordingRepository.upsertSegment(row.id, {
        segmentIndex: part.segmentIndex,
        filePath: part.filePath,
        startedAt: row.started_at,
        endedAt: part.mtime.toISOString(),
        finalizedAt: part.mtime.toISOString(),
        sizeBytes: part.sizeBytes,
        durationSeconds: 0,
        mediaFormat: 'mpegts',
        status: 'recovered',
        error: null,
        gapSeconds: 0,
        discontinuity: part.segmentIndex > 1,
      });
    }
    try {
      if (parts.length === 1) await fs.promises.copyFile(parts[0].filePath, combinedPath);
      else await concatenateFiles(parts.map((part) => part.filePath), combinedPath);
      let outputPath = finalPath;
      let outputFilename = path.basename(finalPath);
      let remuxFallback = false;
      try { await spawnAndWait(config.ffmpegPath, buildRecordingRemuxArgs(combinedPath, finalPath)); }
      catch (error) {
        outputPath = path.join(directory, `${base}.recovered.ts`);
        outputFilename = path.basename(outputPath);
        await fs.promises.rm(outputPath, { force: true });
        await fs.promises.rename(combinedPath, outputPath);
        remuxFallback = true;
        logger.warn({ cameraId: row.camera_id, recordingId: row.id, error: sanitizeLogText(error.message, 800) }, 'Alte unterbrochene Aufnahme bleibt als MPEG-TS erhalten');
      }
      const size = safeFileSize(outputPath);
      if (!size) throw new Error('Wiederhergestellte Aufnahmedatei ist leer');
      const endedAt = row.ended_at || new Date().toISOString();
      const durationSeconds = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(row.started_at).getTime()) / 1000));
      const completed = recordingRepository.finish(row.id, {
        filename: outputFilename,
        filePath: outputPath,
        endedAt,
        durationSeconds,
        fileSizeBytes: size,
        status: 'ready_with_gaps',
        interruptions: Math.max(1, Number(row.interruption_count || 0)),
        gapSeconds: Number(row.gap_seconds || 0),
        metadata: { recoveredAfterRestart: true, recoveredAt: new Date().toISOString(), recoveredSegmentCount: parts.length, remuxFallback },
      });
      for (const part of parts) fs.rmSync(part.filePath, { force: true });
      return completed;
    } finally {
      fs.rmSync(combinedPath, { force: true });
    }
  }

  list(input) { return recordingRepository.list(input); }

  activeList(cameraId = null) {
    return [...this.active.values()]
      .filter((state) => !cameraId || state.cameraId === cameraId)
      .map((state) => ({
        ...recordingRepository.get(state.id),
        elapsedSeconds: Math.round((Date.now() - state.startedAtMs) / 1000),
        recovering: state.recovering,
        interruptions: state.interruptions,
        gapSeconds: Number((state.gapSeconds + (state.outageStartedAt ? (Date.now() - state.outageStartedAt) / 1000 : 0)).toFixed(2)),
        blocks: recordingRepository.segments(state.id).filter((segment) => segment.playable).length,
        currentBlock: state.blockCounter,
        reconnectAttempts: state.reconnectAttempts,
        triggerType: state.triggerType,
        planIds: state.planIds,
      }));
  }

  get(id) { return recordingRepository.get(id); }
  segments(id) {
    if (!recordingRepository.get(id)) throw new AppError(404, 'RECORDING_NOT_FOUND', 'Aufnahme nicht gefunden');
    return recordingRepository.segments(id);
  }
  activeForCamera(cameraId) {
    const state = this.active.get(cameraId);
    return state ? this.activeList(cameraId)[0] : null;
  }

  isBlockArchive(row) {
    return parseMetadata(row?.metadata_json).storageFormat === ARCHIVE_FORMAT || (row?.file_path && fs.existsSync(row.file_path) && fs.statSync(row.file_path).isDirectory());
  }

  playlist(id, token) {
    const row = recordingRepository.getInternal(id);
    if (!row) throw new AppError(404, 'RECORDING_NOT_FOUND', 'Aufnahme nicht gefunden');
    if (!['ready', 'ready_with_gaps', 'recording'].includes(row.status)) throw new AppError(409, 'RECORDING_NOT_READY', 'Aufnahme ist noch nicht abspielbereit');
    if (!this.isBlockArchive(row)) return null;
    const segments = recordingRepository.playableSegmentsInternal(id);
    const playlist = buildVodPlaylist(segments, (segment) => `/api/recordings/${id}/blocks/${segment.segment_index}/file?token=${encodeURIComponent(token)}`);
    if (!playlist) throw new AppError(409, 'RECORDING_BLOCKS_MISSING', row.status === 'recording' ? 'Diese Aufnahme läuft noch; es wurde noch kein Block abgeschlossen. Bitte nach der ersten Blocklänge erneut versuchen.' : 'Keine abspielbaren Aufnahmeblöcke vorhanden');
    return playlist;
  }

  async blockFile(id, segmentIndex) {
    const row = recordingRepository.getInternal(id);
    if (!row) throw new AppError(404, 'RECORDING_NOT_FOUND', 'Aufnahme nicht gefunden');
    const segment = recordingRepository.segmentInternal(id, segmentIndex);
    if (!segment || !isPlayableBlock(segment)) throw new AppError(404, 'RECORDING_BLOCK_MISSING', 'Aufnahmeblock wurde nicht gefunden');
    try {
      const materialized = await networkRecordingStorageService.materializeSegment(segment);
      return { path: materialized.path, filename: path.basename(materialized.path), mediaFormat: segment.media_format || 'mpegts', cached: materialized.cached };
    } catch (error) {
      throw new AppError(404, 'RECORDING_BLOCK_MISSING', 'Aufnahmeblock wurde nicht gefunden', sanitizeLogText(error?.message || String(error), 500));
    }
  }

  async exportFiles(id) {
    const row = recordingRepository.getInternal(id);
    if (!row) throw new AppError(404, 'RECORDING_NOT_FOUND', 'Aufnahme nicht gefunden');
    if (!['ready', 'ready_with_gaps', 'recording'].includes(row.status)) throw new AppError(409, 'RECORDING_NOT_READY', 'Aufnahme ist noch nicht abspielbereit');
    if (!this.isBlockArchive(row)) {
      const resolved = path.resolve(row.file_path);
      if (!isRecordingPath(resolved) || !fs.existsSync(resolved)) throw new AppError(404, 'RECORDING_FILE_MISSING', 'Aufnahmedatei wurde nicht gefunden');
      return { files: [resolved], filename: row.filename, contentType: path.extname(row.filename) === '.ts' ? 'video/mp2t' : 'video/mp4', legacy: true };
    }
    const files = [];
    for (const segment of recordingRepository.playableSegmentsInternal(id)) {
      try {
        const materialized = await networkRecordingStorageService.materializeSegment(segment);
        files.push(materialized.path);
      } catch (error) {
        logger.warn({ recordingId: id, segmentIndex: segment.segment_index, err: error }, 'Aufnahmeblock konnte fuer den Export nicht aus dem Netzwerkspeicher geladen werden');
      }
    }
    if (!files.length) throw new AppError(404, 'RECORDING_BLOCKS_MISSING', row.status === 'recording' ? 'Diese Aufnahme läuft noch; es wurde noch kein Block abgeschlossen. Bitte nach der ersten Blocklänge erneut versuchen.' : 'Keine abspielbaren Aufnahmeblöcke vorhanden');
    return { files, filename: `${path.parse(row.filename).name}.ts`, contentType: 'video/mp2t', legacy: false };
  }

  async file(id) {
    const exported = await this.exportFiles(id);
    if (!exported.legacy || exported.files.length !== 1) throw new AppError(409, 'RECORDING_IS_BLOCK_ARCHIVE', 'Diese Aufnahme wird als Blockarchiv bereitgestellt');
    return { path: exported.files[0], filename: exported.filename };
  }

  async remove(id) {
    const row = recordingRepository.getInternal(id);
    if (!row) throw new AppError(404, 'RECORDING_NOT_FOUND', 'Aufnahme nicht gefunden');
    if (row.status === 'recording') throw new AppError(409, 'RECORDING_ACTIVE', 'Laufende Aufnahme zuerst stoppen');
    const segments = recordingRepository.segmentsInternal(id);
    for (const segment of segments) {
      if (segment.storage_profile_id && segment.remote_path) {
        // Do not orphan a remote file when the NAS/server is unavailable. The
        // API reports the failure and the user can retry deletion later.
        await networkRecordingStorageService.deleteRemoteSegment(segment);
      }
    }
    const paths = new Set([row.file_path, ...segments.map((segment) => segment.file_path)]);
    for (const item of paths) {
      if (!item) continue;
      const resolved = path.resolve(item);
      if (!isRecordingPath(resolved)) continue;
      try {
        const stat = fs.statSync(resolved);
        fs.rmSync(resolved, { force: true, recursive: stat.isDirectory() });
      } catch { fs.rmSync(resolved, { force: true }); }
    }
    recordingRepository.remove(id);
  }

  async stopCamera(cameraId) {
    const state = this.active.get(cameraId);
    if (state) await this.stop(state.id).catch(() => {});
  }

  async shutdown() {
    for (const state of [...this.active.values()]) await this.stop(state.id).catch(() => {});
  }
}

export const recordingService = new RecordingService();
