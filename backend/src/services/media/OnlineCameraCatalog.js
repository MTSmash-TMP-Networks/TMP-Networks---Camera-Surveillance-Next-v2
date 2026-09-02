import { config } from '../../config.js';
import { cameraFingerprint } from './CameraPathCatalog.js';

const ISPY_BASE = 'https://www.ispyconnect.com/camera/';
const SYNOLOGY_BASE = 'https://www.synology.com/en-eu/compatibility/camera';
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const pageCache = new Map();
const CAMERA_USER_AGENT = `TMP-Camera-Surveillance/${config.appVersion} (+intelligent-camera-path-discovery)`;

const SLUG_ALIASES = new Map([
  ['axis communications', 'axis'],
  ['axis communications ab', 'axis'],
  ['dahua technology', 'dahua'],
  ['zhejiang dahua technology', 'dahua'],
  ['hangzhou hikvision digital technology', 'hikvision'],
  ['hikvision digital technology', 'hikvision'],
  ['tp link', 'tp-link'],
  ['tp-link', 'tp-link'],
  ['hanwha vision', 'hanwha'],
  ['hanwha techwin', 'hanwha'],
  ['samsung techwin', 'samsung'],
  ['xiongmai', 'ipc'],
  ['xiongmai technology', 'ipc'],
  ['hisilicon', 'ipc'],
]);

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function slugify(value) {
  const key = normalized(value);
  if (SLUG_ALIASES.has(key)) return SLUG_ALIASES.get(key);
  return key.replace(/\s+/g, '-').replace(/^-|-$/g, '') || 'other';
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}

function textContent(html) {
  return decodeEntities(String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

async function fetchLimited(url, timeoutMs = 8000) {
  const cached = pageCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.body;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': CAMERA_USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) return await response.text();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error('Antwort des Online-Katalogs ist zu groß');
      chunks.push(value);
    }
    const body = new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
    pageCache.set(url, { body, expiresAt: Date.now() + CACHE_TTL_MS });
    return body;
  } finally { clearTimeout(timer); }
}

function defaultPort(protocol, pageText = '') {
  if (protocol === 'RTMP') return 1935;
  if (protocol === 'HTTP') return 80;
  const match = pageText.match(/\bPort\s+(\d{2,5})\b/i);
  return match ? Number(match[1]) : 554;
}

function modelCellValues(models) {
  return decodeEntities(models)
    .split(/\s*,\s*|\s+or\s+|\s*\/\s*/i)
    .map(normalized)
    .filter(Boolean);
}

function modelCellMatches(models, model) {
  const modelKey = normalized(model);
  const values = modelCellValues(models);
  if (!modelKey) return values.includes('unknown');
  return values.some((value) => value === modelKey || value.includes(modelKey) || modelKey.includes(value)) || values.includes('unknown');
}

function safeCommunityPath(path) {
  if (!path) return null;
  let candidate = String(path).trim();
  if (/^(?:rtsp|rtsps|http|https|rtmp|rtmps):\/\//i.test(candidate)) {
    try {
      const parsed = new URL(candidate);
      candidate = `${parsed.pathname}${parsed.search}`;
    } catch { return null; }
  }
  if (!candidate.startsWith('/')) return null;
  if (/\[(?:USERNAME|PASSWORD)\]/i.test(candidate)) return null;
  if (candidate.length > 1200 || /[\r\n]/.test(candidate)) return null;
  return candidate
    .replace(/\[CHANNEL\]/gi, '1')
    .replace(/\[WIDTH\]/gi, '640')
    .replace(/\[HEIGHT\]/gi, '480');
}

export function parseIspyCameraPage(html, { manufacturer = '', model = '', host, openPorts = [] } = {}) {
  const pageText = textContent(html);
  const rows = [...String(html || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const items = [];
  const seen = new Set();
  for (const row of rows) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => textContent(match[1]));
    if (cells.length < 3) continue;
    const pathIndex = cells.findIndex((cell) => cell.startsWith('/') || /^(?:rtsp|http|rtmp)s?:\/\//i.test(cell));
    if (pathIndex < 0) continue;
    const path = safeCommunityPath(cells[pathIndex]);
    if (!path) continue;
    const protocol = cells.find((cell) => /^(RTSP|HTTP|RTMP)$/i.test(cell))?.toUpperCase();
    if (!protocol) continue;
    const models = cells[0] || '';
    const mediaType = String(cells[1] || '').toUpperCase();
    if (!modelCellMatches(models, model)) continue;
    const standard = defaultPort(protocol, pageText);
    const matchingPorts = (openPorts || []).map(Number).filter((port) => {
      if (protocol === 'RTSP') return [554, 8554, 10554, standard].includes(port);
      if (protocol === 'RTMP') return [1935, 1936, standard].includes(port);
      return [80, 443, 8000, 8080, 8443, standard].includes(port);
    });
    const ports = matchingPorts.length ? [...new Set(matchingPorts)] : [standard];
    for (const port of ports) {
      const scheme = protocol === 'RTSP' ? 'rtsp' : protocol === 'RTMP' ? 'rtmp' : [443, 8443].includes(port) ? 'https' : 'http';
      const bracketedHost = String(host || '').includes(':') ? `[${host}]` : host;
      const url = `${scheme}://${bracketedHost}:${port}${path}`;
      if (seen.has(url)) continue;
      seen.add(url);
      items.push({
        label: `${manufacturer || 'Community'} ${model || ''} · ${protocol} ${path}`.replace(/\s+/g, ' ').trim(),
        kind: protocol === 'RTSP'
          ? 'rtsp'
          : protocol === 'RTMP'
            ? 'rtmp'
            : mediaType.includes('MJPEG')
              ? 'mjpeg'
              : mediaType.includes('JPEG')
                ? 'snapshot'
                : 'http',
        priority: 70 + items.length,
        enabled: true,
        origin: 'community',
        url,
        catalogProvider: 'Agent DVR / iSpy Community',
        catalogFamily: manufacturer || null,
        catalogRole: null,
        confidence: modelCellValues(models).some((value) => normalized(model) && (value === normalized(model) || value.includes(normalized(model)) || normalized(model).includes(value))) ? 82 : 52,
        matchedBy: modelCellValues(models).some((value) => normalized(model) && (value === normalized(model) || value.includes(normalized(model)) || normalized(model).includes(value))) ? 'Modell' : 'Hersteller / Unknown-Eintrag',
      });
    }
  }
  return items;
}

export async function lookupCommunityCatalog(camera, { openPorts = [] } = {}) {
  const fingerprint = cameraFingerprint(camera);
  if (!fingerprint.manufacturer) return { items: [], matches: [], warnings: ['ONVIF liefert keinen Hersteller für die Online-Katalogsuche.'] };
  const slug = slugify(fingerprint.manufacturer);
  const url = `${ISPY_BASE}${encodeURIComponent(slug)}`;
  try {
    const html = await fetchLimited(url);
    const items = parseIspyCameraPage(html, {
      manufacturer: fingerprint.manufacturer,
      model: fingerprint.model,
      host: camera.onvif.ip,
      openPorts,
    });
    return {
      items,
      matches: items.length ? [{
        provider: 'Agent DVR / iSpy Community',
        id: `ispy:${slug}`,
        title: `${fingerprint.manufacturer}${fingerprint.model ? ` ${fingerprint.model}` : ''}`,
        confidence: Math.max(...items.map((item) => item.confidence || 0)),
        matchedBy: fingerprint.model ? 'Hersteller und Modell/Unknown-Einträge' : 'Hersteller',
        candidateCount: items.length,
        sourceUrl: url,
      }] : [],
      warnings: items.length ? [] : ['Der Community-Katalog enthielt keine passenden, ohne Klartext-Zugangsdaten nutzbaren Pfade.'],
    };
  } catch (error) {
    return { items: [], matches: [], warnings: [`Agent-DVR-Katalog nicht erreichbar: ${error.message}`] };
  }
}

export async function lookupSynologyCompatibility(camera) {
  const fingerprint = cameraFingerprint(camera);
  if (!fingerprint.manufacturer || !fingerprint.model) return null;
  const query = new URLSearchParams();
  query.append('brand[]', fingerprint.manufacturer);
  const referenceUrl = `${SYNOLOGY_BASE}?${query.toString()}`;
  return {
    provider: 'Synology Kompatibilitätscenter',
    supported: null,
    model: fingerprint.model,
    manufacturer: fingerprint.manufacturer,
    referenceUrl,
    note: 'Synologys öffentliche Liste enthält Funktions- und Codec-Kompatibilität, wird aber dynamisch geladen und veröffentlicht keine direkten RTSP-Pfade. Sie dient hier nur als Referenz.',
  };
}
