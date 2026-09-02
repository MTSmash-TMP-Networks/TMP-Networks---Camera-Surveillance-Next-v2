import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { streamOrchestrator } from '../services/media/StreamOrchestrator.js';
import { authService } from '../services/authService.js';
import { config } from '../config.js';
import { cameraRepository } from '../services/cameraRepository.js';
import { cameraEventLog } from '../services/CameraEventLog.js';
import { AppError } from '../utils/errors.js';
import { demoModeSettingsService } from '../services/DemoModeSettingsService.js';

export const streamsRouter = Router();
streamsRouter.use(authenticate);
const sessionSchema = z.object({ quality: z.enum(['auto', 'high', 'balanced', 'low']).default('auto'), viewportWidth: z.coerce.number().min(160).max(7680).default(1280), profileToken: z.string().max(300).optional().nullable(), purpose: z.enum(['live', 'kiosk']).default('live'), forceTranscode: z.boolean().default(false), wait: z.boolean().default(true) });
const heartbeatSchema = sessionSchema.omit({ wait: true }).partial().extend({ quality: z.enum(['auto', 'high', 'balanced', 'low']).default('auto'), viewportWidth: z.coerce.number().min(160).max(7680).default(1280) });
const sessionLimiter = rateLimit({ windowMs: 10_000, limit: 30, standardHeaders: true, legacyHeaders: false });

function canExposeWebRtc(outputs) {
  return Boolean(config.browserWebRtcEnabled && outputs?.webrtc);
}

function isLocalHlsSession(session) {
  return Boolean(session?.mode === 'local-hls-ring' || session?.localHlsUrl || config.browserHlsMode === 'local-ring');
}

function localHlsUrl(paths, cacheBuster = Date.now()) {
  const key = encodeURIComponent(paths.localHls || paths.hls);
  return `${config.publicLocalHlsBase.replace(/\/$/, '')}/${key}/index.m3u8?v=${encodeURIComponent(cacheBuster || Date.now())}`;
}

function hlsUrlForSession(session, paths, publicSession) {
  if (!session.outputs?.hls) return null;
  if (isLocalHlsSession(session)) return session.localHlsUrl ? `${session.localHlsUrl}?v=${encodeURIComponent(publicSession.cacheBuster || Date.now())}` : localHlsUrl(paths, publicSession.cacheBuster);
  return `${config.publicGo2RtcBase}/api/stream.m3u8?src=${encodeURIComponent(paths.hls)}&v=${encodeURIComponent(publicSession.cacheBuster || Date.now())}`;
}
const clientEventSchema = z.object({
  level: z.enum(['info', 'warn', 'error']).default('info'),
  code: z.string().max(100).default('BROWSER_EVENT'),
  message: z.string().min(1).max(1000),
  protocol: z.enum(['WebRTC', 'LL-HLS', 'Local-HLS', 'Snapshot', 'browser', 'unknown']).optional().default('unknown'),
  details: z.record(z.string(), z.unknown()).optional().default({}),
});

streamsRouter.post('/:id/session', sessionLimiter, asyncHandler(async (req, res) => {
  res.set({ 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Expires: '0' });
  const input = sessionSchema.parse(req.body || {});
  const session = await streamOrchestrator.ensure(req.params.id, {
    quality: input.quality, viewportWidth: input.viewportWidth, profileToken: input.profileToken, purpose: input.purpose, forceTranscode: input.forceTranscode,
  }, { wait: input.wait });
  const { paths, ...publicSession } = session;
  if (session.state !== 'ready') {
    return res.status(202).json({
      ...publicSession,
      tokens: { webrtc: null, hls: null },
      expiresIn: 0,
      webrtcUrl: null,
      hlsUrl: null,
      cacheBuster: publicSession.cacheBuster || Date.now(),
    });
  }
  const exposeWebRtc = canExposeWebRtc(session.outputs);
  const webrtcToken = exposeWebRtc ? authService.signMediaToken({ userId: req.user.sub, path: paths.webrtc, action: 'read' }) : null;
  const hlsToken = session.outputs.hls && !isLocalHlsSession(session) ? authService.signMediaToken({ userId: req.user.sub, path: paths.hls, action: 'read' }) : null;
  return res.json({
    ...publicSession,
    tokens: { webrtc: webrtcToken, hls: hlsToken },
    expiresIn: config.mediaTokenTtlSeconds,
    webrtcUrl: exposeWebRtc ? `${config.publicGo2RtcBase}/api/webrtc?src=${encodeURIComponent(paths.webrtc)}` : null,
    hlsUrl: hlsUrlForSession(session, paths, publicSession),
    browserTransport: isLocalHlsSession(session) ? 'local-hls' : (exposeWebRtc ? 'webrtc' : 'hls'),
    cacheBuster: publicSession.cacheBuster || Date.now(),
  });
}));

streamsRouter.post('/:id/heartbeat', sessionLimiter, asyncHandler(async (req, res) => {
  res.set({ 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Expires: '0' });
  const input = heartbeatSchema.parse(req.body || {});
  const heartbeat = await streamOrchestrator.heartbeat(req.params.id, input);
  if (!heartbeat.session?.paths || heartbeat.session.state !== 'ready') {
    const { paths: _paths, ...safeSession } = heartbeat.session || {};
    return res.json({ ...heartbeat, session: heartbeat.session ? safeSession : null, tokens: { webrtc: null, hls: null }, webrtcUrl: null, hlsUrl: null });
  }
  const { paths, ...publicSession } = heartbeat.session;
  const exposeWebRtc = canExposeWebRtc(publicSession.outputs);
  const webrtcToken = exposeWebRtc ? authService.signMediaToken({ userId: req.user.sub, path: paths.webrtc, action: 'read' }) : null;
  const hlsToken = publicSession.outputs?.hls && !isLocalHlsSession(publicSession) ? authService.signMediaToken({ userId: req.user.sub, path: paths.hls, action: 'read' }) : null;
  return res.json({
    serverTime: heartbeat.serverTime,
    session: publicSession,
    tokens: { webrtc: webrtcToken, hls: hlsToken },
    expiresIn: config.mediaTokenTtlSeconds,
    webrtcUrl: exposeWebRtc ? `${config.publicGo2RtcBase}/api/webrtc?src=${encodeURIComponent(paths.webrtc)}` : null,
    hlsUrl: hlsUrlForSession(publicSession, paths, publicSession),
    browserTransport: isLocalHlsSession(publicSession) ? 'local-hls' : (exposeWebRtc ? 'webrtc' : 'hls'),
  });
}));

streamsRouter.get('/:id/status', (req, res) => {
  res.set({ 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Expires: '0' });
  res.json({ items: streamOrchestrator.status(req.params.id), serverTime: new Date().toISOString() });
});
streamsRouter.post('/:id/restart', authorize('operator'), asyncHandler(async (req, res) => res.json(await streamOrchestrator.restart(req.params.id))));

streamsRouter.post('/:id/client-event', sessionLimiter, (req, res) => {
  if (!cameraRepository.get(req.params.id)) throw new AppError(404, 'CAMERA_NOT_FOUND', 'Kamera nicht gefunden');
  if (demoModeSettingsService.status().demoMode) return res.status(204).end();
  const event = clientEventSchema.parse(req.body || {});
  cameraEventLog.append(req.params.id, {
    level: event.level,
    component: 'browser',
    code: event.code,
    message: event.message,
    details: { protocol: event.protocol, ...event.details, userId: req.user.sub },
  });
  res.status(204).end();
});
