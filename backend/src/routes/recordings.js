import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordingService } from '../services/RecordingService.js';
import { recordingEvidenceExportService } from '../services/recording/RecordingEvidenceExport.js';
import { recordingPolicyRepository } from '../services/recording/RecordingPolicyRepository.js';
import { recordingScheduler } from '../services/recording/RecordingScheduler.js';
import { recordingEventDispatcher } from '../services/recording/RecordingEventDispatcher.js';
import { motionDetectionService } from '../services/recording/MotionDetectionService.js';
import { retentionManager } from '../services/recording/RetentionManager.js';
import { recordingCompressionService } from '../services/recording/RecordingCompressionService.js';
import { evaluateRecordingPlans } from '../services/recording/RecordingSchedule.js';
import { cameraRepository } from '../services/cameraRepository.js';
import { authService } from '../services/authService.js';
import { config } from '../config.js';
import { AppError } from '../utils/errors.js';

export const recordingsRouter = Router();

function requireCamera(cameraId) {
  const camera = cameraRepository.get(cameraId);
  if (!camera) throw new AppError(404, 'CAMERA_NOT_FOUND', 'Kamera nicht gefunden');
  return camera;
}

function fileAuthorization(req, _res, next) {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
    if (queryToken) {
      authService.verifyMediaToken(queryToken, { path: `recording:${id}`, action: 'read' });
      return next();
    }
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) throw new AppError(401, 'AUTH_REQUIRED', 'Anmeldung erforderlich');
    authService.verifyAccessToken(header.slice(7));
    return next();
  } catch (error) { return next(error); }
}

async function streamArchiveFiles(res, files) {
  for (const file of files) {
    const input = fs.createReadStream(file);
    for await (const chunk of input) {
      if (!res.write(chunk)) await new Promise((resolve) => res.once('drain', resolve));
    }
  }
  res.end();
}

recordingsRouter.get('/:id/playlist.m3u8', fileAuthorization, (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const playlist = recordingService.playlist(id, token);
  if (!playlist) throw new AppError(409, 'RECORDING_LEGACY_FILE', 'Diese ältere Aufnahme besitzt keine Blockplaylist');
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosn', 'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8' });
  res.send(playlist);
});

recordingsRouter.get('/:id/blocks/:segmentIndex/file', fileAuthorization, asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const segmentIndex = z.coerce.number().int().positive().parse(req.params.segmentIndex);
  const block = await recordingService.blockFile(id, segmentIndex);
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosn', 'Accept-Ranges': 'bytes' });
  res.type(block.mediaFormat === 'mpegts' ? 'video/mp2t' : path.extname(block.filename));
  res.sendFile(block.path);
}));

recordingsRouter.get('/:id/file', fileAuthorization, asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const archive = await recordingService.exportFiles(id);
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosn', 'Content-Type': archive.contentType });
  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(archive.filename)}`);
  }
  if (archive.legacy && archive.files.length === 1) return res.sendFile(archive.files[0]);
  res.setHeader('Content-Length', String(archive.files.reduce((sum, file) => sum + fs.statSync(file).size, 0)));
  await streamArchiveFiles(res, archive.files);
  return undefined;
}));

recordingsRouter.use(authenticate);

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function isValidTimeZone(value) {
  try {
    new Intl.DateTimeFormat('de-DE', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidIsoDate, 'Ungültiges Kalenderdatum.');
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const timezone = z.string().trim().min(1).max(100).refine(isValidTimeZone, 'Unbekannte IANA-Zeitzone.');
const planSchema = z.object({
  id: z.string().max(100).optional().nullable(),
  name: z.string().trim().min(1).max(160),
  mode: z.enum(['continuous', 'event', 'scheduled']),
  enabled: z.boolean().default(true),
  timezone: timezone.default('Europe/Berlin'),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([0, 1, 2, 3, 4, 5, 6]),
  startTime: time.default('00:00'),
  endTime: time.default('23:59'),
  validFrom: date.optional().nullable(),
  validUntil: date.optional().nullable(),
  includeDates: z.array(date).max(366).default([]),
  excludeDates: z.array(date).max(366).default([]),
  holidayPolicy: z.enum(['include', 'exclude', 'only']).default('include'),
  holidayDates: z.array(date).max(366).default([]),
  eventTypes: z.array(z.string().trim().min(1).max(80)).max(50).default(['motion', 'sensor']),
  prebufferSeconds: z.coerce.number().int().min(0).max(config.recordingPrebufferMaxSeconds).default(0),
  postbufferSeconds: z.coerce.number().int().min(0).max(3600).default(10),
  priority: z.coerce.number().int().min(0).max(10000).default(100),
  quality: z.enum(['high', 'balanced', 'low']).default('balanced'),
  profileToken: z.string().max(300).optional().nullable(),
}).superRefine((value, context) => {
  if (value.validFrom && value.validUntil && value.validUntil < value.validFrom) {
    context.addIssue({ code: 'custom', path: ['validUntil'], message: 'Das Enddatum darf nicht vor dem Startdatum liegen.' });
  }
  if (value.mode !== 'continuous' && value.weekdays.length === 0 && value.includeDates.length === 0) {
    context.addIssue({ code: 'custom', path: ['weekdays'], message: 'Mindestens ein Wochentag oder ein Einschlusstag ist erforderlich.' });
  }
  if (value.mode === 'event' && value.eventTypes.length === 0) {
    context.addIssue({ code: 'custom', path: ['eventTypes'], message: 'Mindestens ein Ereignistyp ist erforderlich.' });
  }
  const excludedIncludes = value.includeDates.filter((entry) => value.excludeDates.includes(entry));
  if (excludedIncludes.length) {
    context.addIssue({ code: 'custom', path: ['excludeDates'], message: 'Ein Datum darf nicht gleichzeitig eingeschlossen und ausgeschlossen werden.' });
  }
  if (value.holidayPolicy === 'only' && value.holidayDates.length === 0) {
    context.addIssue({ code: 'custom', path: ['holidayDates'], message: 'Für „Nur Feiertage“ ist mindestens ein Feiertag erforderlich.' });
  }
});


const safeInteger = (min, max, fallback = min) => z.preprocess((value) => {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}, z.number().int().min(min).max(max));

const retentionSchema = z.object({
  strategy: z.enum(['none', 'age', 'quota', 'hybrid']),
  cleanupEnabled: z.boolean(),
  maxAgeDays: safeInteger(0, 3650, 0),
  eventMaxAgeDays: safeInteger(0, 3650, 0),
  maxStorageBytes: safeInteger(0, Number.MAX_SAFE_INTEGER, 0),
  minFreeBytes: safeInteger(0, Number.MAX_SAFE_INTEGER, 0),
  maxRecordings: safeInteger(0, 10_000_000, 0),
  protectEventRecordings: z.boolean(),
  blockSeconds: safeInteger(30, 3600, config.recordingBlockSeconds).optional(),
});

const eventSchema = z.object({
  cameraId: z.string().min(1).max(160),
  id: z.string().max(100).optional(),
  type: z.string().trim().min(1).max(80).default('motion'),
  source: z.string().trim().min(1).max(120).default('api'),
  state: z.enum(['start', 'pulse', 'stop']).default('pulse'),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  durationSeconds: z.coerce.number().int().min(0).max(86400).default(10),
  severity: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

const listSchema = z.object({
  cameraId: z.string().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
const startSchema = z.object({
  cameraId: z.string().min(1).max(160),
  profileToken: z.string().max(300).optional().nullable(),
  quality: z.enum(['high', 'balanced', 'low']).default('balanced'),
});

const evidenceExportSchema = z.object({
  cameraId: z.string().min(1).max(160),
  date: date,
  startTime: time,
  endTime: time,
  timezone: timezone.default('Europe/Berlin'),
  caseReference: z.string().trim().max(180).optional().default(''),
  notes: z.string().trim().max(2000).optional().default(''),
});

const evidenceTimelineSchema = z.object({
  cameraId: z.string().min(1).max(160).optional(),
  date: date,
  timezone: timezone.default('Europe/Berlin'),
});


// Static management endpoints must precede /:id routes.
recordingsRouter.get('/capabilities', (_req, res) => res.json({
  recordingBlockSeconds: config.recordingBlockSeconds,
  recordingBlockSecondsMin: 30,
  recordingBlockSecondsMax: 3600,
  recordingSegmentSeconds: config.recordingBlockSeconds,
  recordingMinFreeBytes: config.recordingMinFreeBytes,
  recordingStartupMediaTimeoutMs: config.recordingStartupMediaTimeoutMs,
  recordingMaxOutageSeconds: config.recordingMaxOutageSeconds,
  recordingMaxReconnectAttempts: config.recordingMaxReconnectAttempts,
  recordingPrebufferMaxSeconds: config.recordingPrebufferMaxSeconds,
  schedulerIntervalMs: config.recordingSchedulerIntervalMs,
  schedulerConcurrency: config.recordingSchedulerConcurrency,
  recordingQueueMaxPending: config.recordingQueueMaxPending,
  recordingSchedulerImmediateDebounceMs: config.recordingSchedulerImmediateDebounceMs,
  ptzCommandTimeoutMs: config.ptzCommandTimeoutMs,
  ptzContinuousMoveTimeoutMs: config.ptzContinuousMoveTimeoutMs,
  ptzLeaseTtlMs: config.ptzLeaseTtlMs,
  ptzMotionSettleMs: config.ptzMotionSettleMs,
  ptzMaxLeasesPerCamera: config.ptzMaxLeasesPerCamera,
  automaticRecordingDuringPtz: false,
  existingRecordingsContinueDuringPtz: true,
  // Deprecated compatibility fields. PTZ never creates recording events.
  ptzRecordingEventsEnabled: false,
  ptzRecordingEventSeconds: 0,
  ptzRecordingEventTypes: [],
  motionDetectionEnabled: config.motionDetectionEnabled,
  motionDetectionSource: config.motionDetectionSource,
  motionDetectionSnapshotFallback: config.motionDetectionSnapshotFallback,
  motionDetectionSkipDuringPtz: config.motionDetectionSkipDuringPtz,
  motionDetectionIntervalMs: config.motionDetectionIntervalMs,
  motionDetectionFrameTimeoutMs: config.motionDetectionFrameTimeoutMs,
  motionDetectionBlurRadius: config.motionDetectionBlurRadius,
  motionDetectionStabilizationPixels: config.motionDetectionStabilizationPixels,
  motionDetectionBrightnessCompensation: config.motionDetectionBrightnessCompensation,
  motionDetectionPixelThreshold: config.motionDetectionPixelThreshold,
  motionDetectionMinChangedRatio: config.motionDetectionMinChangedRatio,
  motionDetectionMinAverageDiff: config.motionDetectionMinAverageDiff,
  motionDetectionMinChangedPixels: config.motionDetectionMinChangedPixels,
  motionDetectionSceneChangeRatio: config.motionDetectionSceneChangeRatio,
  motionDetectionSceneChangeMinAverageDiff: config.motionDetectionSceneChangeMinAverageDiff,
  motionDetectionSuppressSceneChanges: config.motionDetectionSuppressSceneChanges,
  motionDetectionEventSeconds: config.motionDetectionEventSeconds,
  motionDetectionCooldownSeconds: config.motionDetectionCooldownSeconds,
  motionDetectionRearmSeconds: config.motionDetectionRearmSeconds,
  motionDetectionRetriggerSeconds: config.motionDetectionRetriggerSeconds,
  motionDetectionDebounceFrames: config.motionDetectionDebounceFrames,
  motionDetectionWindowFrames: config.motionDetectionWindowFrames,
  motionDetectionWindowMinMotionFrames: config.motionDetectionWindowMinMotionFrames,
  retentionBatchSize: config.retentionBatchSize,
}));

recordingsRouter.get('/kiosk/status', (_req, res) => {
  const activeRecordings = recordingService.activeList().map((recording) => ({
    id: recording.id,
    cameraId: recording.cameraId,
    startedAt: recording.startedAt,
    elapsedSeconds: recording.elapsedSeconds,
    status: recording.status,
    triggerType: recording.triggerType,
    planId: recording.planId || null,
    eventId: recording.eventId || null,
    recovering: Boolean(recording.recovering),
    interruptions: recording.interruptions || 0,
    playableBlockCount: recording.playableBlockCount || recording.blocks || 0,
  }));
  const motion = motionDetectionService.status();
  res.set({ 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Expires: '0' });
  res.json({
    generatedAt: new Date().toISOString(),
    motion: {
      enabled: motion.enabled,
      running: motion.running,
      busy: motion.busy,
      intervalMs: motion.intervalMs,
      source: motion.source,
      cameras: motion.cameras,
    },
    activeRecordings,
  });
});

recordingsRouter.get('/scheduler/status', (_req, res) => {
  res.set({ 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Expires: '0' });
  res.json({ ...recordingScheduler.status(), eventDispatcher: recordingEventDispatcher.status() });
});
recordingsRouter.get('/motion/status', (_req, res) => {
  res.set({ 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Expires: '0' });
  res.json(motionDetectionService.status());
});
recordingsRouter.post('/scheduler/run', authorize('admin'), asyncHandler(async (_req, res) => res.json(await recordingScheduler.tick())));
recordingsRouter.get('/retention/status', (_req, res) => res.json(retentionManager.status()));
recordingsRouter.get('/compression/status', (_req, res) => res.json(recordingCompressionService.status()));

recordingsRouter.get('/export/timeline', authorize('operator'), asyncHandler(async (req, res) => {
  const input = evidenceTimelineSchema.parse(req.query || {});
  res.json(recordingEvidenceExportService.timeline(input));
}));

recordingsRouter.post('/export/preview', authorize('operator'), asyncHandler(async (req, res) => {
  const input = evidenceExportSchema.parse(req.body || {});
  res.json(recordingEvidenceExportService.preview(input));
}));

recordingsRouter.post('/export', authorize('operator'), asyncHandler(async (req, res) => {
  const input = evidenceExportSchema.parse(req.body || {});
  const result = await recordingEvidenceExportService.create(input, { requestedBy: req.user?.sub || 'user' });
  res.set({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
  });
  res.on('finish', () => { fs.rm(result.zipPath, { force: true }, () => {}); });
  res.on('close', () => { fs.rm(result.zipPath, { force: true }, () => {}); });
  res.sendFile(result.zipPath);
}));

recordingsRouter.post('/cleanup', authorize('operator'), asyncHandler(async (req, res) => {
  const input = z.object({ cameraId: z.string().max(160).optional().nullable(), dryRun: z.boolean().default(false) }).parse(req.body || {});
  if (input.cameraId) requireCamera(input.cameraId);
  res.json(await retentionManager.run({ cameraId: input.cameraId || null, dryRun: input.dryRun }));
}));

recordingsRouter.get('/cameras/:cameraId/plans', (req, res) => {
  requireCamera(req.params.cameraId);
  res.json({ items: recordingPolicyRepository.listPlans(req.params.cameraId) });
});
recordingsRouter.put('/cameras/:cameraId/plans', authorize('operator'), (req, res) => {
  requireCamera(req.params.cameraId);
  const { plans } = z.object({ plans: z.array(planSchema).max(200) }).parse(req.body || {});
  res.json({ items: recordingPolicyRepository.replacePlans(req.params.cameraId, plans) });
});
recordingsRouter.post('/cameras/:cameraId/plans/preview', (req, res) => {
  requireCamera(req.params.cameraId);
  const input = z.object({ at: z.string().datetime().optional(), plans: z.array(planSchema).optional() }).parse(req.body || {});
  const plans = input.plans || recordingPolicyRepository.listPlans(req.params.cameraId);
  const events = recordingPolicyRepository.recentEvents(req.params.cameraId, { sinceHours: 48, limit: 1000 });
  res.json(evaluateRecordingPlans(plans, events, input.at ? new Date(input.at) : new Date()));
});
recordingsRouter.get('/cameras/:cameraId/retention', (req, res) => {
  requireCamera(req.params.cameraId);
  res.json(recordingPolicyRepository.getRetention(req.params.cameraId));
});
recordingsRouter.put('/cameras/:cameraId/retention', authorize('operator'), (req, res) => {
  requireCamera(req.params.cameraId);
  res.json(recordingPolicyRepository.saveRetention(req.params.cameraId, retentionSchema.parse(req.body || {})));
});

recordingsRouter.put('/cameras/:cameraId/planning', authorize('operator'), (req, res) => {
  requireCamera(req.params.cameraId);
  const input = z.object({
    plans: z.array(planSchema).max(200),
    retention: retentionSchema,
  }).parse(req.body || {});
  // Parse the complete form before writing anything, so the UI never gets a
  // validation error after one half of the planning screen has already been saved.
  const savedRetention = recordingPolicyRepository.saveRetention(req.params.cameraId, input.retention);
  const savedPlans = recordingPolicyRepository.replacePlans(req.params.cameraId, input.plans);
  res.json({ plans: savedPlans, retention: savedRetention });
});
recordingsRouter.get('/cameras/:cameraId/events', (req, res) => {
  requireCamera(req.params.cameraId);
  const limit = z.coerce.number().int().min(1).max(1000).default(200).parse(req.query.limit || 200);
  res.json({ items: recordingPolicyRepository.listEvents(req.params.cameraId, limit) });
});
recordingsRouter.post('/events', authorize('operator'), (req, res) => {
  const input = eventSchema.parse(req.body || {});
  requireCamera(input.cameraId);
  res.status(201).json(recordingEventDispatcher.publish(input.cameraId, input, { reason: 'api-event', log: true }));
});

recordingsRouter.get('/', (req, res) => {
  const input = listSchema.parse(req.query || {});
  res.json({ items: recordingService.list(input), active: recordingService.activeList(input.cameraId || null) });
});

recordingsRouter.post('/', authorize('operator'), asyncHandler(async (req, res) => {
  const input = startSchema.parse(req.body || {});
  res.status(201).json(await recordingService.start(input.cameraId, { ...input, triggerType: 'manual', requestedBy: req.user.sub }));
}));

recordingsRouter.post('/:id/stop', authorize('operator'), asyncHandler(async (req, res) => {
  res.json(await recordingService.stop(z.coerce.number().int().positive().parse(req.params.id)));
}));

recordingsRouter.get('/:id/segments', (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  res.json({ items: recordingService.segments(id) });
});

recordingsRouter.post('/:id/token', (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const recording = recordingService.get(id);
  if (!recording) throw new AppError(404, 'RECORDING_NOT_FOUND', 'Aufnahme nicht gefunden');
  const token = authService.signMediaToken({ userId: req.user.sub, path: `recording:${id}`, action: 'read' });
  const blockArchive = recording.archiveFormat === 'block_archive_v1';
  res.json({
    token,
    expiresIn: config.mediaTokenTtlSeconds,
    format: blockArchive ? 'hls' : 'file',
    url: blockArchive
      ? `/api/recordings/${id}/playlist.m3u8?token=${encodeURIComponent(token)}`
      : `/api/recordings/${id}/file?token=${encodeURIComponent(token)}`,
    downloadUrl: `/api/recordings/${id}/file?download=1&token=${encodeURIComponent(token)}`,
  });
});

recordingsRouter.delete('/:id', authorize('operator'), asyncHandler(async (req, res) => {
  await recordingService.remove(z.coerce.number().int().positive().parse(req.params.id));
  res.status(204).end();
}));
