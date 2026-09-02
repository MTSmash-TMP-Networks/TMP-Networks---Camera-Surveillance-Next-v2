import { createAxisEvidenceGuardMiddleware } from './axisEvidenceGuard.js';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { authRouter } from './routes/auth.js';
import { camerasRouter } from './routes/cameras.js';
import { streamsRouter } from './routes/streams.js';
import { ptzRouter } from './routes/ptz.js';
import { internalRouter } from './routes/internal.js';
import { recordingsRouter } from './routes/recordings.js';
import { systemRouter } from './routes/system.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { auditTrail } from './middleware/auditTrail.js';
import { demoModeGuard } from './middleware/demoMode.js';

export function createApp() {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger, genReqId: (req) => req.headers['x-request-id'] || crypto.randomUUID() }));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-origin' } }));
  app.use(cors({ origin: config.corsOrigin || false, credentials: false }));
  app.use(express.json({ limit: '1mb' }));
// v2.20.8: require verified Axis/VAPIX identity; authenticated ONVIF stays authoritative.
const axisEvidenceGuardMiddleware2208 = createAxisEvidenceGuardMiddleware();
app.use(axisEvidenceGuardMiddleware2208);

  app.use(demoModeGuard);
  app.use(auditTrail);

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'tmp-camera-backend', version: config.appVersion, time: new Date().toISOString() }));
  app.use('/internal', internalRouter);
  app.use('/api/auth/login', rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/auth', authRouter);
  app.use('/api/cameras', camerasRouter);
  app.use('/api/streams', streamsRouter);
  app.use('/api/ptz', ptzRouter);
  app.use('/api/recordings', recordingsRouter);
  app.use('/api/system', systemRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
