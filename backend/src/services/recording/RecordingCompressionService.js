import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../../config.js';
import { db } from '../../db/database.js';
import { logger } from '../../utils/logger.js';
import { cameraEventLog, sanitizeLogText } from '../CameraEventLog.js';
import { streamOrchestrator } from '../media/StreamOrchestrator.js';
import { ptzAutomationInterlock } from '../runtime/PtzAutomationInterlock.js';
import { recordingRepository } from '../recordingRepository.js';
import { assessProbe, probeMedia } from './BlockArchive.js';
import { buildRecordingCompressionArgs } from './RecordingCompressionCommand.js';
import { isRecordingStoragePath } from './RecordingStoragePaths.js';

function nowIso() { return new Date().toISOString(); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function fileSize(filePath) { try { return fs.statSync(filePath).size; } catch { return 0; } }
function freeBytes(directory) {
  try {
    const stats = fs.statfsSync(directory);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

class CompressionDeferredError extends Error {
  constructor(reason) {
    super(`Aufnahme-Komprimierung wurde zugunsten des Livebetriebs pausiert: ${reason}`);
    this.name = 'CompressionDeferredError';
    this.code = 'RECORDING_COMPRESSION_DEFERRED';
    this.reason = reason;
  }
}

function runFfmpeg(inputPath, outputPath, { onChild = () => {}, shouldDefer = () => null } = {}) {
  return new Promise((resolve, reject) => {
    const args = buildRecordingCompressionArgs({
      inputPath, outputPath,
      crf: config.recordingCompressionCrf,
      maxVideoBitrateKbps: config.recordingCompressionMaxVideoBitrateKbps,
      preset: config.recordingCompressionPreset,
      threads: config.recordingCompressionThreads,
      maxHeight: config.recordingCompressionMaxHeight,
      audioBitrateKbps: config.recordingCompressionAudioBitrateKbps,
    });
    const child = spawn(config.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    onChild(child);
    try {
      if (child.pid && Number(config.recordingCompressionNice || 0) > 0) {
        os.setPriority(child.pid, Number(config.recordingCompressionNice));
      }
    } catch (error) {
      logger.debug({ err: error }, 'Niedrige Prozessprioritaet fuer Aufnahme-Komprimierung konnte nicht gesetzt werden');
    }

    let stderr = '';
    let settled = false;
    let terminationError = null;
    let forceTimer = null;
    const terminate = (error) => {
      if (terminationError || settled) return;
      terminationError = error;
      if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
      forceTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 3000);
      forceTimer.unref?.();
    };
    const timeoutTimer = setTimeout(() => {
      terminate(new Error('Zeitlimit der Aufnahme-Komprimierung ueberschritten'));
    }, config.recordingCompressionTimeoutMs);
    timeoutTimer.unref?.();
    const activityTimer = setInterval(() => {
      const reason = shouldDefer();
      if (reason) terminate(new CompressionDeferredError(reason));
    }, Math.max(1000, Number(config.recordingCompressionRuntimeCheckMs || 2000)));
    activityTimer.unref?.();

    function finish(error = null) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearInterval(activityTimer);
      if (forceTimer) clearTimeout(forceTimer);
      if (error) reject(error); else resolve();
    }

    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-16000); });
    child.once('error', (error) => finish(terminationError || error));
    child.once('exit', (code, signal) => {
      if (terminationError) return finish(terminationError);
      if (code === 0) return finish();
      return finish(new Error(sanitizeLogText(stderr || `FFmpeg beendet (${code ?? signal})`, 3000)));
    });
  });
}

function safeRecordingPath(filePath) {
  const resolved = path.resolve(filePath || '');
  return isRecordingStoragePath(resolved, { allowRoot: false }) && resolved.endsWith('.ts') && !resolved.endsWith('.partial');
}

class RecordingCompressionService {
  constructor() {
    this.running = false;
    this.processing = false;
    this.timer = null;
    this.current = null;
    this.child = null;
    this.pauseReason = null;
    this.lastBusyAt = 0;
  }

  reconcileTransientFiles() {
    const rows = db.prepare(`SELECT j.id,j.status,j.file_path,j.compressed_bytes,j.original_bytes
      FROM recording_compression_jobs j
      JOIN recording_segments s ON s.recording_id=j.recording_id AND s.segment_index=j.segment_index`).all();
    let restored = 0;
    let requeued = 0;
    let removed = 0;
    let removedBytes = 0;
    const now = nowIso();
    const requeue = (row) => {
      db.prepare("UPDATE recording_compression_jobs SET status='queued',attempts=0,started_at=NULL,completed_at=NULL,updated_at=?,next_attempt_at=?,error=NULL WHERE id=?")
        .run(now, now, row.id);
      requeued += 1;
    };
    const removeFile = (filePath) => {
      try {
        const stat = fs.statSync(filePath);
        fs.rmSync(filePath, { force: true });
        removed += 1;
        removedBytes += stat.size;
        return true;
      } catch { return false; }
    };
    for (const row of rows) {
      const source = path.resolve(row.file_path || '');
      if (!safeRecordingPath(source)) continue;
      const temporary = `${source}.compressing`;
      const backup = `${source}.compression-backup`;
      const sourceExists = fs.existsSync(source);
      const backupExists = fs.existsSync(backup);
      const temporaryExists = fs.existsSync(temporary);
      const terminal = ['completed','skipped','failed'].includes(String(row.status || ''));

      // A hard container stop can interrupt the atomic source replacement. For
      // non-terminal jobs the backup is the last known-good original and wins.
      // This deliberately sacrifices a possibly valid half-committed compressed
      // copy rather than ever losing the original recording block.
      if (backupExists && !terminal) {
        try {
          if (sourceExists) removeFile(source);
          fs.renameSync(backup, source);
          restored += 1;
          if (temporaryExists) removeFile(temporary);
          requeue(row);
        } catch {}
        continue;
      }

      if (!sourceExists && backupExists) {
        try {
          fs.renameSync(backup, source);
          restored += 1;
          if (temporaryExists) removeFile(temporary);
          requeue(row);
        } catch {}
        continue;
      }

      if (!terminal) {
        // .compressing is disposable output. The intact source remains the
        // authority until the database job reaches a terminal state.
        if (temporaryExists) removeFile(temporary);
        if (String(row.status || '') === 'processing') requeue(row);
        continue;
      }

      if (row.status === 'completed' && fs.existsSync(source) && Number(row.compressed_bytes || 0) > 0 && fileSize(source) !== Number(row.compressed_bytes)) {
        // The database says the compression committed, but the bytes disagree.
        // If a backup still exists restore it; otherwise keep the existing file
        // and re-run compression from that safe local copy.
        try {
          if (backupExists) {
            removeFile(source);
            fs.renameSync(backup, source);
            restored += 1;
          }
          if (temporaryExists) removeFile(temporary);
          requeue(row);
        } catch {}
        continue;
      }

      // Terminal jobs no longer need their transactional scratch files.
      if (temporaryExists) removeFile(temporary);
      if (backupExists) removeFile(backup);
    }
    return { restored, requeued, removed, removedBytes };
  }

  start() {
    if (this.running || !config.recordingCompressionEnabled) return;
    this.running = true;
    this.lastBusyAt = Date.now();
    const transient = this.reconcileTransientFiles();
    db.prepare("UPDATE recording_compression_jobs SET status='queued', started_at=NULL, updated_at=? WHERE status='processing'").run(nowIso());
    const legacyRequeued = this.requeueOversizedLegacySkips();
    // Backfill must never schedule the worker itself. In 2.16.4 the first
    // enqueue() shortened the configured startup delay to roughly 250 ms and
    // allowed x264 to compete with the initial camera stream connections.
    if (config.recordingCompressionBackfill) this.backfill({ schedule: false });
    this.schedule(config.recordingCompressionStartDelayMs);
    logger.info({
      crf: config.recordingCompressionCrf,
      maxVideoBitrateKbps: config.recordingCompressionMaxVideoBitrateKbps,
      preset: config.recordingCompressionPreset,
      threads: config.recordingCompressionThreads,
      startDelayMs: config.recordingCompressionStartDelayMs,
      idleGraceMs: config.recordingCompressionIdleGraceMs,
      legacyRequeued,
      transient,
    }, 'Serielle Aufnahme-Komprimierung gestartet');
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const child = this.child;
    if (child && child.exitCode === null && !child.killed) child.kill('SIGTERM');
  }

  schedule(delayMs = config.recordingCompressionPollMs) {
    if (!this.running || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pump();
    }, Math.max(250, Number(delayMs || 0)));
    this.timer.unref?.();
  }

  requeueOversizedLegacySkips() {
    const maxVideoKbps = Number(config.recordingCompressionMaxVideoBitrateKbps || 0);
    if (maxVideoKbps <= 0) return 0;
    const rows = db.prepare(`SELECT j.id,j.file_path,s.size_bytes,s.duration_seconds
      FROM recording_compression_jobs j
      JOIN recording_segments s ON s.recording_id=j.recording_id AND s.segment_index=j.segment_index
      WHERE j.status='skipped'
        AND s.status IN ('ready','recovered')
        AND COALESCE(s.storage_state,'local') IN ('local','pending','upload_failed')
        AND COALESCE(s.size_bytes,0)>0
        AND COALESCE(s.duration_seconds,0)>0`).all();
    const audioKbps = Number(config.recordingCompressionAudioBitrateKbps || 64);
    const tolerance = 1.25;
    const now = nowIso();
    let count = 0;
    for (const row of rows) {
      const durationSeconds = Number(row.duration_seconds || 0);
      const expectedMaxBytes = durationSeconds * ((maxVideoKbps + audioKbps) * 1000 / 8) * tolerance;
      if (Number(row.size_bytes || 0) <= expectedMaxBytes) continue;
      const filePath = path.resolve(row.file_path || '');
      if (!safeRecordingPath(filePath) || !fs.existsSync(filePath)) continue;
      db.prepare(`UPDATE recording_compression_jobs SET status='queued',attempts=0,started_at=NULL,completed_at=NULL,
        updated_at=?,next_attempt_at=?,error=NULL WHERE id=?`).run(now, now, row.id);
      count += 1;
    }
    if (count) logger.info({ count, maxVideoKbps }, 'Zu grosse, zuvor uebersprungene Aufnahmebloecke wurden erneut zur Komprimierung eingereiht');
    return count;
  }

  enqueue({ recordingId, segmentIndex, filePath }, { schedule = true } = {}) {
    if (!config.recordingCompressionEnabled || !safeRecordingPath(filePath)) return false;
    const now = nowIso();
    db.prepare(`INSERT INTO recording_compression_jobs(
      recording_id,segment_index,file_path,status,attempts,created_at,updated_at,next_attempt_at
    ) VALUES(?,?,?,'queued',0,?,?,?)
    ON CONFLICT(recording_id,segment_index) DO UPDATE SET
      file_path=excluded.file_path,
      status=CASE WHEN recording_compression_jobs.status IN ('completed','skipped') THEN recording_compression_jobs.status ELSE 'queued' END,
      updated_at=excluded.updated_at,
      next_attempt_at=CASE WHEN recording_compression_jobs.status IN ('completed','skipped') THEN recording_compression_jobs.next_attempt_at ELSE excluded.next_attempt_at END,
      error=CASE WHEN recording_compression_jobs.status IN ('completed','skipped') THEN recording_compression_jobs.error ELSE NULL END`).run(
      Number(recordingId), Number(segmentIndex), path.resolve(filePath), now, now, now,
    );
    if (schedule) this.schedule(250);
    return true;
  }

  backfill({ schedule = false } = {}) {
    const rows = db.prepare(`SELECT s.recording_id,s.segment_index,s.file_path
      FROM recording_segments s
      JOIN recordings r ON r.id=s.recording_id
      LEFT JOIN recording_compression_jobs j ON j.recording_id=s.recording_id AND j.segment_index=s.segment_index
      WHERE r.status IN ('recording','ready','ready_with_gaps')
        AND s.status IN ('ready','recovered')
        AND COALESCE(s.storage_state,'local') IN ('local','pending','upload_failed')
        AND COALESCE(s.size_bytes,0)>0 AND j.id IS NULL
      ORDER BY s.finalized_at ASC, s.id ASC LIMIT ?`).all(
      config.recordingCompressionBackfillLimit,
    );
    for (const row of rows) {
      this.enqueue({ recordingId: row.recording_id, segmentIndex: row.segment_index, filePath: row.file_path }, { schedule: false });
    }
    if (schedule && rows.length) this.schedule(250);
    return rows.length;
  }

  nextJob() {
    const now = nowIso();
    return db.prepare(`SELECT j.* FROM recording_compression_jobs j
      JOIN recordings r ON r.id=j.recording_id
      JOIN recording_segments s ON s.recording_id=j.recording_id AND s.segment_index=j.segment_index
      WHERE j.status IN ('queued','retry')
        AND j.attempts<?
        AND (j.next_attempt_at IS NULL OR j.next_attempt_at<=?)
        AND r.status IN ('recording','ready','ready_with_gaps')
        AND s.status IN ('ready','recovered')
        AND COALESCE(s.storage_state,'local') IN ('local','pending','upload_failed')
      ORDER BY j.created_at ASC,j.id ASC LIMIT 1`).get(config.recordingCompressionMaxAttempts, now) || null;
  }

  criticalBusyReason() {
    if (config.recordingCompressionPauseDuringPtz) {
      const ptz = ptzAutomationInterlock.status().find((state) => state.active || state.settling);
      if (ptz) return `PTZ-Aktivitaet an Kamera ${ptz.cameraId}`;
    }
    if (config.recordingCompressionPauseDuringStreamRecovery) {
      const activity = streamOrchestrator.compressionActivity();
      if (activity.starting > 0) return `${activity.starting} Stream(s) im Aufbau`;
      if (activity.recovering > 0) return `${activity.recovering} Stream(s) in Wiederherstellung`;
      if (activity.stalled > 0) return `${activity.stalled} stillstehende Stream-Sitzung(en)`;
      if (activity.missingProcess > 0) return `${activity.missingProcess} Stream-Sitzung(en) ohne Medienprozess`;
    }
    return null;
  }

  startGuardReason() {
    const critical = this.criticalBusyReason();
    if (critical) {
      this.lastBusyAt = Date.now();
      return critical;
    }
    const loadRatio = os.loadavg()[0] / Math.max(1, os.cpus().length);
    if (Number.isFinite(loadRatio) && loadRatio > config.recordingCompressionMaxLoadRatio) {
      this.lastBusyAt = Date.now();
      return `Systemlast ${(loadRatio * 100).toFixed(0)} % ueber Grenzwert`;
    }
    const graceRemaining = Number(config.recordingCompressionIdleGraceMs || 0) - (Date.now() - this.lastBusyAt);
    if (graceRemaining > 0) return `Stabilisierungsphase (${Math.ceil(graceRemaining / 1000)} s)`;
    return null;
  }

  async pump() {
    if (!this.running || this.processing) return;
    this.processing = true;
    try {
      if (config.recordingCompressionBackfill) this.backfill({ schedule: false });
      const guard = this.startGuardReason();
      if (guard) {
        this.pauseReason = guard;
        this.schedule(config.recordingCompressionBusyDelayMs);
        return;
      }
      this.pauseReason = null;
      const job = this.nextJob();
      if (!job) return;
      await this.process(job);
    } catch (error) {
      logger.error({ err: error }, 'Aufnahme-Komprimierungsworker ist fehlgeschlagen');
    } finally {
      this.processing = false;
      if (this.running) this.schedule(config.recordingCompressionPollMs);
    }
  }

  defer(job, attempts, reason) {
    const nextAttemptAt = new Date(Date.now() + config.recordingCompressionBusyDelayMs).toISOString();
    db.prepare(`UPDATE recording_compression_jobs SET status='queued',attempts=?,started_at=NULL,updated_at=?,next_attempt_at=?,error=NULL WHERE id=?`).run(
      Math.max(0, attempts - 1), nowIso(), nextAttemptAt, job.id,
    );
    this.pauseReason = reason;
    this.lastBusyAt = Date.now();
    logger.info({ recordingId: job.recording_id, segmentIndex: job.segment_index, reason }, 'Aufnahme-Komprimierung wurde fuer Livebetrieb pausiert');
  }

  async process(job) {
    const startedAt = nowIso();
    const attempts = Number(job.attempts || 0) + 1;
    db.prepare("UPDATE recording_compression_jobs SET status='processing',attempts=?,started_at=?,updated_at=?,error=NULL WHERE id=?")
      .run(attempts, startedAt, startedAt, job.id);
    this.current = { id: job.id, recordingId: job.recording_id, segmentIndex: job.segment_index, startedAt };
    const source = path.resolve(job.file_path);
    const temporary = `${source}.compressing`;
    const backup = `${source}.compression-backup`;
    try {
      if (safeRecordingPath(source) && !fs.existsSync(source) && fs.existsSync(backup)) fs.renameSync(backup, source);
      else if (fs.existsSync(source) && fs.existsSync(backup)) fs.rmSync(backup, { force: true });
      if (!safeRecordingPath(source) || !fs.existsSync(source)) throw new Error('Aufnahmeblock fehlt oder liegt ausserhalb des Aufnahmeverzeichnisses');
      const segment = recordingRepository.segmentInternal(job.recording_id, job.segment_index);
      const recording = recordingRepository.getInternal(job.recording_id);
      if (!segment || !['ready', 'recovered'].includes(segment.status)) throw new Error('Aufnahmeblock ist nicht mehr zur Komprimierung freigegeben');
      if (!recording || !['recording', 'ready', 'ready_with_gaps'].includes(recording.status)) {
        this.defer(job, attempts, 'Aufnahme ist nicht mehr fuer die Blockkomprimierung freigegeben');
        return;
      }
      const originalBytes = fileSize(source);
      if (originalBytes < config.recordingCompressionMinBytes) {
        this.complete(job.id, { status: 'skipped', originalBytes, compressedBytes: originalBytes, savedBytes: 0, error: 'Block liegt unter der Mindestgroesse' });
        return;
      }
      const availableBytes = freeBytes(path.dirname(source));
      const requiredBytes = Number(config.recordingMinFreeBytes || 0) + originalBytes;
      if (availableBytes < requiredBytes) {
        throw new Error(`Nicht genug freier Speicher fuer die sichere Komprimierung (${availableBytes} von ${requiredBytes} Bytes verfuegbar)`);
      }
      fs.rmSync(temporary, { force: true });
      await runFfmpeg(source, temporary, {
        onChild: (child) => { this.child = child; },
        shouldDefer: () => this.running ? this.criticalBusyReason() : 'Backend wird beendet',
      });
      this.child = null;
      const compressedBytes = fileSize(temporary);
      const probe = await probeMedia(temporary, { ffprobePath: config.ffprobePath, timeoutMs: config.recordingCompressionProbeTimeoutMs });
      const assessed = assessProbe(probe, compressedBytes, { minimumBytes: config.recordingBlockMinimumBytes, fallbackDurationSeconds: Number(segment.duration_seconds || 0) });
      if (!assessed.playable) throw new Error(`Komprimiertes Ergebnis ist nicht abspielbar (${assessed.reason || 'unbekannt'})`);
      const expectedDuration = Number(segment.duration_seconds || 0);
      if (expectedDuration > 1 && assessed.durationSeconds > 0 && assessed.durationSeconds < expectedDuration * config.recordingCompressionMinDurationRatio) {
        throw new Error(`Komprimiertes Ergebnis ist unvollstaendig (${assessed.durationSeconds.toFixed(2)}s von ${expectedDuration.toFixed(2)}s)`);
      }
      const savedBytes = Math.max(0, originalBytes - compressedBytes);
      const savingsPercent = originalBytes > 0 ? (savedBytes / originalBytes) * 100 : 0;
      if (compressedBytes <= 0 || compressedBytes >= originalBytes || savingsPercent < config.recordingCompressionMinSavingsPercent) {
        fs.rmSync(temporary, { force: true });
        this.complete(job.id, { status: 'skipped', originalBytes, compressedBytes, savedBytes, error: `Ersparnis ${savingsPercent.toFixed(1)} % liegt unter dem Mindestwert` });
        return;
      }
      fs.rmSync(backup, { force: true });
      fs.renameSync(source, backup);
      try {
        fs.renameSync(temporary, source);
      } catch (error) {
        fs.renameSync(backup, source);
        throw error;
      }
      fs.rmSync(backup, { force: true });
      recordingRepository.updateSegmentAfterCompression(job.recording_id, job.segment_index, {
        sizeBytes: compressedBytes,
        durationSeconds: assessed.durationSeconds || expectedDuration,
        mediaFormat: assessed.formatName || 'mpegts',
      });
      recordingRepository.recalculateSize(job.recording_id);
      this.complete(job.id, { status: 'completed', originalBytes, compressedBytes, savedBytes, error: null });
      if (recording.camera_id) {
        cameraEventLog.append(recording.camera_id, {
          level: 'info', component: 'recording', code: 'RECORDING_BLOCK_COMPRESSED',
          message: 'Aufnahmeblock wurde im Hintergrund komprimiert',
          details: { recordingId: job.recording_id, block: job.segment_index, originalBytes, compressedBytes, savedBytes, savingsPercent: Number(savingsPercent.toFixed(1)) },
        });
      }
      logger.info({ recordingId: job.recording_id, segmentIndex: job.segment_index, originalBytes, compressedBytes, savedBytes }, 'Aufnahmeblock wurde komprimiert');
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      if (!fs.existsSync(source) && fs.existsSync(backup)) fs.renameSync(backup, source);
      else fs.rmSync(backup, { force: true });
      if (error?.code === 'RECORDING_COMPRESSION_DEFERRED') {
        this.defer(job, attempts, error.reason || error.message);
        return;
      }
      const retry = attempts < config.recordingCompressionMaxAttempts;
      const retryAt = new Date(Date.now() + Math.min(config.recordingCompressionRetryBaseMs * (2 ** Math.max(0, attempts - 1)), config.recordingCompressionRetryMaxMs)).toISOString();
      db.prepare(`UPDATE recording_compression_jobs SET status=?,updated_at=?,next_attempt_at=?,error=? WHERE id=?`).run(
        retry ? 'retry' : 'failed', nowIso(), retry ? retryAt : null, sanitizeLogText(error.message || String(error), 2000), job.id,
      );
      logger.warn({ recordingId: job.recording_id, segmentIndex: job.segment_index, attempt: attempts, err: error }, 'Aufnahmeblock konnte nicht komprimiert werden');
    } finally {
      this.child = null;
      this.current = null;
      await sleep(50);
    }
  }

  complete(id, { status, originalBytes, compressedBytes, savedBytes, error }) {
    const now = nowIso();
    db.prepare(`UPDATE recording_compression_jobs SET status=?,original_bytes=?,compressed_bytes=?,saved_bytes=?,error=?,completed_at=?,updated_at=?,next_attempt_at=NULL WHERE id=?`)
      .run(status, Number(originalBytes || 0), Number(compressedBytes || 0), Number(savedBytes || 0), error || null, now, now, id);
  }

  status() {
    const counts = db.prepare(`SELECT status,COUNT(*) AS count,SUM(saved_bytes) AS saved_bytes FROM recording_compression_jobs GROUP BY status`).all();
    return {
      enabled: config.recordingCompressionEnabled,
      maxVideoBitrateKbps: config.recordingCompressionMaxVideoBitrateKbps,
      running: this.running,
      processing: this.processing,
      current: this.current,
      pauseReason: this.pauseReason,
      streamActivity: streamOrchestrator.compressionActivity(),
      counts,
    };
  }
}

export const recordingCompressionService = new RecordingCompressionService();
