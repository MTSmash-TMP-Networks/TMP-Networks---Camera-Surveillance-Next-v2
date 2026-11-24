import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { cameraRepository } from '../cameraRepository.js';
import { cameraEventLog } from '../CameraEventLog.js';
import { recordingRepository } from '../recordingRepository.js';
import { networkRecordingStorageService } from '../NetworkRecordingStorageService.js';
import { AppError } from '../../utils/errors.js';
import { safePathPart } from '../../utils/url.js';
import { logger } from '../../utils/logger.js';
import { prepareEvidenceMp4 } from './EvidenceMp4.js';
import { describeZipEntry, writeStoredZipStream } from './ZipStoreWriter.js';
import { isRecordingStoragePath } from './RecordingStoragePaths.js';

const READY_STATUSES = new Set(['ready', 'ready_with_gaps', 'recording']);
const PLAYABLE_SEGMENT_STATUSES = new Set(['ready', 'recovered']);

function segmentStorageAvailable(segment) {
  if (!segment) return false;
  if (isRecordingPath(segment.file_path) && fs.existsSync(segment.file_path)) return true;
  return Boolean(segment.storage_profile_id && segment.remote_path && ['remote','pending','uploading','upload_failed'].includes(String(segment.storage_state || '')));
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function datePartsInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(hour), minute: Number(parts.minute), second: Number(parts.second),
  };
}

function localDateTimeToDate(dateText, timeText, timeZone) {
  const [year, month, day] = dateText.split('-').map(Number);
  const [hour, minute] = timeText.split(':').map(Number);
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = datePartsInTimeZone(guess, timeZone);
    const wantedUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const diff = actualUtc - wantedUtc;
    if (Math.abs(diff) < 1000) return guess;
    guess = new Date(guess.getTime() - diff);
  }
  return guess;
}

function nextIsoDate(dateText) {
  const [year, month, day] = String(dateText).split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

function dayWindow(dateText, timeZone) {
  const startDate = localDateTimeToDate(dateText, '00:00', timeZone);
  const endDate = localDateTimeToDate(nextIsoDate(dateText), '00:00', timeZone);
  return { startDate, endDate, startIso: startDate.toISOString(), endIso: endDate.toISOString() };
}

function displayDate(date, timeZone) {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
}

function isRecordingPath(filePath) {
  return isRecordingStoragePath(filePath);
}

function sanitizeFilename(value) {
  return safePathPart(String(value || 'export')).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 90) || 'export';
}

function segmentDates(recording, segment, fallbackCursorMs) {
  const durationMs = Math.max(0, safeNumber(segment.duration_seconds) * 1000);
  let startMs = Date.parse(segment.started_at || '');
  if (!Number.isFinite(startMs)) startMs = fallbackCursorMs;
  let endMs = Date.parse(segment.ended_at || '');
  if (!Number.isFinite(endMs) || endMs <= startMs) endMs = startMs + durationMs;
  if (!Number.isFinite(endMs) || endMs <= startMs) endMs = Date.parse(recording.endedAt || recording.ended_at || '') || startMs;
  return { startMs, endMs: Math.max(startMs, endMs) };
}

function overlaps(startMs, endMs, windowStartMs, windowEndMs) {
  return startMs < windowEndMs && Math.max(endMs, startMs + 1) > windowStartMs;
}

function buildSegmentExportName(recording, segment) {
  const sourceBase = path.basename(segment.file_path || `block-${segment.segment_index}.ts`).replace(/[^a-zA-Z0-9._-]+/g, '_');
  return `segments/recording-${recording.id}/block-${String(segment.segment_index).padStart(6, '0')}-${sourceBase.replace(/\.partial$|\.damaged$/g, '')}`;
}

class RecordingEvidenceExportService {
  constructor() {
    this.exportDir = path.join(config.recordingsDir, '_exports');
    this.jobs = new Map();
    this.activeWorkDirs = new Set();
    this.activeBuilds = 0;
    const timer = setInterval(() => {
      this.expireJobs();
      void this.cleanupOldExports();
    }, 60_000);
    timer.unref();
  }

  normalizeWindow(input) {
    const timezone = input.timezone || 'Europe/Berlin';
    // 24:00 is the exclusive next-day midnight, including both DST transition
    // days (23h in spring, 25h in autumn). 23:59 would silently omit a minute.
    const startDate = localDateTimeToDate(input.date, input.startTime, timezone);
    const endDate = input.endTime === '24:00'
      ? dayWindow(input.date, timezone).endDate
      : localDateTimeToDate(input.date, input.endTime, timezone);
    if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) throw new AppError(400, 'EXPORT_INVALID_START', 'Startzeit ist ungültig');
    if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) throw new AppError(400, 'EXPORT_INVALID_END', 'Endzeit ist ungültig');
    if (endDate <= startDate) throw new AppError(400, 'EXPORT_INVALID_RANGE', 'Die Endzeit muss nach der Startzeit liegen. Tagesübergreifende Exporte bitte als getrennte Exporte erstellen.');
    // A civil day may contain 25 hours when clocks move backwards.
    const maxHours = Number(input.maxHours || (input.endTime === '24:00' ? 26 : 24));
    if (endDate.getTime() - startDate.getTime() > maxHours * 3600 * 1000) throw new AppError(400, 'EXPORT_RANGE_TOO_LARGE', `Der Export darf maximal ${maxHours} Stunden umfassen.`);
    return { timezone, startDate, endDate, startIso: startDate.toISOString(), endIso: endDate.toISOString() };
  }

  select(input) {
    const window = this.normalizeWindow(input);
    const camera = cameraRepository.get(input.cameraId);
    if (!camera) throw new AppError(404, 'CAMERA_NOT_FOUND', 'Kamera nicht gefunden');
    const recordings = recordingRepository.exportCandidates({ cameraId: input.cameraId, startedBefore: window.endIso, endedAfter: window.startIso });
    const startMs = window.startDate.getTime();
    const endMs = window.endDate.getTime();
    const selected = [];
    let totalBytes = 0;
    let totalMediaSeconds = 0;
    let cursorMs = startMs;

    for (const recording of recordings) {
      if (!READY_STATUSES.has(recording.status)) continue;
      const segments = recordingRepository.segmentsInternal(recording.id)
        .filter((segment) => PLAYABLE_SEGMENT_STATUSES.has(segment.status) && safeNumber(segment.size_bytes) > 0 && segmentStorageAvailable(segment))
        .sort((left, right) => Number(left.segment_index) - Number(right.segment_index));
      const blocks = [];
      cursorMs = Math.max(Date.parse(recording.startedAt || recording.started_at || '') || startMs, startMs);
      for (const segment of segments) {
        const dates = segmentDates(recording, segment, cursorMs);
        cursorMs = Math.max(dates.endMs + safeNumber(segment.gap_seconds) * 1000, cursorMs);
        if (!overlaps(dates.startMs, dates.endMs, startMs, endMs)) continue;
        const exportName = buildSegmentExportName(recording, segment);
        blocks.push({
          id: segment.id,
          recordingId: recording.id,
          segmentIndex: Number(segment.segment_index),
          sourcePath: isRecordingPath(segment.file_path) && fs.existsSync(segment.file_path) ? path.resolve(segment.file_path) : null,
          exportName,
          startedAt: new Date(dates.startMs).toISOString(),
          endedAt: new Date(dates.endMs).toISOString(),
          durationSeconds: safeNumber(segment.duration_seconds),
          sizeBytes: safeNumber(segment.size_bytes),
          gapSeconds: safeNumber(segment.gap_seconds),
          discontinuity: Boolean(segment.is_discontinuity),
          status: segment.status,
          mediaFormat: segment.media_format || 'mpegts',
        });
      }
      if (blocks.length) {
        selected.push({ recording, blocks });
        totalBytes += blocks.reduce((sum, block) => sum + block.sizeBytes, 0);
        totalMediaSeconds += blocks.reduce((sum, block) => sum + block.durationSeconds, 0);
      }
    }
    const blockCount = selected.reduce((sum, item) => sum + item.blocks.length, 0);
    return {
      camera,
      timezone: window.timezone,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      startIso: window.startIso,
      endIso: window.endIso,
      startLocal: displayDate(window.startDate, window.timezone),
      endLocal: displayDate(window.endDate, window.timezone),
      recordingCount: selected.length,
      blockCount,
      fileSizeBytes: totalBytes,
      mediaDurationSeconds: Number(totalMediaSeconds.toFixed(3)),
      selected,
    };
  }

  timeline(input = {}) {
    const timezone = input.timezone || 'Europe/Berlin';
    const window = dayWindow(input.date, timezone);
    const sourceCameras = input.cameraId ? [cameraRepository.get(input.cameraId)].filter(Boolean) : cameraRepository.list();
    if (input.cameraId && !sourceCameras.length) throw new AppError(404, 'CAMERA_NOT_FOUND', 'Kamera nicht gefunden');
    const cameras = sourceCameras.map((camera) => {
      const recordings = recordingRepository.exportCandidates({ cameraId: camera.id, startedBefore: window.endIso, endedAfter: window.startIso });
      const rawBlocks = [];
      let cursorMs = window.startDate.getTime();
      for (const recording of recordings) {
        if (!READY_STATUSES.has(recording.status)) continue;
        const segments = recordingRepository.segmentsInternal(recording.id)
          .filter((segment) => PLAYABLE_SEGMENT_STATUSES.has(segment.status) && safeNumber(segment.size_bytes) > 0)
          .sort((left, right) => Number(left.segment_index) - Number(right.segment_index));
        cursorMs = Math.max(Date.parse(recording.startedAt || recording.started_at || '') || window.startDate.getTime(), window.startDate.getTime());
        let mediaCursorSeconds = 0;
        for (const segment of segments) {
          const dates = segmentDates(recording, segment, cursorMs);
          const segmentDurationSeconds = Math.max(0, safeNumber(segment.duration_seconds));
          const wallDurationMs = Math.max(1, dates.endMs - dates.startMs);
          cursorMs = Math.max(dates.endMs + safeNumber(segment.gap_seconds) * 1000, cursorMs);
          if (!segmentStorageAvailable(segment) || !overlaps(dates.startMs, dates.endMs, window.startDate.getTime(), window.endDate.getTime())) {
            mediaCursorSeconds += segmentDurationSeconds;
            continue;
          }
          const clippedStartMs = Math.max(dates.startMs, window.startDate.getTime());
          const clippedEndMs = Math.min(dates.endMs, window.endDate.getTime());
          const mediaStartSeconds = mediaCursorSeconds + (((clippedStartMs - dates.startMs) / wallDurationMs) * segmentDurationSeconds);
          const mediaEndSeconds = mediaCursorSeconds + (((clippedEndMs - dates.startMs) / wallDurationMs) * segmentDurationSeconds);
          rawBlocks.push({
            recordingId: recording.id,
            startMs: clippedStartMs,
            endMs: clippedEndMs,
            mediaStartSeconds,
            mediaEndSeconds,
            blockCount: 1,
            fileSizeBytes: safeNumber(segment.size_bytes),
            mediaDurationSeconds: segmentDurationSeconds,
            gapSeconds: safeNumber(segment.gap_seconds),
            interruptions: Number(recording.interruptions || 0),
            status: recording.status,
          });
          mediaCursorSeconds += segmentDurationSeconds;
        }
      }
      rawBlocks.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
      const intervals = [];
      for (const block of rawBlocks) {
        const last = intervals.at(-1);
        if (last && block.startMs <= last.endMs + 60_000) {
          last.endMs = Math.max(last.endMs, block.endMs);
          last.blockCount += block.blockCount;
          last.recordingIds.add(block.recordingId);
          last.fileSizeBytes += block.fileSizeBytes;
          last.mediaDurationSeconds += block.mediaDurationSeconds;
          last.gapSeconds += block.gapSeconds;
          last.interruptions += block.interruptions;
          if (block.status === 'ready_with_gaps') last.hasGaps = true;
        } else {
          intervals.push({
            startMs: block.startMs,
            endMs: block.endMs,
            blockCount: block.blockCount,
            recordingIds: new Set([block.recordingId]),
            fileSizeBytes: block.fileSizeBytes,
            mediaDurationSeconds: block.mediaDurationSeconds,
            gapSeconds: block.gapSeconds,
            interruptions: block.interruptions,
            hasGaps: block.status === 'ready_with_gaps',
          });
        }
      }
      return {
        camera: { id: camera.id, name: camera.name, ip: camera.onvif?.ip || null },
        empty: intervals.length === 0,
        playbackBlocks: rawBlocks.map((block) => ({
          recordingId: block.recordingId,
          startIso: new Date(block.startMs).toISOString(),
          endIso: new Date(block.endMs).toISOString(),
          mediaStartSeconds: Number(block.mediaStartSeconds.toFixed(3)),
          mediaEndSeconds: Number(block.mediaEndSeconds.toFixed(3)),
        })),
        intervals: intervals.map((interval) => ({
          startIso: new Date(interval.startMs).toISOString(),
          endIso: new Date(interval.endMs).toISOString(),
          startLocal: displayDate(new Date(interval.startMs), timezone),
          endLocal: displayDate(new Date(interval.endMs), timezone),
          startTime: new Intl.DateTimeFormat('de-DE', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(interval.startMs)),
          endTime: new Intl.DateTimeFormat('de-DE', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(interval.endMs)),
          recordingIds: Array.from(interval.recordingIds),
          recordingCount: interval.recordingIds.size,
          blockCount: interval.blockCount,
          mediaDurationSeconds: Number(interval.mediaDurationSeconds.toFixed(3)),
          fileSizeBytes: interval.fileSizeBytes,
          gapSeconds: Number(interval.gapSeconds.toFixed(3)),
          interruptions: interval.interruptions,
          hasGaps: interval.hasGaps || interval.gapSeconds > 0,
          isRecording: Array.from(interval.recordingIds).some((id) => rawBlocks.some((block) => block.recordingId === id && block.status === 'recording')),
        })),
      };
    });
    return {
      date: input.date,
      timezone,
      startIso: window.startIso,
      endIso: window.endIso,
      cameras,
      totalIntervals: cameras.reduce((sum, item) => sum + item.intervals.length, 0),
      totalBlocks: cameras.reduce((sum, item) => sum + item.intervals.reduce((inner, interval) => inner + interval.blockCount, 0), 0),
    };
  }

  preview(input) {
    const selection = this.select(input);
    return {
      camera: { id: selection.camera.id, name: selection.camera.name, ip: selection.camera.onvif?.ip || null },
      date: selection.date,
      timezone: selection.timezone,
      startIso: selection.startIso,
      endIso: selection.endIso,
      startLocal: selection.startLocal,
      endLocal: selection.endLocal,
      recordingCount: selection.recordingCount,
      blockCount: selection.blockCount,
      fileSizeBytes: selection.fileSizeBytes,
      mediaDurationSeconds: selection.mediaDurationSeconds,
      empty: selection.blockCount === 0,
    };
  }

  async cleanupOldExports(maxAgeMs = 6 * 3600 * 1000) {
    try {
      await fs.promises.mkdir(this.exportDir, { recursive: true, mode: 0o750 });
      const now = Date.now();
      const entries = await fs.promises.readdir(this.exportDir, { withFileTypes: true });
      await Promise.all(entries.filter((entry) => (entry.isFile() && entry.name.endsWith('.zip')) || (entry.isDirectory() && entry.name.startsWith('mp4-'))).map(async (entry) => {
        const filePath = path.join(this.exportDir, entry.name);
        const stat = await fs.promises.stat(filePath);
        if (!this.activeWorkDirs.has(filePath) && now - stat.mtimeMs > maxAgeMs) await fs.promises.rm(filePath, { force: true, recursive: entry.isDirectory() });
      }));
    } catch (error) {
      logger.warn({ err: error }, 'Alte Exportdateien konnten nicht bereinigt werden');
    }
  }

  // Stage only the finished MP4 for native downloads. Source files are not modified.
  async preparePackage(input, { requestedBy = 'user', signal, selection = this.select(input) } = {}) {
    if (!selection.blockCount) throw new AppError(404, 'EXPORT_NO_RECORDINGS', 'Keine abspielbaren Aufnahmebloecke vorhanden.');
    if (this.activeBuilds >= 2) throw new AppError(429, 'EXPORT_STREAM_BUSY', 'Es laufen bereits zwei MP4-Exporte.');
    this.activeBuilds++;
    let workDir;
    try {
      await this.cleanupOldExports();
      signal?.throwIfAborted();
      workDir = await fs.promises.mkdtemp(path.join(this.exportDir, 'mp4-'));
      this.activeWorkDirs.add(workDir);
      const exportId = crypto.randomUUID();
      const generatedAt = new Date().toISOString();
      const blocks = selection.selected.flatMap((item) => item.blocks)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.recordingId - b.recordingId || a.segmentIndex - b.segmentIndex);
      const result = await prepareEvidenceMp4({
        blocks, workDir, signal, ffmpegPath: config.ffmpegPath, ffprobePath: config.ffprobePath,
        resolveBlock: async (block) => {
          if (block.sourcePath && fs.existsSync(block.sourcePath)) return block.sourcePath;
          const segment = recordingRepository.segmentInternal(block.recordingId, block.segmentIndex);
          if (!segment) throw new AppError(404, 'RECORDING_BLOCK_MISSING', 'Ein Aufnahmeblock fehlt.');
          return (await networkRecordingStorageService.materializeSegment(segment)).path;
        },
      });
      signal?.throwIfAborted();
      const video = await describeZipEntry({ name: 'export.mp4', filePath: result.filePath, signal });
      signal?.throwIfAborted();
      const manifest = {
        schema: 2, product: 'tmp-camera-surveillance-next', exportType: 'recording_evidence_package',
        exportId, generatedAt, generatedBy: requestedBy,
        camera: { id: selection.camera.id, name: selection.camera.name,
          ip: selection.camera.onvif?.ip || null, location: selection.camera.location || '' },
        requestedWindow: { date: selection.date, startTime: selection.startTime,
          endTime: selection.endTime, timezone: selection.timezone,
          startIso: selection.startIso, endIso: selection.endIso,
          startLocal: selection.startLocal, endLocal: selection.endLocal },
        caseReference: input.caseReference || null, notes: input.notes || null,
        exportMode: 'mp4_block_exact_overlap',
        exportNote: 'Abgeleitete MP4 aus abgeschlossenen Originalbloecken. Keine Neucodierung des Videobilds. Nicht-AAC-Ton kann in AAC umgewandelt werden. Aufnahmeunterbrechungen werden nicht mit kuenstlichem Material aufgefuellt. Randbloecke koennen ausserhalb des angeforderten Zeitfensters liegen.',
        totals: { recordings: selection.recordingCount, blocks: selection.blockCount,
          mediaDurationSeconds: result.durationSeconds, mediaBytes: video.size,
          sourceMediaBytes: selection.fileSizeBytes },
        video: { exportedAs: video.name, durationSeconds: result.durationSeconds,
          sizeBytes: video.size, sha256: video.sha256, crc32: video.crc32.toString(16).padStart(8, '0'),
          videoCodec: result.videoCodec, audioCodec: result.audioCodec, videoTranscoded: false },
        sources: result.sources.map(({ recordingId, segmentIndex, startedAt, endedAt,
          durationSeconds, sizeBytes, gapSeconds, discontinuity, status, playbackStartSeconds,
          playbackDurationSeconds }) => ({
          recordingId, segmentIndex, startedAt, endedAt, durationSeconds, sizeBytes,
          gapSeconds, discontinuity, status, playbackStartSeconds, playbackDurationSeconds,
        })),
      };
      const report = [
        'TMP Camera Evidence Export', '==========================',
        'Export-ID: ' + exportId, 'Erstellt am: ' + generatedAt,
        'Kamera: ' + selection.camera.name, 'Zeitraum: ' + selection.startLocal + ' bis ' + selection.endLocal + ' (' + selection.timezone + ')',
        input.caseReference ? 'Aktenzeichen: ' + input.caseReference : '',
        input.notes ? 'Hinweis: ' + input.notes : '',
        'Aufnahmebloecke: ' + selection.blockCount,
        'MP4-Dauer: ' + result.durationSeconds.toFixed(3) + ' Sekunden',
        '', 'Wiedergabe: ZIP entpacken und export.mp4 in VLC oder einem kompatiblen Player oeffnen.',
        'SHA-256 der export.mp4: ' + video.sha256,
        'CRC32: ' + manifest.video.crc32,
        'Die Originalaufnahmen auf dem Server wurden nicht veraendert.',
        manifest.exportNote, 'Original-Zeitangaben und MP4-Positionen stehen in manifest.json.', '',
      ].join('\n');
      const baseName = sanitizeFilename(selection.camera.name) + '_' + selection.date + '_' +
        selection.startTime.replace(':', '') + '-' + selection.endTime.replace(':', '') + '_evidence';
      return { workDir, exportId, filename: baseName + '_' + exportId.slice(0, 8) + '.zip',
        selection, entries: [{ name: 'README.txt', buffer: report },
          { name: 'manifest.json', buffer: JSON.stringify(manifest, null, 2) + '\n' }, video] };
    } catch (error) {
      if (workDir) await this.disposePackage({ workDir });
      if (error instanceof AppError) throw error;
      logger.warn({ err: error }, 'MP4-Export fehlgeschlagen');
      throw new AppError(422, error.code && /^EXPORT_/.test(error.code) ? error.code : 'EXPORT_MP4_FAILED',
        error.code && /^EXPORT_/.test(error.code) ? error.message : 'MP4 konnte nicht vollstaendig erstellt werden.');
    } finally { this.activeBuilds--; }
  }

  async disposePackage(pkg) {
    if (!pkg?.workDir) return;
    try { await fs.promises.rm(pkg.workDir, { recursive: true, force: true }); }
    catch (error) { logger.warn({ err: error }, 'MP4-Exportdateien konnten nicht geloescht werden'); }
    finally { this.activeWorkDirs.delete(pkg.workDir); }
  }

  expireJobs() {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (job.expiresAt > now) continue;
      this.jobs.delete(id);
      job.controller.abort();
      if (job.pkg) void this.disposePackage(job.pkg);
    }
  }

  startJob(input, session) {
    this.expireJobs();
    if (this.jobs.size >= 32 || [...this.jobs.values()].filter((job) => ['creating', 'ready'].includes(job.state)).length >= 2) {
      throw new AppError(429, 'EXPORT_STREAM_BUSY', 'Es laufen bereits zwei MP4-Exporte. Bitte spaeter erneut versuchen.');
    }
    const selection = this.select(input);
    if (!selection.blockCount) throw new AppError(404, 'EXPORT_NO_RECORDINGS', 'Keine Aufnahmebloecke im gewaehlten Zeitraum gefunden.');
    const id = crypto.randomUUID();
    const job = { input, requestedBy: session.sub, version: session.ver, state: 'creating',
      controller: new AbortController(), expiresAt: Date.now() + 2 * 3600_000 };
    this.jobs.set(id, job);
    void this.preparePackage(input, { selection, requestedBy: job.requestedBy, signal: job.controller.signal })
      .then(async (pkg) => {
        if (this.jobs.get(id) !== job || job.controller.signal.aborted) {
          await this.disposePackage(pkg);
          return;
        }
        job.pkg = pkg;
        job.state = 'ready';
        job.expiresAt = Date.now() + 30 * 60_000;
      })
      .catch((error) => {
        job.state = 'failed';
        job.error = error;
        job.expiresAt = Date.now() + 5 * 60_000;
      });
    return { jobId: id, status: 'creating' };
  }

  jobStatus(id, session, issueTicket) {
    this.expireJobs();
    const job = this.jobs.get(id);
    if (!job || job.requestedBy !== session.sub || job.version !== session.ver) {
      throw new AppError(404, 'EXPORT_TICKET_EXPIRED', 'Exportfreigabe nicht gefunden oder abgelaufen.');
    }
    if (job.state === 'failed') throw job.error;
    if (job.state !== 'ready') return { jobId: id, status: 'creating' };
    if (!job.ticket || job.ticketUntil <= Date.now()) {
      job.ticket = issueTicket({ ...job.input, jobId: id }, session);
      job.ticketUntil = Date.now() + 290_000;
    }
    return { jobId: id, status: 'ready', ...job.ticket };
  }

  claimJob(id, requestedBy) {
    this.expireJobs();
    const job = this.jobs.get(id);
    if (!job || job.requestedBy !== requestedBy || job.state !== 'ready') {
      throw new AppError(404, 'EXPORT_TICKET_EXPIRED', 'Der vorbereitete MP4-Export ist nicht mehr verfuegbar.');
    }
    this.jobs.delete(id);
    return job.pkg;
  }

  async create(input, { requestedBy = 'user', signal } = {}) {
    const pkg = await this.preparePackage(input, { requestedBy, signal });
    const zipPath = path.join(this.exportDir, pkg.filename);
    let output;
    try {
      const disk = await fs.promises.statfs(this.exportDir);
      const video = pkg.entries.find((entry) => entry.name === 'export.mp4');
      if (disk.bavail * disk.bsize < video.size + 512 * 1024 * 1024) {
        throw new AppError(422, 'EXPORT_DISK_SPACE', 'Nicht genug freier Speicher fuer die ZIP-Erstellung.');
      }
      output = fs.createWriteStream(zipPath, { flags: 'wx', mode: 0o600, signal });
      output.on('error', () => {});
      const zip = await writeStoredZipStream(pkg.entries, output, { signal });
      this.logExport(pkg, zip);
      return { ...zip, exportId: pkg.exportId, filename: pkg.filename, zipPath };
    } catch (error) {
      output?.destroy();
      await fs.promises.rm(zipPath, { force: true }).catch(() => {});
      throw error;
    } finally { await this.disposePackage(pkg); }
  }

  async stream(input, output, { requestedBy = 'user', signal } = {}) {
    const pkg = input.jobId ? this.claimJob(input.jobId, requestedBy) :
      await this.preparePackage(input, { requestedBy, signal });
    try {
      signal?.throwIfAborted();
      output.flushHeaders?.();
      const zip = await writeStoredZipStream(pkg.entries, output, { signal });
      this.logExport(pkg, zip);
      return { ...zip, exportId: pkg.exportId, filename: pkg.filename };
    } finally { await this.disposePackage(pkg); }
  }

  logExport(pkg, zip) {
    try {
      cameraEventLog.append(pkg.selection.camera.id, {
        level: 'info', component: 'recording', code: 'RECORDING_EVIDENCE_EXPORT_CREATED',
        message: 'Behoerdenexport mit MP4 erstellt',
        details: { exportId: pkg.exportId, blocks: pkg.selection.blockCount, bytes: zip.sizeBytes },
      });
    } catch (error) { logger.warn({ err: error }, 'MP4-Exportprotokoll konnte nicht gespeichert werden'); }
  }
}

export const recordingEvidenceExportService = new RecordingEvidenceExportService();
