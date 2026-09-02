import { auditLogService } from '../services/AuditLogService.js';
import { logger } from '../utils/logger.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HIGH_FREQUENCY_PTZ = /^\/api\/ptz\/[^/]+\/(?:move|heartbeat)$/;

function resourceFromPath(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  const apiIndex = parts.indexOf('api');
  const area = parts[apiIndex + 1] || parts[0] || 'system';
  let type = area;
  let id = parts[apiIndex + 2] || null;
  if (area === 'auth' && parts[apiIndex + 2] === 'users') {
    type = 'users';
    id = parts[apiIndex + 3] || null;
  } else if (area === 'recordings' && parts[apiIndex + 2] === 'cameras') {
    type = 'recording-plans';
    id = parts[apiIndex + 3] || null;
  }
  return { type, id };
}

export function auditTrail(req, res, next) {
  if (!MUTATING.has(req.method) || !String(req.path || '').startsWith('/api/')) return next();
  res.once('finish', () => {
    try {
      const pathname = req.originalUrl?.split('?')[0] || req.path;
      // A held PTZ key emits move/heartbeat requests several times per second.
      // Successful pulses are operational telemetry, not individual audit
      // decisions. Failures and denied requests remain fully auditable.
      if (res.statusCode < 400 && HIGH_FREQUENCY_PTZ.test(pathname)) return;
      const resource = resourceFromPath(pathname);
      const outcome = res.statusCode < 400 ? 'success' : res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 423 ? 'denied' : 'failed';
      auditLogService.append({
        actorUserId: req.user?.sub || null,
        actorUsername: req.user?.username || (req.path === '/api/auth/login' ? String(req.body?.username || '').slice(0, 100) : null),
        action: `${req.method} ${req.route?.path || req.path}`,
        resourceType: resource.type,
        resourceId: resource.id,
        outcome,
        requestId: req.id || null,
        ipAddress: req.ip || req.socket?.remoteAddress || null,
        details: { statusCode: res.statusCode, path: pathname },
      });
    } catch (error) {
      logger.warn({ err: error, requestId: req.id }, 'Audit-Eintrag konnte nicht gespeichert werden');
    }
  });
  next();
}
