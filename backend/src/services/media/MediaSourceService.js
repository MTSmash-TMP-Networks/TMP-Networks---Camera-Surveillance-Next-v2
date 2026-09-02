import DigestClient from 'digest-fetch';
import net from 'node:net';
import { cameraRepository } from '../cameraRepository.js';
import { AppError } from '../../utils/errors.js';
import { injectCredentials, safeMediaEndpoint } from '../../utils/url.js';
import { inferMediaSourceKind, normalizeMediaSourceUrl } from './MediaSource.js';
import { probeMedia } from './FfmpegProbe.js';
import { OnvifClient } from '../onvif/OnvifClient.js';
import { buildCatalogCandidates, cameraFingerprint, catalogInfo } from './CameraPathCatalog.js';
import { lookupCommunityCatalog, lookupSynologyCompatibility } from './OnlineCameraCatalog.js';
import { RtspPathProbe } from './RtspPathProbe.js';
import { inspectCameraWeb } from './CameraWebFingerprint.js';
import { buildDeepRtspCandidates } from './DeepCameraPaths.js';
import { CAMERA_RTSP_PORTS, CAMERA_TLS_PORTS, CAMERA_WEB_PORTS } from './CameraPortCatalog.js';

const COMMON_PATHS = [
  { label: 'HLS Live', kind: 'hls', service: 'http', path: '/live.m3u8' },
  { label: 'HLS Stream', kind: 'hls', service: 'http', path: '/stream.m3u8' },
  { label: 'HLS Verzeichnis', kind: 'hls', service: 'http', path: '/hls/live.m3u8' },
  { label: 'MJPEG', kind: 'mjpeg', service: 'http', path: '/mjpeg' },
  { label: 'MJPEG Video', kind: 'mjpeg', service: 'http', path: '/video.mjpg' },
  { label: 'MJPEG CGI', kind: 'mjpeg', service: 'http', path: '/videostream.cgi' },
  { label: 'Axis MJPEG', kind: 'mjpeg', service: 'http', path: '/axis-cgi/mjpg/video.cgi' },
  { label: 'RTSP Live', kind: 'rtsp', service: 'rtsp', path: '/live' },
  { label: 'RTSP Stream 1', kind: 'rtsp', service: 'rtsp', path: '/stream1' },
  { label: 'RTSP Stream 2', kind: 'rtsp', service: 'rtsp', path: '/stream2' },
  { label: 'RTSP Kanal 101', kind: 'rtsp', service: 'rtsp', path: '/Streaming/Channels/101' },
  { label: 'RTSP Kanal 102', kind: 'rtsp', service: 'rtsp', path: '/Streaming/Channels/102' },
  { label: 'RTSP Hauptstream', kind: 'rtsp', service: 'rtsp', path: '/cam/realmonitor?channel=1&subtype=0' },
  { label: 'RTSP Substream', kind: 'rtsp', service: 'rtsp', path: '/cam/realmonitor?channel=1&subtype=1' },
  { label: 'RTMP Live Stream', kind: 'rtmp', service: 'rtmp', path: '/live/stream' },
  { label: 'RTMP Live Cam', kind: 'rtmp', service: 'rtmp', path: '/live/cam' },
  { label: 'RTMP Stream 1', kind: 'rtmp', service: 'rtmp', path: '/live/1' },
  { label: 'RTMP Stream', kind: 'rtmp', service: 'rtmp', path: '/stream' },
  { label: 'Snapshot JPEG', kind: 'snapshot', service: 'http', path: '/snapshot.jpg' },
  { label: 'Snapshot CGI', kind: 'snapshot', service: 'http', path: '/snapshot.cgi' },
  { label: 'Snapshot ISAPI', kind: 'snapshot', service: 'http', path: '/ISAPI/Streaming/channels/101/picture' },
];

export const SERVICE_DEFINITIONS = [
  { protocol: 'http', label: 'HTTP', ports: CAMERA_WEB_PORTS.filter((port) => !CAMERA_TLS_PORTS.includes(port)) },
  { protocol: 'https', label: 'HTTPS', ports: CAMERA_WEB_PORTS.filter((port) => CAMERA_TLS_PORTS.includes(port)) },
  { protocol: 'rtsp', label: 'RTSP/RTSPS', ports: CAMERA_RTSP_PORTS },
  { protocol: 'rtmp', label: 'RTMP', ports: [1935, 1936] },
];

function syntheticProfile(source) {
  return {
    token: `source:${source.id || source.priority}`,
    name: source.label,
    videoCodec: null,
    videoProfile: null,
    audioCodec: null,
    width: null,
    height: null,
    fps: null,
    bitrate: null,
    hasPtz: false,
    role: 'alternative',
    rank: Number(source.priority || 100),
    mediaSourceId: source.id || null,
  };
}

export function normalizeMediaSources(sources, cameraIp, { allowExternalHost = false } = {}) {
  if (!Array.isArray(sources)) return [];
  if (sources.length > 30) throw new AppError(400, 'TOO_MANY_MEDIA_SOURCES', 'Maximal 30 alternative Medienquellen sind erlaubt');
  return sources.map((source, index) => {
    const url = normalizeMediaSourceUrl(source.url, cameraIp, { allowExternalHost });
    return {
      id: source.id ? Number(source.id) : null,
      label: String(source.label || `Alternative Quelle ${index + 1}`).trim().slice(0, 160),
      kind: inferMediaSourceKind(url, source.kind || 'auto'),
      url,
      priority: Math.max(0, Math.min(9999, Number(source.priority ?? ((index + 1) * 10)))),
      enabled: source.enabled !== false,
      origin: ['manual', 'discovered', 'catalog', 'community', 'onvif'].includes(source.origin) ? source.origin : 'manual',
    };
  });
}

export function manualStreamAttempts(sources = []) {
  const attempts = [];
  for (const source of sources.filter((item) => item.enabled && item.kind !== 'snapshot')) {
    const healthRank = source.lastStatus === 'available' ? 0 : source.lastStatus === 'failed' ? 2 : 1;
    const effectivePriority = Math.max(0, Number(source.priority || 100));
    const profile = syntheticProfile({ ...source, priority: effectivePriority });
    const endpoint = safeMediaEndpoint(source.url);
    const transports = source.kind === 'rtsp' ? ['tcp', 'udp'] : [source.kind];
    for (const transport of transports) {
      attempts.push({
        profile,
        profileIndex: Number(source.priority || 100),
        candidate: {
          sourceId: source.id,
          sourceType: source.kind,
          sourceLabel: source.label,
          uri: source.url,
          transport,
          endpoint,
          endpointReason: source.origin === 'manual' ? 'manual-media-source' : `${source.origin || 'discovered'}-media-source`,
          priority: effectivePriority,
          healthRank,
        },
      });
    }
  }
  return attempts;
}

function sourceClass(candidate) {
  const kind = candidate.sourceType || (candidate.endpoint?.scheme === 'rtsp' ? 'rtsp' : 'http');
  if (kind === 'rtsp') return `rtsp-${candidate.transport || 'tcp'}`;
  return kind;
}

const POLICY_ORDER = {
  auto: ['rtsp-tcp', 'hls', 'http', 'mjpeg', 'srt', 'rtmp', 'rtsp-http', 'rtsp-udp'],
  stable: ['hls', 'http', 'srt', 'rtsp-tcp', 'mjpeg', 'rtmp', 'rtsp-http', 'rtsp-udp'],
  'low-latency': ['rtsp-tcp', 'srt', 'rtsp-udp', 'rtmp', 'mjpeg', 'hls', 'http', 'rtsp-http'],
  'manual-first': ['manual', 'rtsp-tcp', 'hls', 'http', 'mjpeg', 'srt', 'rtmp', 'rtsp-http', 'rtsp-udp'],
};

export function sortMediaAttempts(attempts, policy = 'auto') {
  const order = POLICY_ORDER[policy] || POLICY_ORDER.auto;
  return [...attempts].sort((left, right) => {
    const lh = Number(left.candidate.healthRank ?? 1);
    const rh = Number(right.candidate.healthRank ?? 1);
    if (lh !== rh) return lh - rh;
    const leftManual = left.candidate.endpointReason?.includes('media-source');
    const rightManual = right.candidate.endpointReason?.includes('media-source');
    if (policy === 'manual-first' && leftManual !== rightManual) return leftManual ? -1 : 1;
    const li = order.indexOf(sourceClass(left.candidate));
    const ri = order.indexOf(sourceClass(right.candidate));
    const lc = li < 0 ? 99 : li;
    const rc = ri < 0 ? 99 : ri;
    return lc - rc || Number(left.candidate.priority ?? left.profileIndex ?? 100) - Number(right.candidate.priority ?? right.profileIndex ?? 100);
  });
}

async function fetchSnapshot(url, username, password) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const client = new DigestClient(username || '', password || '', { basic: true });
    const response = await client.fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) throw new Error(`Kein Bildinhalt (${contentType || 'unbekannt'})`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 64) throw new Error('Snapshot ist leer oder unvollständig');
    return { contentType, buffer };
  } finally { clearTimeout(timer); }
}

export async function testMediaSource(camera, source, { rtspProbe = null, requireFfprobe = true } = {}) {
  const kind = inferMediaSourceKind(source.url, source.kind);
  try {
    if (kind === 'snapshot') {
      const result = await fetchSnapshot(source.url, camera.username, camera.password);
      return { ok: true, kind, contentType: result.contentType, bytes: result.buffer.length };
    }
    let rtsp = null;
    if (kind === 'rtsp') {
      const probe = rtspProbe || new RtspPathProbe({ username: camera.username, password: camera.password });
      rtsp = await probe.describe(source.url);
      if (!rtsp.validPath) {
        const auth = rtsp.statusCode === 401 ? 'Authentifizierung abgelehnt' : null;
        const status = rtsp.statusCode ? `RTSP ${rtsp.statusCode} ${rtsp.statusText || ''}`.trim() : 'keine gültige RTSP-Antwort';
        throw new Error(`${auth ? `${auth}; ` : ''}${status}${rtsp.server ? ` · Server ${rtsp.server}` : ''}`);
      }
      if (!requireFfprobe) return { ok: true, kind, rtsp, pathConfirmed: true };
    }
    const uri = injectCredentials(source.url, camera.username, camera.password);
    const transport = kind === 'rtsp' ? 'tcp' : kind;
    const media = await probeMedia(uri, transport);
    return { ok: true, kind, media, rtsp, pathConfirmed: Boolean(rtsp?.validPath) };
  } catch (error) {
    return { ok: false, kind, error: String(error.details || error.message || error).slice(0, 1200) };
  }
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index++;
      output[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

function uniquePorts(values) {
  return [...new Set(values.map(Number).filter((value) => Number.isInteger(value) && value > 0 && value <= 65535))];
}

function cameraWithWebHint(camera, web) {
  const current = camera?.capabilities?.device || {};
  const generic = /^(?:general|generic|ipcam|ipc|network camera|onvif|unknown)?$/i.test(String(current.manufacturer || '').trim());
  if (!web?.manufacturerHint || (!generic && current.manufacturer)) return camera;
  return {
    ...camera,
    capabilities: {
      ...(camera.capabilities || {}),
      device: {
        ...current,
        manufacturer: web.manufacturerHint,
        model: current.model || web.title || null,
      },
    },
  };
}

export function portOpen(host, port, timeoutMs = 900) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function portsForService(camera, service) {
  const configured = Number(camera.onvif.port);
  const values = [...service.ports];
  if (service.protocol === 'http' && configured && ![443, 8443].includes(configured)) values.unshift(configured);
  if (service.protocol === 'https' && [443, 8443].includes(configured)) values.unshift(configured);
  return uniquePorts(values);
}

export function buildServiceTargets(camera) {
  return SERVICE_DEFINITIONS.flatMap((service) => portsForService(camera, service).map((port) => ({
    protocol: service.protocol,
    label: service.label,
    port,
  })));
}

function sourceMatchesService(source, service) {
  let url;
  try { url = new URL(source.url); } catch { return false; }
  const port = Number(url.port || ({ 'http:': 80, 'https:': 443, 'rtsp:': 554, 'rtsps:': 322, 'rtmp:': 1935, 'rtmps:': 443 }[url.protocol] || 0));
  if (port !== Number(service.port)) return false;
  if (service.protocol === 'http') return url.protocol === 'http:';
  if (service.protocol === 'https') return url.protocol === 'https:';
  if (service.protocol === 'rtsp') return ['rtsp:', 'rtsps:'].includes(url.protocol);
  if (service.protocol === 'rtmp') return ['rtmp:', 'rtmps:'].includes(url.protocol);
  return false;
}

export function summarizeServices(targets, portResults, successfulSources = []) {
  const open = new Map(portResults.map((item) => [Number(item.port), Boolean(item.open)]));
  return targets.map((target) => {
    const reachable = open.get(Number(target.port)) === true;
    const matching = successfulSources.filter((source) => sourceMatchesService(source, target));
    const confirmedCount = matching.filter((source) => source.lastStatus === 'path-confirmed').length;
    const declaredCount = matching.filter((source) => ['device-declared', 'high-confidence'].includes(source.lastStatus)).length;
    const streamCount = matching.length - confirmedCount - declaredCount;
    return {
      ...target,
      reachable,
      streamFound: streamCount > 0,
      pathConfirmed: confirmedCount > 0,
      streamCount,
      confirmedCount,
      declaredCount,
      status: !reachable ? 'closed' : streamCount > 0 ? 'media-found' : confirmedCount > 0 ? 'path-confirmed' : 'service-only',
      message: !reachable
        ? 'Port nicht erreichbar'
        : streamCount > 0
          ? `${streamCount} nutzbare Medienquelle${streamCount === 1 ? '' : 'n'} erkannt`
          : confirmedCount > 0
            ? `${confirmedCount} RTSP-Pfad${confirmedCount === 1 ? '' : 'e'} durch Kamera bestätigt; FFmpeg-Kompatibilität noch offen`
            : declaredCount > 0
              ? `${declaredCount} Stream-Pfad${declaredCount === 1 ? '' : 'e'} aus Kamera-/Modellinformationen ermittelt; Liveprüfung erfolgt beim Start`
              : 'Dienst erreichbar; konkreter Stream-Pfad noch unbekannt',
    };
  });
}

export function buildDiscoveryCandidates(camera, openPorts = null) {
  const host = camera.onvif.ip.includes(':') ? `[${camera.onvif.ip}]` : camera.onvif.ip;
  const cameraWebPort = CAMERA_WEB_PORTS.includes(Number(camera.onvif.port)) ? Number(camera.onvif.port) : null;
  const webPorts = uniquePorts([cameraWebPort, ...CAMERA_WEB_PORTS]);
  const rtspPorts = uniquePorts(CAMERA_RTSP_PORTS);
  const rtmpPorts = uniquePorts([1935, 1936]);
  const allowed = openPorts ? new Set(openPorts.map(Number)) : null;
  const candidates = [];
  for (const entry of COMMON_PATHS) {
    const ports = entry.service === 'rtsp' ? rtspPorts : entry.service === 'rtmp' ? rtmpPorts : webPorts;
    for (const port of ports) {
      if (allowed && !allowed.has(port)) continue;
      const scheme = entry.service === 'rtsp'
        ? 'rtsp'
        : entry.service === 'rtmp'
          ? 'rtmp'
          : CAMERA_TLS_PORTS.includes(port) ? 'https' : 'http';
      candidates.push({
        label: `${entry.label} · Port ${port}`,
        kind: entry.kind,
        priority: 200 + candidates.length,
        enabled: true,
        origin: 'discovered',
        url: `${scheme}://${host}:${port}${entry.path}`,
      });
    }
  }
  return candidates;
}

function mergeDiscoveryCandidates(groups, existing = new Set(), maxCandidates = 180) {
  const byUrl = new Map();
  for (const source of groups.flat()) {
    if (!source?.url || existing.has(source.url)) continue;
    const current = byUrl.get(source.url);
    if (!current || Number(source.confidence || 0) > Number(current.confidence || 0)) byUrl.set(source.url, source);
  }
  return [...byUrl.values()]
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0) || Number(a.priority || 9999) - Number(b.priority || 9999))
    .slice(0, maxCandidates);
}

async function onvifDiscoveryCandidates(camera) {
  const client = new OnvifClient(camera);
  const profiles = (camera.discoveryProfiles || (camera.id && camera.id !== 'inspection' ? cameraRepository.profiles(camera.id) : [])).slice(0, 8);
  const items = [];
  const warnings = [];
  for (const profile of profiles) {
    try {
      const candidates = await client.streamCandidates(profile.token, undefined, profile.mediaService);
      for (const candidate of candidates) {
        items.push({
          label: `ONVIF · ${profile.name} · ${candidate.transport.toUpperCase()}`,
          kind: candidate.sourceType || inferMediaSourceKind(candidate.uri, 'auto'),
          priority: Math.max(1, Number(profile.rank || 1)),
          enabled: true,
          origin: 'onvif',
          url: candidate.uri,
          catalogProvider: 'ONVIF GetStreamUri',
          catalogFamily: profile.name,
          catalogRole: profile.role || null,
          confidence: 100,
          matchedBy: 'Von der Kamera gemeldete Medienadresse',
        });
      }
    } catch (error) {
      warnings.push(`${profile.name}: ${String(error.message || error).slice(0, 220)}`);
    }
  }
  return { items, warnings };
}

async function testDiscoveryBudget(camera, candidates, { aggressive = false, resultLimit = null } = {}) {
  const maxAttempts = aggressive ? 150 : 90;
  const maxResults = Number.isInteger(resultLimit) && resultLimit > 0 ? Math.min(12, resultLimit) : (aggressive ? 12 : 8);
  const deadline = Date.now() + (aggressive ? 150000 : 90000);
  const queue = candidates.slice(0, maxAttempts);
  const successes = [];
  const confirmedPaths = [];
  const provisionalPaths = [];
  const failures = [];
  const rtspStatusCounts = {};
  const rtspProbe = new RtspPathProbe({ username: camera.username, password: camera.password, timeoutMs: aggressive ? 2600 : 2100 });
  let index = 0;
  let stoppedBy = null;
  let rtspAuthFailures = 0;

  const acceptedCount = () => successes.length + confirmedPaths.length + provisionalPaths.length;
  async function worker() {
    while (index < queue.length && acceptedCount() < maxResults && Date.now() < deadline) {
      const source = queue[index++];
      const kind = inferMediaSourceKind(source.url, source.kind);
      if (kind === 'rtsp') {
        if (rtspAuthFailures >= 3) {
          failures.push({ label: source.label, url: safeMediaEndpoint(source.url), provider: source.catalogProvider || source.origin, error: 'RTSP-Suche wegen wiederholter Authentifizierungsfehler übersprungen' });
          continue;
        }
        if (source.probeTransport === 'http') {
          try {
            const uri = injectCredentials(source.url, camera.username, camera.password);
            successes.push({ ...source, kind: 'rtsp', media: await probeMedia(uri, 'http'), pathConfirmed: true, tunnel: true });
          } catch (error) {
            failures.push({ label: source.label, url: safeMediaEndpoint(source.url), provider: source.catalogProvider || source.origin, error: String(error.details || error.message || error).slice(0, 600) });
          }
          continue;
        }
        let rtsp;
        try {
          rtsp = await rtspProbe.describe(source.url);
          const key = String(rtsp.statusCode || 'network-error');
          rtspStatusCounts[key] = (rtspStatusCounts[key] || 0) + 1;
        } catch (error) {
          failures.push({ label: source.label, url: safeMediaEndpoint(source.url), provider: source.catalogProvider || source.origin, error: String(error.message || error).slice(0, 600) });
          continue;
        }
        if (!rtsp.validPath) {
          if (rtsp.statusCode === 401) rtspAuthFailures += 1;
          let ffprobeFallback = null;
          if (source.forceFfprobeOnRtspFailure && rtsp.statusCode !== 404) {
            try {
              const uri = injectCredentials(source.url, camera.username, camera.password);
              ffprobeFallback = await probeMedia(uri, 'tcp');
            } catch { /* RTSP-Bibliothek und FFprobe konnten den Kandidaten nicht öffnen */ }
          }
          if (ffprobeFallback) {
            successes.push({ ...source, kind: 'rtsp', media: ffprobeFallback, rtsp, pathConfirmed: true, verifiedBy: 'ffprobe-fallback' });
            continue;
          }
          if (source.declaredByDevice || source.highConfidenceCandidate) {
            provisionalPaths.push({
              ...source,
              enabled: true,
              lastStatus: source.declaredByDevice ? 'device-declared' : 'high-confidence',
              lastError: source.declaredByDevice
                ? 'Der Kanal wurde von der Kamera per Hikvision-ISAPI gemeldet; die Live-Verbindung wird beim ersten Start erneut geprüft.'
                : 'Modelltypischer Hikvision-Pfad; direkte Prüfung war nicht eindeutig. Die Live-Verbindung versucht diesen Pfad erneut.',
              lastVerifiedAt: new Date().toISOString(),
              rtsp,
            });
          }
          const message = rtsp.statusCode === 401
            ? 'RTSP-Authentifizierung wurde abgelehnt; Benutzername/Kennwort oder RTSP-Berechtigung prüfen'
            : rtsp.statusCode
              ? `RTSP ${rtsp.statusCode} ${rtsp.statusText || ''}`.trim()
              : 'Keine gültige RTSP-Antwort';
          failures.push({ label: source.label, url: safeMediaEndpoint(source.url), provider: source.catalogProvider || source.origin, error: message, rtsp });
          continue;
        }
        let verified;
        try {
          const uri = injectCredentials(source.url, camera.username, camera.password);
          verified = { ok: true, kind: 'rtsp', media: await probeMedia(uri, 'tcp'), rtsp, pathConfirmed: true };
        } catch (error) {
          verified = { ok: false, error: String(error.details || error.message || error).slice(0, 1200) };
        }
        if (verified.ok) successes.push({ ...source, ...verified });
        else confirmedPaths.push({
          ...source,
          enabled: true,
          lastStatus: 'path-confirmed',
          lastError: `RTSP-DESCRIBE und SDP-Videospur bestätigt; FFmpeg-Prüfung fehlgeschlagen: ${verified.error}`,
          lastVerifiedAt: new Date().toISOString(),
          rtsp,
        });
        continue;
      }
      const result = await testMediaSource(camera, source);
      if (result.ok) successes.push({ ...source, ...result });
      else failures.push({ label: source.label, url: safeMediaEndpoint(source.url), provider: source.catalogProvider || source.origin, error: result.error });
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
  if (acceptedCount() >= maxResults) stoppedBy = 'enough-results';
  else if (Date.now() >= deadline) stoppedBy = 'time-budget';
  else if (index >= queue.length) stoppedBy = 'all-candidates-tested';
  return {
    successes,
    confirmedPaths: [...new Map(confirmedPaths.map((item) => [item.url, item])).values()].slice(0, 12),
    provisionalPaths: [...new Map(provisionalPaths.map((item) => [item.url, item])).values()].slice(0, 12),
    failures,
    attempted: Math.min(index, queue.length),
    totalCandidates: candidates.length,
    stoppedBy,
    rtspStatusCounts,
    rtspAuthFailures,
  };
}

async function discoverForCamera(camera, options = {}, existingSources = []) {
  const onlineCatalogs = options.onlineCatalogs !== false;
  const aggressive = options.aggressive === true;
  const targets = buildServiceTargets(camera);
  const probePorts = uniquePorts(targets.map((target) => target.port));
  const portResults = await mapLimit(probePorts, 10, async (port) => ({ port, open: await portOpen(camera.onvif.ip, port) }));
  const openPorts = portResults.filter((item) => item.open).map((item) => item.port);
  const existing = new Set(existingSources.map((source) => source.url));

  const webPromise = inspectCameraWeb(camera, openPorts).catch((error) => ({ candidates: [], warnings: [`Web-Fingerprint: ${error.message}`] }));
  const onvifPromise = onvifDiscoveryCandidates(camera).catch((error) => ({ items: [], warnings: [`ONVIF-Pfadsuche: ${error.message}`] }));
  const [web, onvif] = await Promise.all([webPromise, onvifPromise]);
  const catalogCamera = cameraWithWebHint(camera, web);
  const localCatalog = buildCatalogCandidates(catalogCamera, { openPorts, aggressive, maxCandidates: aggressive ? 180 : 100 });
  const communityPromise = onlineCatalogs
    ? lookupCommunityCatalog(catalogCamera, { openPorts })
    : Promise.resolve({ items: [], matches: [], warnings: [] });
  const synologyPromise = onlineCatalogs
    ? lookupSynologyCompatibility(catalogCamera)
    : Promise.resolve(null);
  const [community, synologyCompatibility] = await Promise.all([communityPromise, synologyPromise]);
  const deepRtsp = buildDeepRtspCandidates(catalogCamera, openPorts, { aggressive });
  const common = buildDiscoveryCandidates(catalogCamera, openPorts).map((source, index) => ({
    ...source,
    confidence: aggressive ? 24 : 18,
    priority: 700 + index,
    catalogProvider: 'Generische Standardpfade',
    catalogFamily: 'Fallback',
    matchedBy: 'Protokoll- und Portheuristik',
  }));

  const seedCandidates = Array.isArray(options.seedCandidates) ? options.seedCandidates : [];
  const candidates = mergeDiscoveryCandidates([
    seedCandidates,
    onvif.items,
    web.candidates || [],
    localCatalog.candidates,
    community.items,
    deepRtsp,
    aggressive ? common : common.slice(0, 30),
  ], existing, aggressive ? 300 : 210);
  const tested = await testDiscoveryBudget(camera, candidates, { aggressive, resultLimit: options.resultLimit });
  const items = tested.successes.map((source, index) => ({
    ...source,
    priority: Math.min(Number(source.priority || 100), 40 + index),
    lastStatus: 'available',
    lastError: null,
    lastVerifiedAt: new Date().toISOString(),
  }));

  const warnings = [...(onvif.warnings || []), ...(web.warnings || []), ...(community.warnings || [])];
  if (!items.length && candidates.length) warnings.push('Keiner der geprüften Katalog- und Standardpfade lieferte eine Videospur. Der herstellerspezifische Pfad kann weiterhin manuell eingetragen werden.');
  return {
    device: cameraFingerprint(catalogCamera),
    webFingerprint: { manufacturerHint: web.manufacturerHint || null, title: web.title || null, server: web.server || null, pages: web.pages || [] },
    catalog: catalogInfo(),
    catalogMatches: [...localCatalog.catalogMatches, ...(community.matches || [])],
    synologyCompatibility,
    onlineCatalogs,
    aggressive,
    services: summarizeServices(targets, portResults, [...items, ...tested.confirmedPaths, ...tested.provisionalPaths]),
    items,
    confirmedPaths: tested.confirmedPaths,
    provisionalPaths: tested.provisionalPaths,
    diagnostics: {
      openPorts,
      candidateCount: candidates.length,
      attempted: tested.attempted,
      successful: items.length,
      stoppedBy: tested.stoppedBy,
      recentFailures: tested.failures.slice(0, 18),
      rtspStatusCounts: tested.rtspStatusCounts,
      rtspAuthFailures: tested.rtspAuthFailures,
      confirmedRtspPaths: tested.confirmedPaths.length,
      provisionalRtspPaths: tested.provisionalPaths.length,
      warnings,
    },
  };
}

export const mediaSourceService = {
  normalize: normalizeMediaSources,
  async testCameraSources(cameraId) {
    const camera = cameraRepository.getWithCredentials(cameraId);
    if (!camera) throw new AppError(404, 'CAMERA_NOT_FOUND', 'Kamera nicht gefunden');
    const sources = cameraRepository.mediaSources(cameraId);
    const results = await mapLimit(sources, 3, async (source) => {
      const result = await testMediaSource(camera, source);
      cameraRepository.updateMediaSourceStatus(source.id, result.ok ? 'available' : 'failed', result.ok ? null : result.error);
      return { ...source, ...result };
    });
    return results;
  },
  async discover(cameraId, options = {}) {
    const camera = cameraRepository.getWithCredentials(cameraId);
    if (!camera) throw new AppError(404, 'CAMERA_NOT_FOUND', 'Kamera nicht gefunden');
    return discoverForCamera(camera, options, cameraRepository.mediaSources(cameraId));
  },
  async discoverTemporary(camera, options = {}) {
    return discoverForCamera(camera, { onlineCatalogs: false, aggressive: true, ...options }, []);
  },
  snapshotSources(cameraId) {
    return cameraRepository.mediaSources(cameraId).filter((source) => source.enabled && source.kind === 'snapshot');
  },
  fetchSnapshot,
};
