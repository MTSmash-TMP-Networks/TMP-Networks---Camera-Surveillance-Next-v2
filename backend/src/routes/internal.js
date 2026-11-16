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

// Protect each local playlist and TS segment. HLS.js sends a Bearer token;
// native HLS uses a path-scoped HttpOnly cookie from the preview endpoint.
function verifyLocalHlsRequest(req, res) {
  try {
    const parsed = parsedOriginalUri(req);
    const match = /^\/live-hls\/([A-Za-z0-9_.-]+)\/(?:index\.m3u8|seg_[0-9]+\.ts)$/.exec(parsed?.pathname || '');
    if (!match || match[1] === '.' || match[1] === '..') return res.status(401).end();
    const cookie = String(req.get('cookie') || '').split(';').map((part) => part.trim())
      .find((part) => part.startsWith('tmp_hls_media='));
    const cookieToken = cookie ? decodeURIComponent(cookie.slice('tmp_hls_media='.length)) : null;
    const token = bearerToken(req) || cookieToken;
    if (!token) return res.status(401).end();
    authService.verifyMediaToken(token, { path: `local-hls:${match[1]}`, action: 'read' });
    return res.status(204).end();
  } catch {
    return res.status(401).end();
  }
}
internalRouter.get('/local-hls-auth', verifyLocalHlsRequest);
