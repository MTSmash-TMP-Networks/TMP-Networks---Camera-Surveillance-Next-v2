import { Router } from 'express';
import { authService } from '../services/authService.js';

export const internalRouter = Router();

function bearerToken(req) {
  const value = String(req.get('authorization') || '');
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1] || null;
}

function originalUri(req) {
  return String(req.get('x-original-uri') || req.originalUrl || req.url || '');
}

function parsedOriginalUri(req) {
  try { return new URL(originalUri(req), 'http://local.invalid'); }
  catch { return null; }
}

function streamPathFromUri(req) {
  const parsed = parsedOriginalUri(req);
  const src = parsed?.searchParams.get('src');
  return src ? src.replace(/^\/+/, '') : null;
}

function allowsPathlessSessionRequest(req) {
  const parsed = parsedOriginalUri(req);
  if (!parsed) return false;
  const path = parsed.pathname.replace(/^\/media\/go2rtc/, '');
  return path.startsWith('/api/hls/') || path.startsWith('/api/webrtc/');
}

function verifyBrokerRequest(req, res) {
  try {
    const body = req.body || {};
    const token = body.token || req.query?.token || bearerToken(req);
    const path = body.path || req.query?.path || streamPathFromUri(req);
    const action = body.action || req.query?.action || 'read';
    if (!token) return res.status(401).end();
    if (path) authService.verifyMediaToken(token, { path, action });
    else if (allowsPathlessSessionRequest(req)) authService.verifyAnyMediaToken(token, { action });
    else return res.status(401).end();
    return res.status(204).end();
  } catch {
    return res.status(401).end();
  }
}

internalRouter.get('/go2rtc-auth', verifyBrokerRequest);
internalRouter.post('/go2rtc-auth', verifyBrokerRequest);
