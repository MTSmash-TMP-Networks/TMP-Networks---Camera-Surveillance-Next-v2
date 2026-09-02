import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { updateService } from '../services/UpdateService.js';
import { AppError } from '../utils/errors.js';
import { systemMetricsService } from '../services/SystemMetricsService.js';
import { auditLogService } from '../services/AuditLogService.js';
import { domainEventBus } from '../services/events/DomainEventBus.js';
import { eventWebSocketHub } from '../services/events/EventWebSocketHub.js';
import { systemControlService } from '../services/SystemControlService.js';
import { notificationSettingsService, EMAIL_LANGUAGES } from '../services/notifications/NotificationSettingsService.js';
import { emailNotificationService } from '../services/notifications/EmailNotificationService.js';
import { aiEventAnalysisSettingsService, AI_ANALYSIS_LANGUAGES } from '../services/ai/AiEventAnalysisSettingsService.js';
import { aiEventAnalysisService } from '../services/ai/AiEventAnalysisService.js';
import { demoModeSettingsService } from '../services/DemoModeSettingsService.js';
import { recordingStorageService } from '../services/RecordingStorageService.js';

export const systemRouter = Router();
systemRouter.use(authenticate, authorize('admin'));


const demoModeSettingsSchema = z.object({
  enabled: z.boolean(),
  allowExports: z.boolean().optional(),
}).strict();

systemRouter.get('/demo-mode', asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.json({ settings: demoModeSettingsService.get(), runtime: demoModeSettingsService.status() });
}));

systemRouter.put('/demo-mode', asyncHandler(async (req, res) => {
  const input = demoModeSettingsSchema.parse(req.body || {});
  const settings = demoModeSettingsService.save(input);
  res.json({ settings, runtime: demoModeSettingsService.status() });
}));

systemRouter.get('/status', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  const [metrics, containers] = await Promise.all([
    systemMetricsService.status(),
    updateService.containerStatus({ requestId: req.id }),
  ]);
  res.json({ ...metrics, containers });
}));

const recordingStorageSchema = z.object({
  mode: z.enum(['local', 'network']),
  protocol: z.enum(['smb', 'sftp']).optional().default('smb'),
  host: z.string().trim().max(255).optional().default(''),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  share: z.string().trim().max(160).optional().default(''),
  basePath: z.string().trim().max(768).optional().default(''),
  username: z.string().max(320).optional().default(''),
  password: z.string().max(1024).optional().default(''),
  domain: z.string().trim().max(160).optional().default(''),
  hostKeyPolicy: z.enum(['accept-new', 'strict']).optional().default('accept-new'),
}).strict();

systemRouter.get('/recording-storage', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.json(await recordingStorageService.overview({ requestId: req.id }));
}));

systemRouter.post('/recording-storage/test', asyncHandler(async (req, res) => {
  const input = recordingStorageSchema.parse(req.body || {});
  res.json(await recordingStorageService.test(input, { requestId: req.id }));
}));

systemRouter.put('/recording-storage', asyncHandler(async (req, res) => {
  const input = recordingStorageSchema.parse(req.body || {});
  res.json(await recordingStorageService.configure(input, { requestedBy: req.user.sub, requestId: req.id }));
}));


const emailRulesSchema = z.object({
  motion: z.boolean().optional(),
  cameraStatus: z.boolean().optional(),
  streamFailures: z.boolean().optional(),
  recordingFailures: z.boolean().optional(),
  systemErrors: z.boolean().optional(),
  updateOperations: z.boolean().optional(),
}).partial();

const emailSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  host: z.string().trim().max(255).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  security: z.enum(['none', 'starttls', 'tls']).optional(),
  username: z.string().max(320).optional(),
  password: z.string().max(1024).optional(),
  clearPassword: z.boolean().optional(),
  fromName: z.string().max(120).optional(),
  fromAddress: z.union([z.literal(''), z.string().email().max(320)]).optional(),
  recipients: z.array(z.string().email().max(320)).max(20).optional(),
  language: z.enum(EMAIL_LANGUAGES).optional(),
  rejectUnauthorized: z.boolean().optional(),
  cooldownSeconds: z.coerce.number().int().min(0).max(86400).optional(),
  rules: emailRulesSchema.optional(),
}).strict();

systemRouter.get('/notifications/email', asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.json({ settings: notificationSettingsService.get(), runtime: emailNotificationService.status() });
}));

systemRouter.put('/notifications/email', asyncHandler(async (req, res) => {
  const input = emailSettingsSchema.parse(req.body || {});
  const settings = notificationSettingsService.save(input);
  res.json({ settings, runtime: emailNotificationService.status() });
}));

systemRouter.post('/notifications/email/test', asyncHandler(async (req, res) => {
  const input = z.object({ recipient: z.string().email().max(320).optional() }).strict().parse(req.body || {});
  const result = await emailNotificationService.test(input.recipient || null);
  if (!result.sent) throw new AppError(502, 'EMAIL_TEST_FAILED', result.error || result.reason || 'Test-E-Mail konnte nicht gesendet werden');
  res.json(result);
}));

systemRouter.get('/notifications/email/deliveries', asyncHandler(async (req, res) => {
  const input = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query || {});
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.json({ items: emailNotificationService.deliveries(input.limit) });
}));


const aiAnalyzeSchema = z.object({
  motion: z.boolean().optional(),
  manualRecording: z.boolean().optional(),
  continuousRecording: z.boolean().optional(),
}).partial();

const aiEventAnalysisSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(['openai', 'compatible']).optional(),
  baseUrl: z.string().trim().max(2048).optional(),
  apiMode: z.enum(['responses', 'chat_completions']).optional(),
  model: z.string().trim().min(1).max(160).optional(),
  apiKey: z.string().max(4096).optional(),
  clearApiKey: z.boolean().optional(),
  reasoningEffort: z.enum(['none', 'low', 'medium', 'high']).optional(),
  imageDetail: z.enum(['low', 'high', 'auto']).optional(),
  frameCount: z.coerce.number().int().min(1).max(5).optional(),
  frameIntervalMs: z.coerce.number().int().min(0).max(5000).optional(),
  language: z.enum(AI_ANALYSIS_LANGUAGES).optional(),
  analysisCooldownSeconds: z.coerce.number().int().min(0).max(3600).optional(),
  includeInEmail: z.boolean().optional(),
  onlyRelevantNotifications: z.boolean().optional(),
  requestTimeoutMs: z.coerce.number().int().min(5000).max(120000).optional(),
  analyze: aiAnalyzeSchema.optional(),
}).strict();

systemRouter.get('/notifications/ai', asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.json({ settings: aiEventAnalysisSettingsService.get(), runtime: aiEventAnalysisService.status() });
}));

systemRouter.put('/notifications/ai', asyncHandler(async (req, res) => {
  const input = aiEventAnalysisSettingsSchema.parse(req.body || {});
  const settings = aiEventAnalysisSettingsService.save(input);
  res.json({ settings, runtime: aiEventAnalysisService.status() });
}));

systemRouter.post('/notifications/ai/test', asyncHandler(async (req, res) => {
  const input = z.object({ cameraId: z.string().min(1).max(160), language: z.enum(AI_ANALYSIS_LANGUAGES).optional() }).strict().parse(req.body || {});
  const result = await aiEventAnalysisService.test(input.cameraId, { language: input.language === 'auto' ? null : input.language });
  if (!result.analyzed) throw new AppError(502, 'AI_ANALYSIS_TEST_FAILED', result.error || result.reason || 'KI-Testanalyse konnte nicht ausgefuehrt werden');
  res.json(result);
}));

systemRouter.post('/restart', asyncHandler(async (req, res) => {
  z.object({ confirmation: z.literal('NEUSTART') }).parse(req.body || {});
  res.status(202).json(await systemControlService.restart({ requestedBy: req.user.sub, requestId: req.id }));
}));


systemRouter.get('/audit', asyncHandler(async (req, res) => {
  const input = z.object({
    limit: z.coerce.number().int().min(1).max(1000).default(200),
    after: z.coerce.number().int().min(0).default(0),
    outcome: z.enum(['success', 'denied', 'failed']).optional(),
    action: z.string().max(100).optional(),
  }).parse(req.query || {});
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.json({ items: auditLogService.list(input) });
}));

systemRouter.get('/events/recent', asyncHandler(async (req, res) => {
  const input = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(200), after: z.coerce.number().int().min(0).default(0) }).parse(req.query || {});
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.json({ items: domainEventBus.recent(input), websocket: eventWebSocketHub.status() });
}));

systemRouter.get('/update', asyncHandler(async (req, res) => res.json(await updateService.overview({ requestId: req.id }))));

systemRouter.post('/update/upload', asyncHandler(async (req, res) => {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(contentType)) {
    throw new AppError(415, 'UPDATE_CONTENT_TYPE', 'Update muss als ZIP-Datei hochgeladen werden');
  }
  const filename = String(req.headers['x-file-name'] || 'update.zip');
  const item = await updateService.upload(req, filename, req.user.sub, req.headers['content-length'] || null);
  res.status(201).json(item);
}));

systemRouter.post('/update/install', asyncHandler(async (req, res) => {
  const input = z.object({ packageId: z.string().uuid(), confirmation: z.literal('INSTALLIEREN') }).parse(req.body || {});
  res.status(202).json(await updateService.install(input.packageId, req.user.sub, req.id));
}));

systemRouter.post('/update/rollback', asyncHandler(async (req, res) => {
  const input = z.object({ backupId: z.string().min(10).max(200), confirmation: z.literal('ROLLBACK') }).parse(req.body || {});
  res.status(202).json(await updateService.rollback(input.backupId, req.user.sub, req.id));
}));

systemRouter.delete('/update/packages/:id', asyncHandler(async (req, res) => {
  await updateService.remove(req.params.id);
  res.status(204).end();
}));
