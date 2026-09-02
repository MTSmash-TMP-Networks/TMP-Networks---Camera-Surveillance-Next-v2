import fs from 'node:fs';
import { inferMediaSourceKind } from './MediaSource.js';
import { CAMERA_RTSP_PORTS, CAMERA_TLS_PORTS, CAMERA_WEB_PORTS } from './CameraPortCatalog.js';

function readCatalog(relativePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
  } catch {
    return fallback;
  }
}

const baseCatalog = readCatalog('../../data/camera-path-catalog.json', { version: 0, families: [] });
const tmpDevicePackCatalog = readCatalog('../../data/tmp-device-pack-catalog.json', { version: 0, source: null, families: [] });
const catalog = {
  ...baseCatalog,
  families: [...(baseCatalog.families || []), ...(tmpDevicePackCatalog.families || [])],
};

const MANUFACTURER_ALIASES = new Map([
  ['hangzhou hikvision digital technology', 'hikvision'],
  ['hikvision digital technology', 'hikvision'],
  ['dahua technology', 'dahua'],
  ['zhejiang dahua technology', 'dahua'],
  ['axis communications ab', 'axis'],
  ['tp link', 'tp-link'],
  ['tplink', 'tp-link'],
  ['hanwha techwin', 'hanwha'],
  ['samsung techwin', 'samsung techwin'],
  ['xiongmai technology', 'xiongmai'],
  ['general', 'general'],
]);

function clean(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeManufacturer(value) {
  const normalized = clean(value);
  return MANUFACTURER_ALIASES.get(normalized) || normalized;
}

export function cameraFingerprint(camera) {
  const device = camera?.capabilities?.device || {};
  const manufacturer = String(device.manufacturer || '').trim();
  const model = String(device.model || '').trim();
  const firmwareVersion = String(device.firmwareVersion || '').trim();
  const hardwareId = String(device.hardwareId || '').trim();
  const manufacturerKey = normalizeManufacturer(manufacturer);
  const modelKey = clean(model);
  const modelSearch = model.toLowerCase();
  const modelCompact = modelSearch.replace(/[^a-z0-9]+/g, '');
  return {
    manufacturer: manufacturer || null,
    model: model || null,
    firmwareVersion: firmwareVersion || null,
    hardwareId: hardwareId || null,
    manufacturerKey,
    modelKey,
    modelSearch,
    modelCompact,
    displayName: [manufacturer, model].filter(Boolean).join(' ') || camera?.name || camera?.onvif?.ip || 'Unbekannte Kamera',
  };
}

function modelMatches(patterns, fingerprint) {
  if (!fingerprint.modelKey || !patterns?.length) return false;
  return patterns.some((pattern) => {
    try {
      const expression = new RegExp(pattern, 'i');
      return expression.test(fingerprint.modelSearch)
        || expression.test(fingerprint.modelKey)
        || expression.test(fingerprint.modelCompact);
    } catch {
      const needle = clean(pattern);
      return fingerprint.modelKey.includes(needle) || fingerprint.modelCompact.includes(needle.replace(/\s+/g, ''));
    }
  });
}

export function rankCatalogFamilies(fingerprint, { aggressive = false } = {}) {
  const ranked = [];
  for (const family of catalog.families || []) {
    const manufacturers = (family.manufacturers || []).map(normalizeManufacturer);
    const manufacturerMatch = Boolean(fingerprint.manufacturerKey && manufacturers.some((value) => value === fingerprint.manufacturerKey || fingerprint.manufacturerKey.includes(value) || value.includes(fingerprint.manufacturerKey)));
    const modelMatch = modelMatches(family.modelPatterns || [], fingerprint);
    if (!family.generic && !manufacturerMatch && !modelMatch && !aggressive) continue;
    let score = family.generic ? 10 : 0;
    if (manufacturerMatch) score += 70;
    if (modelMatch) score += 30;
    if (!manufacturerMatch && !modelMatch && aggressive) score += 2;
    ranked.push({ family, score, manufacturerMatch, modelMatch });
  }
  return ranked.sort((a, b) => b.score - a.score || a.family.name.localeCompare(b.family.name));
}

function portsForKind(kind, openPorts, cameraPort) {
  const available = new Set((openPorts || []).map(Number));
  const standards = kind === 'rtsp'
    ? CAMERA_RTSP_PORTS
    : kind === 'rtmp'
      ? [1935, 1936]
      : kind === 'https'
        ? CAMERA_TLS_PORTS.filter((port) => CAMERA_WEB_PORTS.includes(port))
        : [
            ...(CAMERA_WEB_PORTS.includes(Number(cameraPort)) ? [Number(cameraPort)] : []),
            ...CAMERA_WEB_PORTS,
          ];
  const unique = [...new Set(standards.filter((port) => Number.isInteger(port) && port > 0))];
  const filtered = available.size ? unique.filter((port) => available.has(port)) : unique;
  return filtered.length ? filtered : unique.slice(0, 1);
}

function protocolForPath(path) {
  if (path.protocol) return path.protocol;
  if (path.kind === 'rtsp') return 'rtsp';
  if (path.kind === 'rtmp') return 'rtmp';
  return 'http';
}

function defaultPort(protocol) {
  return ({ rtsp: 554, rtsps: 322, rtmp: 1935, rtmps: 443, http: 80, https: 443 })[protocol] || 80;
}

export function buildCatalogCandidates(camera, { openPorts = null, aggressive = false, maxCandidates = 140 } = {}) {
  const fingerprint = cameraFingerprint(camera);
  const matches = rankCatalogFamilies(fingerprint, { aggressive });
  const host = camera.onvif.ip.includes(':') ? `[${camera.onvif.ip}]` : camera.onvif.ip;
  const seen = new Set();
  const candidates = [];
  const catalogMatches = [];

  for (const match of matches) {
    let count = 0;
    for (const path of match.family.paths || []) {
      const protocol = protocolForPath(path);
      const kind = path.kind || inferMediaSourceKind(`${protocol}://${host}${path.path}`, 'auto');
      const portKind = protocol === 'https' ? 'https' : kind;
      const ports = portsForKind(portKind, openPorts, camera.onvif.port);
      for (const port of ports) {
        const effectiveProtocol = protocol === 'http' && CAMERA_TLS_PORTS.includes(port)
          ? 'https'
          : protocol === 'rtmp' && port === 443
            ? 'rtmps'
            : protocol;
        const includePort = port !== defaultPort(effectiveProtocol) || ['rtsp', 'rtsps', 'rtmp', 'rtmps'].includes(effectiveProtocol);
        const url = `${effectiveProtocol}://${host}${includePort ? `:${port}` : ''}${path.path.startsWith('/') ? path.path : `/${path.path}`}`;
        if (seen.has(url)) continue;
        seen.add(url);
        const confidence = Math.min(100, Number(path.confidence || 30) + Math.round(match.score * 0.12));
        candidates.push({
          label: `${match.family.name} · ${path.label}`,
          kind,
          priority: Math.max(5, 120 - confidence) + candidates.length,
          enabled: true,
          origin: 'catalog',
          url,
          catalogProvider: 'TMP Modellkatalog',
          catalogFamily: match.family.name,
          catalogRole: path.role || null,
          confidence,
          matchedBy: match.manufacturerMatch && match.modelMatch ? 'Hersteller und Modell' : match.manufacturerMatch ? 'Hersteller' : match.modelMatch ? 'Modell' : 'Generischer Pfad',
        });
        count += 1;
        if (candidates.length >= maxCandidates) break;
      }
      if (candidates.length >= maxCandidates) break;
    }
    if (count) catalogMatches.push({
      provider: 'TMP Modellkatalog',
      id: match.family.id,
      title: match.family.name,
      confidence: Math.min(100, 35 + match.score),
      matchedBy: match.manufacturerMatch && match.modelMatch ? 'Hersteller und Modell' : match.manufacturerMatch ? 'Hersteller' : match.modelMatch ? 'Modell' : 'Generische Fallback-Suche',
      candidateCount: count,
    });
    if (candidates.length >= maxCandidates) break;
  }
  return { fingerprint, candidates, catalogMatches };
}

export function catalogInfo() {
  return {
    version: catalog.version,
    updatedAt: catalog.updatedAt,
    familyCount: catalog.families?.length || 0,
    baseFamilyCount: baseCatalog.families?.length || 0,
    tmpDevicePack: {
      loaded: Boolean(tmpDevicePackCatalog.source && tmpDevicePackCatalog.families?.length),
      source: tmpDevicePackCatalog.source || null,
      updatedAt: tmpDevicePackCatalog.updatedAt || null,
      familyCount: tmpDevicePackCatalog.families?.length || 0,
      pathCount: tmpDevicePackCatalog.statistics?.pathCount || 0,
    },
  };
}
