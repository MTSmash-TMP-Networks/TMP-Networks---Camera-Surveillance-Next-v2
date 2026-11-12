import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { cameraRepository } from '../services/cameraRepository.js';
import { cameraService } from '../services/cameraService.js';
import { NetworkCameraDiscovery, cameraDiscoveryDefaults } from '../services/NetworkCameraDiscovery.js';
import { snapshotService } from '../services/media/SnapshotService.js';
import { streamOrchestrator } from '../services/media/StreamOrchestrator.js';
import { AppError } from '../utils/errors.js';
import { cameraEventLog } from '../services/CameraEventLog.js';
import { recordingService } from '../services/RecordingService.js';
import { mediaSourceService } from '../services/media/MediaSourceService.js';
import { discoveryJobService } from '../services/DiscoveryJobService.js';
import { config } from '../config.js';

export const camerasRouter = Router();
camerasRouter.use(authenticate);

const mediaSourceSchema = z.object({
  id: z.coerce.number().int().positive().nullable().optional(),
  label: z.string().min(1).max(160),
  kind: z.enum(['auto', 'rtsp', 'hls', 'mjpeg', 'http', 'rtmp', 'srt', 'snapshot']).default('auto'),
  url: z.string().min(5).max(2000),
  priority: z.coerce.number().int().min(0).max(9999).default(100),
  enabled: z.boolean().default(true),
  origin: z.enum(['manual', 'discovered', 'catalog', 'community', 'onvif']).optional().default('manual'),
});

const cameraSchema = z.object({
  name: z.string().max(160).optional().default(''),
  location: z.string().max(200).optional().default(''),
  ip: z.string().max(255).optional().default(''),
  port: z.coerce.number().int().min(0).max(65535).default(0),
  xaddr: z.string().max(2000).nullable().optional(),
  username: z.string().max(200).default(''),
  password: z.string().max(300).default(''),
  preferredProfile: z.string().max(300).nullable().optional(),
  profilePolicy: z.enum(['auto', 'high', 'balanced', 'low']).optional().default('auto'),
  codecPreference: z.enum(['auto', 'h264', 'h265']).optional().default('auto'),
  sourcePolicy: z.enum(['auto', 'stable', 'low-latency', 'manual-first']).optional().default('auto'),
  mediaSources: z.array(mediaSourceSchema).max(30).optional().default([]),
  connectionMode: z.enum(['auto', 'onvif', 'generic', 'stream']).optional().default('auto'),
  manufacturer: z.coerce.string().max(160).nullable().optional(),
  model: z.coerce.string().max(180).nullable().optional(),
  serialNumber: z.coerce.string().max(180).nullable().optional(),
  macAddress: z.coerce.string().max(80).nullable().optional(),
  deviceUid: z.coerce.string().max(240).nullable().optional(),
  openPorts: z.array(z.coerce.number().int().min(1).max(65535)).max(40).optional().default([]),
  discoveryEvidence: z.string().max(4000).nullable().optional(),
  preferredSourceUrl: z.string().max(2000).nullable().optional(),
}).superRefine((input, ctx) => {
  if (input.connectionMode !== 'stream' && String(input.ip || '').trim().length < 3) {
    ctx.addIssue({ code: 'custom', path: ['ip'], message: 'IP-Adresse ist erforderlich' });
  }
  if (input.connectionMode === 'stream' && !(input.mediaSources || []).some((source) => source?.url)) {
    ctx.addIssue({ code: 'custom', path: ['mediaSources'], message: 'Stream-URL ist erforderlich' });
  }
});

const motionZoneSchema = z.object({
  x: z.coerce.number().min(0).max(1),
  y: z.coerce.number().min(0).max(1),
  width: z.coerce.number().positive().max(1),
  height: z.coerce.number().positive().max(1),
}).superRefine((zone, ctx) => {
  if (zone.x + zone.width > 1.000001) ctx.addIssue({ code: 'custom', path: ['width'], message: 'Motion-Bereich liegt ausserhalb des Bildes' });
  if (zone.y + zone.height > 1.000001) ctx.addIssue({ code: 'custom', path: ['height'], message: 'Motion-Bereich liegt ausserhalb des Bildes' });
});

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  location: z.string().max(200).optional(),
  ip: z.string().min(3).max(255).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  xaddr: z.string().max(2000).nullable().optional(),
  username: z.string().max(200).optional(),
  password: z.string().max(300).optional(),
  preferredProfile: z.string().max(300).nullable().optional(),
  profilePolicy: z.enum(['auto', 'high', 'balanced', 'low']).optional(),
  codecPreference: z.enum(['auto', 'h264', 'h265']).optional(),
  sourcePolicy: z.enum(['auto', 'stable', 'low-latency', 'manual-first']).optional(),
  mediaSources: z.array(mediaSourceSchema).max(30).optional(),
  enabled: z.boolean().optional(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  motionZone: motionZoneSchema.nullable().optional(),
});

const discoverySchema = z.object({
  timeoutMs: z.coerce.number().int().min(1000).max(30000).default(config.discoveryAutoTimeoutMs),
  portTimeoutMs: z.coerce.number().int().min(150).max(5000).default(config.discoveryPortTimeoutMs),
  scanConcurrency: z.coerce.number().int().min(4).max(512).default(config.discoveryScanConcurrency),
  perHostConcurrency: z.coerce.number().int().min(1).max(16).default(config.discoveryPerHostConcurrency),
  fingerprintConcurrency: z.coerce.number().int().min(1).max(32).default(config.discoveryFingerprintConcurrency),
  includeUnverified: z.boolean().default(false),
  activeScan: z.boolean().default(false),
  scanRanges: z.union([z.string(), z.array(z.string())]).optional().default([]),
  ports: z.array(z.coerce.number().int().min(1).max(65535)).max(40).optional().default(cameraDiscoveryDefaults.ports),
}).transform((input) => ({
  ...input,
  scanRanges: Array.isArray(input.scanRanges) ? input.scanRanges : input.scanRanges.split(/[\s,;]+/).filter(Boolean),
}));

camerasRouter.get('/', (_req, res) => res.json({ items: cameraRepository.list() }));

camerasRouter.get('/next-name', authorize('admin'), (_req, res) => res.json({ name: cameraRepository.nextDefaultName() }));

// Long-running scans are detached from the browser request. This prevents proxy,
// VPN and page-navigation interruptions from aborting the actual network scan.
camerasRouter.post('/discovery-jobs', authorize('admin'), (req, res) => {
  const input = discoverySchema.parse(req.body || {});
  const result = discoveryJobService.start(input, { userId: req.user.sub, origin: 'manual' });
  res.status(result.reused ? 200 : 202).json({ ...result.job, reused: result.reused });
});

camerasRouter.get('/discovery-jobs/latest', authorize('admin'), (req, res) => {
  const origin = z.enum(['manual', 'startup']).optional().parse(req.query.origin || undefined);
  res.json({ job: discoveryJobService.latest({ origin }) });
});

camerasRouter.get('/discovery-jobs/recent', authorize('admin'), (req, res) => {
  const limit = z.coerce.number().int().min(1).max(100).default(20).parse(req.query.limit || 20);
  res.json({ items: discoveryJobService.recent(limit) });
});

camerasRouter.get('/discovery-jobs/:jobId', authorize('admin'), (req, res) => {
  res.json(discoveryJobService.get(z.string().uuid().parse(req.params.jobId)));
});

// Compatibility endpoint for older clients. New clients use discovery jobs.
camerasRouter.post('/discover', authorize('admin'), asyncHandler(async (req, res) => {
  const input = discoverySchema.parse(req.body || {});
  const result = await NetworkCameraDiscovery.discoverDetailed(input);
  const items = result.items.filter((device) => !cameraRepository.findDiscoveryDuplicate(device));
  res.json({
    items,
    diagnostics: { ...result.diagnostics, filteredExisting: result.items.length - items.length },
    scanner: {
      mode: input.activeScan ? 'manual-range' : 'host-routes-and-broadcast',
      ranges: input.activeScan ? input.scanRanges : [...new Set([...NetworkCameraDiscovery.automaticRanges(), ...input.scanRanges])],
    },
  });
}));

camerasRouter.post('/inspect', authorize('admin'), asyncHandler(async (req, res) => {
  res.json(await cameraService.inspect(cameraSchema.parse({ location: '', ...req.body })));
}));

camerasRouter.post('/', authorize('admin'), asyncHandler(async (req, res) => {
  res.status(201).json(await cameraService.create(cameraSchema.parse(req.body)));
}));

camerasRouter.get('/:id/logs', (req, res) => {
  if (!cameraRepository.get(req.params.id)) throw new AppError(404, 'CAMERA_NOT_FOUND', 'Kamera nicht gefunden');
  const query = z.object({
    limit: z.coerce.number().int().min(1).max(500).default(200),
    after: z.coerce.number().int().min(0).default(0),
    level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  }).parse(req.query || {});
  res.json({ items: cameraEventLog.list(req.params.id, query) });
});

camerasRouter.delete('/:id/logs', authorize('operator'), (req, res) => {
  if (!cameraRepository.get(req.params.id)) throw new AppError(404, 'CAMERA_NOT_FOUND', 'Kamera nicht gefunden');
  res.json({ deleted: cameraEventLog.clear(req.params.id) });
});

camerasRouter.get('/:id', (req, res) => {
  const camera = cameraRepository.get(req.params.id);
  if (!camera) throw new AppError(404, 'CAMERA_NOT_FOUND', 'Kamera nicht gefunden');
  res.json({
    camera,
    profiles: cameraRepository.profiles(req.params.id),
    mediaSources: cameraRepository.mediaSources(req.params.id),
    streams: streamOrchestrator.status(req.params.id),
  });
});

camerasRouter.patch('/:id', authorize('admin'), asyncHandler(async (req, res) => {
  const patch = patchSchema.parse(req.body);
  const streamAffecting = ['ip', 'port', 'username', 'password', 'preferredProfile', 'profilePolicy', 'codecPreference', 'sourcePolicy', 'mediaSources', 'rotation', 'enabled']
    .some((field) => patch[field] !== undefined);
  if (streamAffecting) await recordingService.stopCamera(req.params.id);
  res.json(await cameraService.update(req.params.id, patch));
}));

camerasRouter.delete('/:id', authorize('admin'), asyncHandler(async (req, res) => {
  await recordingService.stopCamera(req.params.id);
  await streamOrchestrator.stopCamera(req.params.id);
  if (!cameraRepository.remove(req.params.id)) throw new AppError(404, 'CAMERA_NOT_FOUND', 'Kamera nicht gefunden');
  res.status(204).end();
}));

camerasRouter.post('/:id/sources/test', authorize('operator'), asyncHandler(async (req, res) => {
  res.json({ items: await mediaSourceService.testCameraSources(req.params.id) });
}));

camerasRouter.post('/:id/sources/discover', authorize('operator'), asyncHandler(async (req, res) => {
  const options = z.object({
    onlineCatalogs: z.boolean().optional().default(true),
    aggressive: z.boolean().optional().default(false),
  }).parse(req.body || {});
  res.json(await mediaSourceService.discover(req.params.id, options));
}));

camerasRouter.post('/:id/profiles/refresh', authorize('operator'), asyncHandler(async (req, res) => {
  res.json({ items: await cameraService.refreshProfiles(req.params.id) });
}));

camerasRouter.get('/:id/snapshot', asyncHandler(async (req, res) => {
  const profile = z.string().max(300).optional().parse(req.query.profile || undefined);
  const result = await snapshotService.capture(req.params.id, profile || null);
  res.set({ 'Content-Type': result.contentType, 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' }).send(result.buffer);
}));
