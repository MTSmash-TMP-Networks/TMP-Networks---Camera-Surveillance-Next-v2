import { AppError } from '../utils/errors.js';
import { injectCredentials } from '../utils/url.js';
import { inferMediaSourceKind, normalizeMediaSourceUrl } from './media/MediaSource.js';
import { probeMedia } from './media/FfmpegProbe.js';

const DIRECT_STREAM_KINDS = new Set(['auto', 'rtsp', 'hls', 'mjpeg', 'http', 'rtmp', 'srt']);
const DEFAULT_PORTS = { 'rtsp:': 554, 'rtsps:': 322, 'http:': 80, 'https:': 443, 'rtmp:': 1935, 'rtmps:': 443 };

function decodeCredential(value) {
  try { return decodeURIComponent(String(value || '')); } catch { return String(value || ''); }
}

function primarySource(input) {
  const source = Array.isArray(input?.mediaSources) ? input.mediaSources.find((item) => item?.enabled !== false && item?.url) : null;
  if (!source) throw new AppError(400, 'DIRECT_STREAM_URL_REQUIRED', 'Für einen direkten Netzwerkstream ist eine Stream-URL erforderlich');
  if (!DIRECT_STREAM_KINDS.has(source.kind || 'auto')) throw new AppError(400, 'DIRECT_STREAM_KIND_UNSUPPORTED', 'Dieser Quellentyp kann nicht als direkter Live-Stream verwendet werden');
  return source;
}

export function normalizeDirectStreamInput(input) {
  const source = primarySource(input);
  let embeddedUsername = '';
  let embeddedPassword = '';
  try {
    const rawParsed = new URL(String(source.url || '').trim());
    embeddedUsername = decodeCredential(rawParsed.username);
    embeddedPassword = decodeCredential(rawParsed.password);
  } catch { /* normalizeMediaSourceUrl liefert die eigentliche Validierung. */ }
  const url = normalizeMediaSourceUrl(source.url, null, { allowExternalHost: true });
  const parsed = new URL(url);
  const kind = inferMediaSourceKind(url, source.kind || 'auto');
  if (kind === 'snapshot') throw new AppError(400, 'DIRECT_STREAM_KIND_UNSUPPORTED', 'JPEG-Snapshots können nicht als direkter Live-Stream angelegt werden');
  const port = Number(parsed.port || DEFAULT_PORTS[parsed.protocol] || 0);
  const normalizedSource = {
    ...source,
    label: String(source.label || input.name || 'Live Stream').trim().slice(0, 160) || 'Live Stream',
    kind,
    url,
    priority: Math.max(0, Math.min(9999, Number(source.priority ?? 10))),
    enabled: source.enabled !== false,
    origin: 'manual',
  };
  return {
    ...input,
    username: input.username || embeddedUsername,
    password: input.password || embeddedPassword,
    ip: parsed.hostname,
    port,
    mediaSources: [normalizedSource, ...(input.mediaSources || []).filter((item) => item !== source)],
    primarySource: normalizedSource,
    streamProtocol: parsed.protocol.replace(':', ''),
  };
}

export async function inspectDirectStream(input, { probe = probeMedia } = {}) {
  const normalized = normalizeDirectStreamInput(input);
  const source = normalized.primarySource;
  const uri = injectCredentials(source.url, normalized.username || '', normalized.password || '');
  const transport = source.kind === 'rtsp' ? 'tcp' : source.kind;
  let media;
  try {
    media = await probe(uri, transport);
  } catch (error) {
    throw new AppError(422, 'DIRECT_STREAM_UNREACHABLE', 'Der Netzwerkstream konnte nicht als Videostream bestätigt werden', String(error?.details || error?.message || error).slice(0, 1200));
  }
  const device = {
    manufacturer: 'Generic Stream',
    model: source.kind.toUpperCase(),
    name: normalized.name || source.label || 'Network Stream',
    deviceType: 'NetworkStream',
    webPort: normalized.port || null,
    driver: 'direct-stream',
  };
  return {
    mode: 'stream',
    device,
    profiles: [],
    mediaSources: normalized.mediaSources,
    capabilities: {
      driver: 'direct-stream',
      connectionType: 'stream',
      onvif: false,
      ptz: false,
      audio: Boolean(media.audio),
      media,
      device,
    },
    connection: {
      ip: normalized.ip,
      port: normalized.port,
      openPorts: normalized.port ? [normalized.port] : [],
      manufacturer: device.manufacturer,
      model: device.model,
      discoveryEvidence: `Direkter ${source.kind.toUpperCase()}-Stream`,
    },
  };
}
