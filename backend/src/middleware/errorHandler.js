import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';
import { publicError } from '../utils/errors.js';

export function notFound(req, res) {
  res.status(404).json({ error: 'NOT_FOUND', message: `Route ${req.method} ${req.path} nicht gefunden`, requestId: req.id });
}

export function errorHandler(error, req, res, _next) {
  if (res.headersSent) return;
  if (error?.type === 'entity.too.large') {
    res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: 'Die hochgeladene Datei überschreitet die erlaubte Größe', requestId: req.id });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Eingaben sind ungueltig', details: error.issues, requestId: req.id });
    return;
  }
  const { status, body } = publicError(error, req.id);
  if (status >= 500) logger.error({ err: error, requestId: req.id }, 'Unbehandelter API-Fehler');
  else logger.warn({ code: body.error, requestId: req.id }, body.message);
  res.status(status).json(body);
}
