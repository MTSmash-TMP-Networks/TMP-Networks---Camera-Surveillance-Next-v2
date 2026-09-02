import { AppError } from '../../utils/errors.js';
import { safeMediaEndpoint } from '../../utils/url.js';

export const MEDIA_SOURCE_KINDS = ['auto', 'rtsp', 'hls', 'mjpeg', 'http', 'rtmp', 'srt', 'snapshot'];
export const MEDIA_SOURCE_SCHEMES = ['rtsp:', 'rtsps:', 'http:', 'https:', 'rtmp:', 'rtmps:', 'srt:'];

export function inferMediaSourceKind(rawUrl, declared = 'auto') {
  if (declared && declared !== 'auto') return declared;
  const url = new URL(rawUrl);
  const path = `${url.pathname}${url.search}`.toLowerCase();
  if (['rtsp:', 'rtsps:'].includes(url.protocol)) return 'rtsp';
  if (['rtmp:', 'rtmps:'].includes(url.protocol)) return 'rtmp';
  if (url.protocol === 'srt:') return 'srt';
  if (/\.m3u8(?:$|[?#])/.test(path) || /(?:^|\/)hls(?:\/|$)/.test(path)) return 'hls';
  if (/mjpeg|mjpg|videostream\.cgi|video\.cgi/.test(path)) return 'mjpeg';
  return 'http';
}

export function normalizeMediaSourceUrl(rawUrl, cameraIp, { allowExternalHost = false } = {}) {
  let url;
  try { url = new URL(String(rawUrl || '').trim()); }
  catch { throw new AppError(400, 'INVALID_MEDIA_SOURCE_URL', 'Die Medienquelle enthält keine gültige URL'); }
  if (!MEDIA_SOURCE_SCHEMES.includes(url.protocol.toLowerCase())) {
    throw new AppError(400, 'INVALID_MEDIA_SOURCE_PROTOCOL', `Nicht unterstütztes Medienprotokoll: ${url.protocol}`);
  }
  if (!allowExternalHost && cameraIp && url.hostname !== cameraIp) {
    throw new AppError(400, 'MEDIA_SOURCE_HOST_MISMATCH', 'Alternative Medienquellen müssen auf dieselbe Kamera-IP zeigen');
  }
  url.username = '';
  url.password = '';
  return url.toString();
}

export function publicMediaSource(row) {
  return {
    id: Number(row.id),
    cameraId: row.camera_id,
    label: row.label,
    kind: row.kind || 'auto',
    url: row.url,
    priority: Number(row.priority || 100),
    enabled: Boolean(row.enabled),
    origin: row.origin || 'manual',
    lastStatus: row.last_status || 'unknown',
    lastError: row.last_error || null,
    lastVerifiedAt: row.last_verified_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function sourceCandidate(source) {
  const kind = inferMediaSourceKind(source.url, source.kind);
  const endpoint = safeMediaEndpoint(source.url);
  return {
    sourceId: source.id,
    sourceType: kind,
    sourceLabel: source.label,
    uri: source.url,
    transport: kind === 'rtsp' ? 'tcp' : kind,
    endpoint,
    endpointReason: source.origin === 'manual' ? 'manual-media-source' : 'discovered-media-source',
    priority: Number(source.priority || 100),
  };
}
