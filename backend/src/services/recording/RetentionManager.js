import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { db } from '../../db/database.js';
import { logger } from '../../utils/logger.js';
import { cameraRepository } from '../cameraRepository.js';
import { cameraEventLog } from '../CameraEventLog.js';
import { recordingRepository } from '../recordingRepository.js';
import { networkRecordingStorageService } from '../NetworkRecordingStorageService.js';
import { recordingPolicyRepository } from './RecordingPolicyRepository.js';
import { adminAlertService } from '../AdminAlertService.js';
import { planRetentionDeletion } from './RetentionPolicy.js';
import { isRecordingStoragePath } from './RecordingStoragePaths.js';

export { planRetentionDeletion } from './RetentionPolicy.js';

function diskFreeBytes(directory) {
  try {
    const stats = fs.statfsSync(directory);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch { return Number.POSITIVE_INFINITY; }
}

function localPipelineState(recordingId, legacyFilePath = null) {
  const segments = recordingRepository.segmentsInternal(recordingId);
  let localBytes = 0;
  let pipelineBusy = false;
  let remoteBacked = false;
  const seen = new Set();
  for (const segment of segments) {
    const filePath = path.resolve(segment.file_path || '');
    if (filePath && !seen.has(filePath)) {
      seen.add(filePath);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) localBytes += stat.size;
      } catch {}
    }
    if (segment.storage_profile_id && segment.remote_path) remoteBacked = true;
    if (['pending','uploading','upload_failed'].includes(String(segment.storage_state || 'local'))) pipelineBusy = true;
  }
  const compressionBusy = db.prepare(`SELECT 1 AS busy FROM recording_compression_jobs
    WHERE recording_id=? AND status IN ('queued','processing','retry') LIMIT 1`).get(recordingId);
  if (compressionBusy) pipelineBusy = true;
  if (!segments.length && legacyFilePath) {
    const resolved = path.resolve(legacyFilePath);
    try {
      const stat = fs.statSync(resolved);
      if (stat.isFile()) localBytes += stat.size;
    } catch {}
  }
  return { localBytes, pipelineBusy, remoteBacked };
}

class RetentionManager {
  constructor() {
    this.timer = null;
    this.startTimer = null;
    this.running = false;
    this.lastRunAt = null;
    this.lastCompletedAt = null;
    this.lastError = null;
    this.lastResult = null;
  }

  start() {
    if (this.timer || this.startTimer) return;
    const run = () => this.run().catch((error) => logger.error({ err: error }, 'Aufbewahrungsbereinigung fehlgeschlagen'));
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      run();
      this.timer = setInterval(run, config.retentionCleanupIntervalMs);
      this.timer.unref?.();
    }, config.retentionStartupDelayMs);
    this.startTimer.unref?.();
    logger.info({ startupDelayMs: config.retentionStartupDelayMs, intervalMs: config.retentionCleanupIntervalMs }, 'Aufbewahrungsbereinigung wurde eingeplant');
  }

  stop() {
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.timer) clearInterval(this.timer);
    this.startTimer = null;
    this.timer = null;
  }

  status() {
    return {
      running: Boolean(this.timer || this.startTimer), busy: this.running,
      intervalMs: config.retentionCleanupIntervalMs,
      lastRunAt: this.lastRunAt, lastCompletedAt: this.lastCompletedAt,
      lastError: this.lastError, lastResult: this.lastResult,
    };
  }

  async run({ cameraId = null, dryRun = false } = {}) {
    if (this.running) return { ...this.status(), skipped: 'already-running' };
    this.running = true;
    this.lastRunAt = new Date().toISOString();
    this.lastError = null;
    const result = { dryRun, cameras: 0, candidates: 0, deleted: 0, freedBytes: 0, errors: 0, items: [] };
    try {
      const cameras = cameraId ? [cameraRepository.get(cameraId)].filter(Boolean) : cameraRepository.list();
      let projectedFreeBytes = diskFreeBytes(config.recordingsDir);
      let remainingBatch = config.retentionBatchSize;
      for (const camera of cameras) {
        const policy = recordingPolicyRepository.getRetention(camera.id);
        const rows = recordingRepository.retentionRows(camera.id).map((row) => {
          const pipeline = localPipelineState(row.id, row.file_path);
          return { ...row, local_file_bytes: pipeline.localBytes, pipeline_busy: pipeline.pipelineBusy, remote_backed: pipeline.remoteBacked };
        });
        const candidates = planRetentionDeletion(rows, policy, { freeBytes: projectedFreeBytes });
        result.cameras += 1;
        result.candidates += candidates.length;
        for (const candidate of candidates.slice(0, remainingBatch)) {
          const item = { cameraId: camera.id, recordingId: candidate.id, reasons: candidate.reasons, sizeBytes: candidate.sizeBytes, localBytes: candidate.localBytes };
          if (!dryRun) {
            try {
              await this.deleteRecording(candidate.id, candidate.filePath);
              result.deleted += 1;
              result.freedBytes += candidate.localBytes;
              if (Number.isFinite(projectedFreeBytes)) projectedFreeBytes += candidate.localBytes;
            } catch (error) {
              result.errors += 1;
              item.error = 'Löschen fehlgeschlagen';
              logger.error({ cameraId: camera.id, recordingId: candidate.id, err: error }, 'Aufnahme konnte durch Aufbewahrungsregel nicht gelöscht werden');
            }
          } else if (Number.isFinite(projectedFreeBytes)) {
            projectedFreeBytes += candidate.localBytes;
          }
          result.items.push(item);
          remainingBatch = Math.max(0, remainingBatch - 1);
        }
        if (candidates.length) cameraEventLog.append(camera.id, {
          level: result.errors ? 'warn' : 'info', component: 'retention', code: dryRun ? 'RETENTION_DRY_RUN' : 'RETENTION_CLEANUP',
          message: dryRun ? 'Aufbewahrungsregeln wurden simuliert' : 'Aufbewahrungsregeln wurden angewendet',
          details: { candidates: candidates.length, processed: result.items.filter((item) => item.cameraId === camera.id).length, deleted: dryRun ? 0 : result.items.filter((item) => item.cameraId === camera.id && !item.error).length },
        });
        if (remainingBatch <= 0) break;
      }
      this.lastCompletedAt = new Date().toISOString();
      this.lastResult = { ...result, items: result.items.slice(0, 100) };
      if (result.errors) adminAlertService.notify({
        level: 'error', code: 'RETENTION_CLEANUP_ERRORS', message: 'Einige Aufnahmen konnten nicht automatisch bereinigt werden.',
        details: { errors: result.errors, deleted: result.deleted },
      }).catch(() => {});
      logger.info({ ...result, items: undefined }, 'Aufbewahrungsbereinigung abgeschlossen');
      return result;
    } catch (error) {
      this.lastError = 'Aufbewahrungsbereinigung konnte nicht abgeschlossen werden.';
      throw error;
    } finally {
      this.running = false;
    }
  }

  async deleteRecording(id, filePath) {
    const segments = recordingRepository.segmentsInternal(id);
    for (const segment of segments) {
      if (segment.storage_profile_id && segment.remote_path) {
        // Keep the database record when the NAS/server is temporarily offline.
        // Retention will retry on the next run instead of orphaning a remote file.
        await networkRecordingStorageService.deleteRemoteSegment(segment);
      }
    }
    const files = [filePath, ...segments.map((segment) => segment.file_path)];
    for (const file of files) {
      const resolved = path.resolve(file || '');
      if (!isRecordingStoragePath(resolved, { allowRoot: false })) throw new Error('Aufnahmepfad liegt außerhalb des Archivverzeichnisses');
      try {
        const stat = fs.statSync(resolved);
        fs.rmSync(resolved, { force: true, recursive: stat.isDirectory() });
      } catch {
        fs.rmSync(resolved, { force: true });
      }
    }
    recordingRepository.remove(id);
  }
}

export const retentionManager = new RetentionManager();
