import dgram from 'node:dgram';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { OnvifClient } from './onvif/OnvifClient.js';
import { AppError } from '../utils/errors.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  CAMERA_HTTP_PROBE_PATHS,
  CAMERA_ONVIF_HTTP_VENDOR_PORTS,
  CAMERA_RTSP_PORTS,
  CAMERA_TLS_PORTS,
  CAMERA_WEB_PORTS,
  DEFAULT_CAMERA_SCAN_PORTS,
} from './media/CameraPortCatalog.js';
import { classifyHostFingerprint, extractCameraModelFromPages, hasCameraIdentityText, isConfirmedOnvifServicePage } from './media/CameraHostClassifier.js';
import { applyFinalCameraDiscoveryPolicy } from './media/CameraDiscoveryPolicy.js';
import { isSafeSsdpLocation } from './media/DiscoveryUrlSafety.js';
import { probeOnvifHttpDeviceService } from './onvif/OnvifHttpProbe.js';

export { classifyHostFingerprint } from './media/CameraHostClassifier.js';
export { isSafeSsdpLocation } from './media/DiscoveryUrlSafety.js';

const DEFAULT_SCAN_PORTS = DEFAULT_CAMERA_SCAN_PORTS;
const CAMERA_USER_AGENT = `TMP-Camera-Surveillance/${config.appVersion}`;
const MAX_SCAN_HOSTS = 1024;
const SADP_ADDRESS = '239.255.255.250';
const SADP_PORT = 37020;
const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;

function xmlValue(text, name) {
  const match = String(text || '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() || null;
}


function ipv4ToInt(value) {
  const parts = String(value).trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function intToIpv4(value) {
  const number = Number(value) >>> 0;
  return [number >>> 24, (number >>> 16) & 255, (number >>> 8) & 255, number & 255].join('.');
}

function parseCidr(value, { allowPlainIp = true } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.includes('-')) return null;
  const [address, prefixText] = raw.includes('/') ? raw.split('/', 2) : [raw, allowPlainIp ? '32' : null];
  if (prefixText === null || prefixText === undefined) return null;
  const base = ipv4ToInt(address);
  const prefix = Number(prefixText);
  if (base === null || !Number.isInteger(prefix) || prefix < 16 || prefix > 32) return null;
  const count = 2 ** (32 - prefix);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = base & mask;
  const broadcast = (network + count - 1) >>> 0;
  return {
    raw,
    prefix,
    network,
    broadcast,
    cidr: `${intToIpv4(network)}/${prefix}`,
  };
}

function cidrContains(parent, child) {
  return parent.network <= child.network && parent.broadcast >= child.broadcast;
}

export function normalizeAutomaticScanRanges(ranges = [], { collapseHostRouteThreshold = config.discoveryAutoHostCollapseThreshold } = {}) {
  const unique = [...new Set((Array.isArray(ranges) ? ranges : String(ranges || '').split(/[\s,;]+/))
    .map((item) => String(item || '').trim())
    .filter(Boolean))];
  const parsed = unique.map((item) => parseCidr(item)).filter(Boolean);
  const keepHost = new Set(parsed.map((entry, index) => index));

  if (Number(collapseHostRouteThreshold || 0) > 0) {
    const groups = new Map();
    parsed.forEach((entry, index) => {
      if (entry.prefix !== 32) return;
      const subnet = parseCidr(`${intToIpv4(entry.network & 0xffffff00)}/24`);
      if (!subnet) return;
      const key = subnet.cidr;
      if (!groups.has(key)) groups.set(key, { subnet, indexes: [] });
      groups.get(key).indexes.push(index);
    });
    for (const group of groups.values()) {
      if (group.indexes.length >= collapseHostRouteThreshold && !parsed.some((entry) => entry.prefix < 32 && cidrContains(entry, group.subnet))) {
        parsed.push(group.subnet);
        for (const index of group.indexes) keepHost.delete(index);
      }
    }
  }

  const candidates = parsed
    .filter((_, index) => keepHost.has(index) || parsed[index]?.prefix !== 32)
    .sort((left, right) => left.network - right.network || left.prefix - right.prefix);
  const kept = [];
  for (const candidate of candidates) {
    if (kept.some((existing) => cidrContains(existing, candidate))) continue;
    kept.push(candidate);
  }
  return kept.map((entry) => entry.cidr);
}

export function expandScanTargets(input, maxHosts = MAX_SCAN_HOSTS) {
  const tokens = Array.isArray(input) ? input : String(input || '').split(/[\s,;]+/);
  const addresses = new Set();
  for (const raw of tokens.map((item) => String(item || '').trim()).filter(Boolean)) {
    if (raw.includes('/')) {
      const [address, prefixText] = raw.split('/');
      const base = ipv4ToInt(address);
      const prefix = Number(prefixText);
      if (base === null || !Number.isInteger(prefix) || prefix < 16 || prefix > 32) {
        throw new AppError(400, 'SCAN_RANGE_INVALID', `Ungültiges IPv4-Netz: ${raw}. Erlaubt sind Präfixe /16 bis /32.`);
      }
      const count = 2 ** (32 - prefix);
      if (count > maxHosts + 2) throw new AppError(400, 'SCAN_RANGE_TOO_LARGE', `Der Bereich ${raw} ist zu groß. Maximal ${maxHosts} Adressen pro Suche.`);
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      const network = base & mask;
      const first = prefix <= 30 ? network + 1 : network;
      const last = prefix <= 30 ? network + count - 2 : network + count - 1;
      for (let current = first; current <= last; current += 1) {
        addresses.add(intToIpv4(current));
        if (addresses.size > maxHosts) throw new AppError(400, 'SCAN_RANGE_TOO_LARGE', `Maximal ${maxHosts} Adressen sind pro Suche erlaubt.`);
      }
      continue;
    }
    if (raw.includes('-')) {
      const [left, right] = raw.split('-', 2).map((item) => item.trim());
      const start = ipv4ToInt(left);
      let end = ipv4ToInt(right);
      if (start !== null && end === null && /^\d{1,3}$/.test(right)) {
        const parts = left.split('.');
        parts[3] = right;
        end = ipv4ToInt(parts.join('.'));
      }
      if (start === null || end === null || end < start) throw new AppError(400, 'SCAN_RANGE_INVALID', `Ungültiger IP-Bereich: ${raw}`);
      if (end - start + 1 > maxHosts) throw new AppError(400, 'SCAN_RANGE_TOO_LARGE', `Der Bereich ${raw} ist zu groß.`);
      for (let current = start; current <= end; current += 1) {
        addresses.add(intToIpv4(current));
        if (addresses.size > maxHosts) throw new AppError(400, 'SCAN_RANGE_TOO_LARGE', `Maximal ${maxHosts} Adressen sind pro Suche erlaubt.`);
      }
      continue;
    }
    if (ipv4ToInt(raw) === null) throw new AppError(400, 'SCAN_RANGE_INVALID', `Ungültige IPv4-Adresse: ${raw}`);
    addresses.add(raw);
    if (addresses.size > maxHosts) throw new AppError(400, 'SCAN_RANGE_TOO_LARGE', `Maximal ${maxHosts} Adressen sind pro Suche erlaubt.`);
  }
  return [...addresses];
}

function portOpen(host, port, timeoutMs = 650) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: Number(port) });
    let settled = false;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      output[current] = await mapper(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
  return output;
}

function requestPage(url, timeoutMs = 1600, maxBytes = 256 * 1024) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(url); } catch { resolve(null); return; }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) { resolve(null); return; }
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.get(parsed, {
      rejectUnauthorized: false,
      timeout: timeoutMs,
      headers: {
        'User-Agent': CAMERA_USER_AGENT,
        Accept: 'text/html,application/xml,text/xml,application/json,*/*;q=0.2',
        Connection: 'close',
      },
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        if (size >= maxBytes) return;
        const remaining = maxBytes - size;
        chunks.push(chunk.subarray(0, remaining));
        size += Math.min(chunk.length, remaining);
      });
      response.on('end', () => resolve({
        statusCode: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        url: parsed.toString(),
      }));
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });
}

function parseSadpPacket(packet, remoteAddress = null) {
  const text = Buffer.isBuffer(packet) ? packet.toString('utf8') : String(packet || '');
  if (!/<ProbeMatch(?:\s|>)/i.test(text)) return null;
  const ip = xmlValue(text, 'IPv4Address') || remoteAddress;
  if (!ip || ipv4ToInt(ip) === null) return null;
  const model = xmlValue(text, 'DeviceType') || xmlValue(text, 'DeviceDescription') || null;
  const httpPort = Number(xmlValue(text, 'HttpPort') || 80);
  const commandPort = Number(xmlValue(text, 'CommandPort') || 8000);
  const sdkTlsPort = Number(xmlValue(text, 'SDKOverTLSPort') || 0);
  const ports = [httpPort, commandPort, sdkTlsPort, 554].filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
  return {
    ip,
    port: httpPort,
    name: model || `Hikvision ${ip}`,
    manufacturer: 'Hikvision',
    model,
    serialNumber: xmlValue(text, 'DeviceSN'),
    deviceUid: xmlValue(text, 'DeviceSN') || xmlValue(text, 'Uuid') || null,
    firmware: xmlValue(text, 'SoftwareVersion'),
    macAddress: xmlValue(text, 'MAC')?.replaceAll('-', ':').toUpperCase() || null,
    activated: String(xmlValue(text, 'Activated') || '').toLowerCase() === 'true',
    verified: true,
    likelyCamera: true,
    cameraCandidate: true,
    sadpVerified: true,
    onvifAvailable: false,
    evidence: 'Hikvision SADP',
    discoveryMethods: ['sadp'],
    openPorts: [...new Set(ports)],
    confidence: 100,
  };
}

export { parseSadpPacket };

async function discoverSadp(timeoutMs = 3500) {
  return new Promise((resolve) => {
    const devices = new Map();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch { /* ignore */ }
      resolve([...devices.values()]);
    };
    socket.on('error', finish);
    socket.on('message', (message, remote) => {
      const device = parseSadpPacket(message, remote.address);
      if (device) devices.set(device.macAddress || device.ip, device);
    });
    socket.bind(0, '0.0.0.0', () => {
      try { socket.setBroadcast(true); } catch { /* ignore */ }
      try { socket.setMulticastTTL(2); } catch { /* ignore */ }
      const uuid = crypto.randomUUID();
      const probes = [
        `<?xml version="1.0" encoding="utf-8"?><Probe><Uuid>${uuid}</Uuid><Types>inquiry</Types></Probe>`,
        `<?xml version="1.0" encoding="utf-8"?><Probe><Uuid>${uuid}</Uuid><Types>inquiry_v32</Types></Probe>`,
      ];
      for (const probe of probes) {
        socket.send(Buffer.from(probe), SADP_PORT, SADP_ADDRESS, () => {});
        socket.send(Buffer.from(probe), SADP_PORT, '255.255.255.255', () => {});
      }
      setTimeout(finish, timeoutMs).unref();
    });
  });
}

function parseSsdpHeaders(value) {
  const lines = String(value || '').split(/\r?\n/);
  const headers = {};
  for (const line of lines.slice(1)) {
    const at = line.indexOf(':');
    if (at > 0) headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return headers;
}

async function fetchSsdpDescription(location, remoteAddress = null) {
  if (!isSafeSsdpLocation(location, remoteAddress)) return null;
  const response = await requestPage(location, 2200, 512 * 1024);
  if (!response || response.statusCode < 200 || response.statusCode >= 400) return null;
  const body = response.body;
  const parsed = new URL(location);
  const ip = parsed.hostname;
  const manufacturer = xmlValue(body, 'manufacturer');
  const model = xmlValue(body, 'modelName') || xmlValue(body, 'modelNumber');
  const friendlyName = xmlValue(body, 'friendlyName');
  const deviceType = xmlValue(body, 'deviceType') || '';
  const combined = `${manufacturer || ''} ${model || ''} ${friendlyName || ''} ${deviceType}`;
  const clearlyNonCamera = /\b(?:router|switch|gateway|access\s+point|media\s+renderer|smart\s*tv|television|speaker|printer|nas|storage)\b/i.test(combined);
  const likelyCamera = hasCameraIdentityText(combined) && !clearlyNonCamera;
  if (!likelyCamera) return null;
  return {
    ip,
    port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
    name: friendlyName || model || null,
    manufacturer: manufacturer || null,
    model: model || null,
    verified: true,
    likelyCamera: true,
    cameraCandidate: true,
    ssdpVerified: true,
    onvifAvailable: false,
    evidence: 'Kameraspezifische UPnP/SSDP-Beschreibung',
    discoveryMethods: ['ssdp'],
    openPorts: [Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))],
    confidence: 86,
  };
}

async function discoverSsdp(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const locations = new Map();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let settled = false;
    const finish = async () => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch { /* ignore */ }
      const descriptions = await mapLimit(
        [...locations.entries()].slice(0, 80),
        8,
        ([location, remoteAddress]) => fetchSsdpDescription(location, remoteAddress),
      );
      resolve(descriptions.filter(Boolean));
    };
    socket.on('error', () => finish());
    socket.on('message', (message, remote) => {
      const headers = parseSsdpHeaders(message.toString('utf8'));
      if (headers.location && isSafeSsdpLocation(headers.location, remote.address)) {
        locations.set(headers.location, remote.address);
      }
    });
    socket.bind(0, '0.0.0.0', () => {
      const probe = Buffer.from([
        'M-SEARCH * HTTP/1.1',
        `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
        'MAN: "ssdp:discover"',
        'MX: 2',
        'ST: ssdp:all',
        '', '',
      ].join('\r\n'));
      socket.send(probe, SSDP_PORT, SSDP_ADDRESS, () => {});
      setTimeout(finish, timeoutMs).unref();
    });
  });
}


function probeRtspRequest(host, port, requestText, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: Number(port) });
    let settled = false;
    let data = '';
    const finish = (confirmed, detail = null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ port: Number(port), confirmed, detail });
    };
    socket.setTimeout(timeoutMs, () => finish(false, 'timeout'));
    socket.once('connect', () => {
      socket.write(requestText);
    });
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8');
      if (/^RTSP\/1\.[01]\s+\d{3}/m.test(data)) finish(true, data.slice(0, 240));
      else if (data.length > 2048) finish(false, data.slice(0, 240));
    });
    socket.once('end', () => finish(/^RTSP\/1\.[01]\s+\d{3}/m.test(data), data.slice(0, 240)));
    socket.once('error', () => finish(false, 'error'));
  });
}

async function probeRtsp(host, port, timeoutMs = 1600) {
  const optionsTimeout = Math.max(450, Math.round(timeoutMs * 0.55));
  const options = await probeRtspRequest(
    host,
    port,
    `OPTIONS rtsp://${host}:${port}/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: ${CAMERA_USER_AGENT}\r\n\r\n`,
    optionsTimeout,
  );
  if (options.confirmed) return options;

  // Einige Kamera-Firmwares ignorieren OPTIONS, antworten aber korrekt auf DESCRIBE
  // (typischerweise mit 401, 404 oder einer SDP-Antwort). Jede RTSP-Statuszeile
  // bestätigt den Dienst, unabhängig davon, ob Zugangsdaten erforderlich sind.
  const describe = await probeRtspRequest(
    host,
    port,
    `DESCRIBE rtsp://${host}:${port}/ RTSP/1.0\r\nCSeq: 2\r\nAccept: application/sdp\r\nUser-Agent: ${CAMERA_USER_AGENT}\r\n\r\n`,
    Math.max(550, timeoutMs - optionsTimeout),
  );
  return describe.confirmed ? describe : { ...describe, detail: `${options.detail || 'keine OPTIONS-Antwort'}; ${describe.detail || 'keine DESCRIBE-Antwort'}` };
}

export function preferredCameraPort(openPorts = [], onvifPort = null) {
  const available = new Set(openPorts.map(Number).filter(Number.isInteger));
  if (Number.isInteger(Number(onvifPort)) && available.has(Number(onvifPort))) return Number(onvifPort);
  const priority = [80, 8080, 81, 82, 83, 88, 443, 8443, 8081, 8082, 8088, 8888, 10080, 8899, 2020, 5000];
  return priority.find((port) => available.has(port))
    || openPorts.find((port) => CAMERA_WEB_PORTS.includes(Number(port)))
    || openPorts[0]
    || 80;
}

async function fingerprintHost(ip, openPorts, discoveryMethod = 'ip-range', { includeNonCandidate = false } = {}) {
  const webPorts = openPorts.filter((port) => CAMERA_WEB_PORTS.includes(Number(port)) || [2020, 8899].includes(Number(port))).slice(0, 8);
  const pages = [];
  for (const port of webPorts) {
    const preferredScheme = CAMERA_TLS_PORTS.includes(Number(port)) ? 'https' : 'http';
    const schemes = [preferredScheme, preferredScheme === 'https' ? 'http' : 'https'];
    for (const scheme of schemes) {
      const base = `${scheme}://${ip}:${port}`;
      const responses = await mapLimit(CAMERA_HTTP_PROBE_PATHS, 4, (path) => requestPage(`${base}${path}`));
      const valid = responses.filter(Boolean);
      if (valid.length) {
        pages.push(...valid);
        break;
      }
    }
  }
  // TCP 8000 serves ONVIF on newer Reolink models, but is a proprietary
  // SDK service on many Hikvision devices. Probe only the ONVIF HTTP endpoint
  // on an already open port, and accept it only with SOAP/camera auth evidence.
  // Keep the ordinary web-port scan unchanged so this does not confuse the
  // Hikvision SDK with a web server or incorrectly mark a device as a camera.
  for (const port of CAMERA_ONVIF_HTTP_VENDOR_PORTS) {
    if (!openPorts.includes(port)) continue;
    // ONVIF is a SOAP POST service. GET-only probing can return 405 even when
    // the device is healthy and accepts authenticated ONVIF requests.
    const onvifUrl = `http://${ip}:${port}/onvif/device_service`;
    const soapResponse = await probeOnvifHttpDeviceService(ip, port, 1600);
    if (soapResponse) pages.push(soapResponse);
    if (!isConfirmedOnvifServicePage(soapResponse) && (!soapResponse || [404, 405].includes(soapResponse.statusCode))) {
      // Some vendor firmware does expose a useful GET challenge. Only a
      // confirmed ONVIF response will be accepted by the classifier.
      const getResponse = await requestPage(onvifUrl, 800);
      if (getResponse) pages.push(getResponse);
    }
  }
  const plainRtspPorts = openPorts
    .filter((port) => CAMERA_RTSP_PORTS.includes(Number(port)) && !CAMERA_TLS_PORTS.includes(Number(port)))
    .slice(0, 6);
  const rtspServices = await mapLimit(plainRtspPorts, 4, (port) => probeRtsp(ip, port));
  const classification = classifyHostFingerprint({ openPorts, pages, rtspServices });
  // Preserve an explicit non-camera fingerprint for the final merge gate.
  // This prevents a parallel WS-Discovery/SSDP record from resurrecting a
  // server BMC, router or management appliance after the active scan rejected it.
  if (!classification.candidate && !includeNonCandidate && !classification.nonCameraDevice) return null;
  const model = extractCameraModelFromPages(pages, classification.manufacturer);
  const verifiedOnvifPages = pages.filter((page) => isConfirmedOnvifServicePage(page, classification.nonCameraDevice));
  // Prefer the confirmed Reolink ONVIF endpoint on 8000 if several services
  // answer. Do not replace a valid WS-Discovery XAddr with a guessed port.
  const onvifPage = /reolink/i.test(String(classification.manufacturer || ''))
    ? verifiedOnvifPages.find((page) => { try { return Number(new URL(page.url).port) === 8000; } catch { return false; } }) || verifiedOnvifPages[0]
    : verifiedOnvifPages[0] || null;
  let onvifPort = null;
  try { onvifPort = onvifPage ? Number(new URL(onvifPage.url).port || (new URL(onvifPage.url).protocol === 'https:' ? 443 : 80)) : null; } catch { onvifPort = null; }
  const preferredWebPort = preferredCameraPort(openPorts, onvifPort);
  return {
    ip,
    port: preferredWebPort || 80,
    name: model || classification.manufacturer || null,
    manufacturer: classification.manufacturer,
    model,
    verified: classification.verified,
    likelyCamera: classification.likelyCamera,
    cameraCandidate: classification.candidate,
    onvifAvailable: classification.onvifEvidence,
    onvifHttpEvidence: classification.onvifEvidence,
    vendorEndpointEvidence: classification.vendorEndpointEvidence,
    directCameraProtocolEvidence: classification.cameraProtocolEvidence,
    strongPortCombinationEvidence: classification.strongPortCombinationEvidence,
    nonCameraDevice: Boolean(classification.nonCameraDevice),
    rtspConfirmed: classification.rtspConfirmed || [],
    onvifPort,
    xaddr: onvifPage?.url || null,
    evidence: classification.evidence.join(' · ') || 'Kameratypische Netzwerkdienste erkannt',
    evidences: classification.evidence,
    discoveryMethods: [discoveryMethod],
    openPorts,
    confidence: classification.confidence,
  };
}

export async function scanOpenCameraPorts(targets, ports = DEFAULT_SCAN_PORTS, timeoutMs = config.discoveryPortTimeoutMs, options = {}) {
  if (!targets.length) return null;
  const requestedPorts = [...new Set(ports.map(Number).filter((port) => Number.isInteger(port) && port > 0 && port <= 65535))].slice(0, 40);
  const total = targets.length * requestedPorts.length;
  const totalConcurrency = Math.min(512, Math.max(4, Number(options.concurrency || config.discoveryScanConcurrency)));
  const perHostConcurrency = Math.min(16, Math.max(1, Number(options.perHostConcurrency || config.discoveryPerHostConcurrency)));
  const hostConcurrency = Math.max(1, Math.min(targets.length, Math.floor(totalConcurrency / perHostConcurrency) || 1));
  let completed = 0;
  const byHost = new Map();

  // Bound simultaneous sockets both globally and per target. This avoids
  // opening all camera ports against one host at once while still scanning
  // independent hosts in parallel.
  await mapLimit(targets, hostConcurrency, async (ip) => {
    const hits = await mapLimit(requestedPorts, perHostConcurrency, async (port) => {
      const open = await portOpen(ip, port, timeoutMs);
      completed += 1;
      if (completed === total || completed % Math.max(25, Math.round(total / 100)) === 0) {
        options.onProgress?.({ stage: 'ports', completed, total, hosts: targets.length, ports: requestedPorts.length, hostConcurrency, perHostConcurrency });
      }
      return { port, open };
    });
    const openPorts = hits.filter((hit) => hit.open).map((hit) => hit.port);
    if (openPorts.length) byHost.set(ip, new Set(openPorts));
  });
  return byHost;
}


function runProcess(command, args, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 6 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, error, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function parseNmapGrepable(stdout) {
  const byHost = new Map();
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const hostMatch = line.match(/^Host:\s+([0-9.]+)\s/);
    if (!hostMatch || !/Ports:/i.test(line)) continue;
    const portsText = line.slice(line.indexOf('Ports:') + 6);
    const openPorts = [];
    for (const entry of portsText.split(',')) {
      const match = entry.trim().match(/^(\d+)\/open\/tcp\b/i);
      if (match) openPorts.push(Number(match[1]));
    }
    if (openPorts.length) byHost.set(hostMatch[1], new Set(openPorts));
  }
  return byHost;
}

function parseNmapUpHosts(stdout) {
  const hosts = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const match = line.match(/^Host:\s+([0-9.]+)\s+.*Status:\s+Up\b/i);
    if (match && ipv4ToInt(match[1]) !== null) hosts.push(match[1]);
  }
  return [...new Set(hosts)];
}

function selectedHostDiscoveryPorts() {
  const configured = Array.isArray(config.discoveryHostDiscoveryPorts) ? config.discoveryHostDiscoveryPorts : [];
  const defaults = [80, 443, 554, 8000, 8080, 8443, 8554, 8899, 10554, 37777, 34567, 7681];
  const preferred = configured.length ? configured : defaults;
  return [...new Set(preferred.map(Number))]
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535)
    .slice(0, 16);
}

async function discoverActiveHostsInternal(targets, ports = DEFAULT_SCAN_PORTS, timeoutMs = config.discoveryHostDiscoveryTimeoutMs, options = {}) {
  if (!targets.length) return [];
  const probePorts = selectedHostDiscoveryPorts(ports);
  const total = targets.length * probePorts.length;
  const concurrency = Math.min(512, Math.max(4, Number(options.concurrency || config.discoveryScanConcurrency)));
  let completed = 0;
  const active = [];
  options.onProgress?.({ stage: 'host-discovery', engine: 'internal', hosts: targets.length, ports: probePorts.length, state: 'running' });
  await mapLimit(targets, Math.min(targets.length, concurrency), async (ip) => {
    for (const port of probePorts) {
      const open = await portOpen(ip, port, timeoutMs);
      completed += 1;
      if (completed === total || completed % Math.max(25, Math.round(total / 50)) === 0) {
        options.onProgress?.({ stage: 'host-discovery', engine: 'internal', completed, total, activeHosts: active.length });
      }
      if (open) {
        active.push(ip);
        break;
      }
    }
  });
  const unique = [...new Set(active)];
  options.onProgress?.({ stage: 'host-discovery', engine: 'internal', hosts: targets.length, activeHosts: unique.length, state: 'completed' });
  return unique;
}

async function discoverActiveHostsWithNmap(ranges, ports = DEFAULT_SCAN_PORTS, options = {}) {
  const normalizedRanges = normalizeAutomaticScanRanges(ranges, { collapseHostRouteThreshold: config.discoveryAutoHostCollapseThreshold });
  if (!normalizedRanges.length) return null;
  const nmapPath = String(config.discoveryNmapPath || 'nmap');
  const probePorts = selectedHostDiscoveryPorts(ports);
  const hostTimeout = `${Math.max(3, Math.min(15, Math.ceil(Number(config.discoveryHostDiscoveryTimeoutMs || 350) / 1000) * Math.max(3, Math.ceil(probePorts.length / 3))))}s`;
  const args = [
    '-n', '-sn', '-T4', '--max-retries', '1', '--host-timeout', hostTimeout,
    `-PS${probePorts.join(',')}`, `-PA${probePorts.join(',')}`, '-oG', '-', ...normalizedRanges,
  ];
  options.onProgress?.({ stage: 'host-discovery', engine: 'nmap', ranges: normalizedRanges.length, ports: probePorts.length, state: 'running' });
  const result = await runProcess(nmapPath, args, { timeoutMs: Math.max(10_000, Math.min(Number(config.discoveryNmapTimeoutMs || 120_000), 180_000)) });
  if (!result.ok) {
    const code = result.error?.code || result.error?.signal || 'NMAP_HOST_DISCOVERY_FAILED';
    logger.warn({ code, stderr: result.stderr.slice(0, 400) }, 'Nmap-Hosterkennung ist fehlgeschlagen; interner Schnellscan wird verwendet');
    return null;
  }
  const activeHosts = parseNmapUpHosts(result.stdout);
  options.onProgress?.({ stage: 'host-discovery', engine: 'nmap', ranges: normalizedRanges.length, activeHosts: activeHosts.length, state: 'completed' });
  return activeHosts;
}

async function scanOpenCameraPortsOnActiveHosts(targets, ports = DEFAULT_SCAN_PORTS, timeoutMs = config.discoveryPortTimeoutMs, options = {}) {
  if (!targets.length) return new Map();
  const activeHosts = await discoverActiveHostsInternal(targets, ports, Math.min(timeoutMs, config.discoveryHostDiscoveryTimeoutMs), options);
  if (!activeHosts.length) {
    if (targets.length <= Number(config.discoveryFullScanFallbackHostLimit || 0)) {
      options.onProgress?.({ stage: 'ports', engine: 'internal', mode: 'small-range-full-fallback', hosts: targets.length, state: 'running' });
      return scanOpenCameraPorts(targets, ports, timeoutMs, options);
    }
    return new Map();
  }
  options.onProgress?.({ stage: 'ports', engine: 'internal', mode: 'active-hosts-only', hosts: activeHosts.length, skippedHosts: Math.max(0, targets.length - activeHosts.length), state: 'running' });
  return scanOpenCameraPorts(activeHosts, ports, timeoutMs, options);
}

export async function scanOpenCameraPortsWithNmap(ranges, ports = DEFAULT_SCAN_PORTS, timeoutMs = config.discoveryPortTimeoutMs, options = {}) {
  const normalizedRanges = normalizeAutomaticScanRanges(ranges, { collapseHostRouteThreshold: config.discoveryAutoHostCollapseThreshold });
  if (!normalizedRanges.length) return null;
  const requestedPorts = [...new Set(ports.map(Number).filter((port) => Number.isInteger(port) && port > 0 && port <= 65535))].slice(0, 40);
  if (!requestedPorts.length) return new Map();
  const nmapPath = String(config.discoveryNmapPath || 'nmap');
  let activeHosts = await discoverActiveHostsWithNmap(normalizedRanges, requestedPorts, options);
  if (activeHosts === null) return null;
  if (!activeHosts.length && options.targets?.length) {
    activeHosts = await discoverActiveHostsInternal(options.targets, requestedPorts, Math.min(timeoutMs, config.discoveryHostDiscoveryTimeoutMs), options);
  }
  if (!activeHosts.length) {
    options.onProgress?.({ stage: 'ports', engine: 'nmap', hostsWithOpenPorts: 0, activeHosts: 0, skippedFullRangePortScan: true, state: 'completed' });
    return new Map();
  }
  const timeoutSeconds = Math.max(2, Math.ceil(Number(timeoutMs || 600) / 1000));
  const hostTimeout = `${Math.max(6, Math.min(45, timeoutSeconds * Math.max(4, Math.ceil(requestedPorts.length / 4))))}s`;
  const args = [
    '-n', '-sT', '-Pn', '-T4', '--open', '--max-retries', '1', '--host-timeout', hostTimeout,
    '--defeat-rst-ratelimit', '-p', requestedPorts.join(','), '-oG', '-', ...activeHosts,
  ];
  options.onProgress?.({ stage: 'ports', engine: 'nmap', mode: 'active-hosts-only', activeHosts: activeHosts.length, ports: requestedPorts.length, skippedHosts: Math.max(0, Number(options.targets?.length || 0) - activeHosts.length), state: 'running' });
  const result = await runProcess(nmapPath, args, { timeoutMs: Math.max(15_000, Number(config.discoveryNmapTimeoutMs || 120_000)) });
  if (!result.ok) {
    const code = result.error?.code || result.error?.signal || 'NMAP_SCAN_FAILED';
    logger.warn({ code, stderr: result.stderr.slice(0, 400) }, 'Nmap-Kameraportscan ist fehlgeschlagen; interner Schnellscan wird verwendet');
    return null;
  }
  const byHost = parseNmapGrepable(result.stdout);
  options.onProgress?.({ stage: 'ports', engine: 'nmap', hostsWithOpenPorts: byHost.size, activeHosts: activeHosts.length, ports: requestedPorts.length, state: 'completed' });
  return byHost;
}

async function activeRangeScan(targets, ports = DEFAULT_SCAN_PORTS, timeoutMs = config.discoveryPortTimeoutMs, discoveryMethod = 'ip-range', options = {}) {
  let byHost = null;
  const engine = String(config.discoveryScanEngine || 'auto').toLowerCase();
  if (engine !== 'internal' && options.scanRanges?.length) {
    byHost = await scanOpenCameraPortsWithNmap(options.scanRanges, ports, timeoutMs, { ...options, targets });
  }
  if (!byHost) byHost = await scanOpenCameraPortsOnActiveHosts(targets, ports, timeoutMs, options);
  let completed = 0;
  const entries = [...byHost.entries()];
  const result = await mapLimit(entries, Math.max(1, Number(options.fingerprintConcurrency || config.discoveryFingerprintConcurrency)), async ([ip, openPorts]) => {
    const device = await fingerprintHost(ip, [...openPorts].sort((a, b) => a - b), discoveryMethod);
    completed += 1;
    options.onProgress?.({ stage: 'fingerprint', completed, total: entries.length, hostsWithOpenPorts: entries.length });
    return device;
  });
  return result.filter(Boolean);
}

export function configuredAutomaticRanges() {
  const configured = [...new Set([...(config.hostScanRanges || []), ...(config.autoHostScanRanges || [])])];
  const normalized = normalizeAutomaticScanRanges(configured, { collapseHostRouteThreshold: config.discoveryAutoHostCollapseThreshold });
  const valid = [];
  for (const value of normalized) {
    try {
      const targets = expandScanTargets(value);
      if (targets.length) valid.push(value);
    } catch { /* fehlerhafte Host-Route ignorieren */ }
  }
  return valid;
}

export function expandAutomaticTargets(ranges = configuredAutomaticRanges(), maxHosts = MAX_SCAN_HOSTS) {
  const addresses = new Set();
  for (const value of ranges) {
    if (addresses.size >= maxHosts) break;
    try {
      const targets = expandScanTargets(value, maxHosts);
      for (const target of targets) {
        addresses.add(target);
        if (addresses.size >= maxHosts) break;
      }
    } catch { /* zu große oder fehlerhafte Route überspringen */ }
  }
  return [...addresses];
}

function mergeDevice(target, incoming) {
  if (!target) return { ...incoming, openPorts: [...new Set(incoming.openPorts || [])], discoveryMethods: [...new Set(incoming.discoveryMethods || [])] };
  const stronger = Number(incoming.confidence || 0) > Number(target.confidence || 0) ? incoming : target;
  return {
    ...target,
    ...stronger,
    ip: target.ip || incoming.ip,
    port: stronger.port || target.port || incoming.port || 80,
    name: stronger.name || target.name || incoming.name,
    manufacturer: stronger.manufacturer || target.manufacturer || incoming.manufacturer || null,
    model: stronger.model || target.model || incoming.model || null,
    serialNumber: target.serialNumber || incoming.serialNumber || null,
    deviceUid: target.deviceUid || incoming.deviceUid || null,
    xaddr: target.xaddr || incoming.xaddr || null,
    firmware: target.firmware || incoming.firmware || null,
    macAddress: target.macAddress || incoming.macAddress || null,
    verified: Boolean(target.verified || incoming.verified),
    likelyCamera: Boolean(target.likelyCamera || incoming.likelyCamera),
    cameraCandidate: Boolean(target.cameraCandidate || incoming.cameraCandidate),
    onvifAvailable: Boolean(target.onvifAvailable || incoming.onvifAvailable),
    onvifDiscoveryVerified: Boolean(target.onvifDiscoveryVerified || incoming.onvifDiscoveryVerified),
    onvifHttpEvidence: Boolean(target.onvifHttpEvidence || incoming.onvifHttpEvidence),
    vendorEndpointEvidence: Boolean(target.vendorEndpointEvidence || incoming.vendorEndpointEvidence),
    directCameraProtocolEvidence: Boolean(target.directCameraProtocolEvidence || incoming.directCameraProtocolEvidence),
    strongPortCombinationEvidence: Boolean(target.strongPortCombinationEvidence || incoming.strongPortCombinationEvidence),
    nonCameraDevice: Boolean(target.nonCameraDevice || incoming.nonCameraDevice),
    sadpVerified: Boolean(target.sadpVerified || incoming.sadpVerified),
    ssdpVerified: Boolean(target.ssdpVerified || incoming.ssdpVerified),
    rtspConfirmed: [...new Set([...(target.rtspConfirmed || []), ...(incoming.rtspConfirmed || [])].map(Number).filter(Number.isInteger))],
    openPorts: [...new Set([...(target.openPorts || []), ...(incoming.openPorts || [])])].sort((a, b) => a - b),
    discoveryMethods: [...new Set([...(target.discoveryMethods || []), ...(incoming.discoveryMethods || [])])],
    confidence: Math.max(Number(target.confidence || 0), Number(incoming.confidence || 0)),
    evidences: [...new Set([...(target.evidences || [target.evidence]).filter(Boolean), ...(incoming.evidences || [incoming.evidence]).filter(Boolean)])],
  };
}

export { applyFinalCameraDiscoveryPolicy } from './media/CameraDiscoveryPolicy.js';

export class NetworkCameraDiscovery {
  static automaticRanges() { return configuredAutomaticRanges(); }

  static async inspectHost(ip, { ports = DEFAULT_SCAN_PORTS, timeoutMs = 750 } = {}) {
    if (ipv4ToInt(ip) === null) throw new AppError(400, 'CAMERA_IP_INVALID', `Ungültige IPv4-Adresse: ${ip}`);
    const byHost = await scanOpenCameraPorts([ip], ports, Math.max(300, Math.min(1500, timeoutMs)));
    const openPorts = [...(byHost.get(ip) || [])].sort((a, b) => a - b);
    if (!openPorts.length) {
      return { ip, port: 80, openPorts: [], reachable: false, cameraCandidate: false, confidence: 0 };
    }
    const fingerprint = await fingerprintHost(ip, openPorts, 'manual-ip', { includeNonCandidate: true });
    return {
      ip,
      port: fingerprint?.port || preferredCameraPort(openPorts),
      openPorts,
      reachable: true,
      ...(fingerprint || { cameraCandidate: false, confidence: 0 }),
    };
  }

  static async discoverDetailed({
    timeoutMs = config.discoveryAutoTimeoutMs,
    includeUnverified = false,
    scanRanges = [],
    activeScan = false,
    ports = DEFAULT_SCAN_PORTS,
    onProgress = null,
    retries = config.discoveryProtocolRetries,
    scanConcurrency = config.discoveryScanConcurrency,
    perHostConcurrency = config.discoveryPerHostConcurrency,
    fingerprintConcurrency = config.discoveryFingerprintConcurrency,
    portTimeoutMs = config.discoveryPortTimeoutMs,
  } = {}) {
    const startedAt = Date.now();
    const selectedRanges = activeScan
      ? scanRanges
      : [...new Set([...configuredAutomaticRanges(), ...(Array.isArray(scanRanges) ? scanRanges : [])])];
    let targets = [];
    try {
      targets = selectedRanges.length ? (activeScan ? expandScanTargets(selectedRanges) : expandAutomaticTargets(selectedRanges)) : [];
    } catch (error) {
      if (activeScan) throw error;
      logger.warn({ error: error.message }, 'Automatischer Kamera-Scan hat einen ungueltigen Hostbereich uebersprungen');
    }
    const scanMethod = activeScan ? 'ip-range' : 'host-route-scan';
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const runTask = async (name, task) => {
      const taskStartedAt = Date.now();
      let lastError = null;
      for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
        onProgress?.({ stage: 'protocol', protocol: name, state: 'running', attempt, attempts: retries + 1 });
        try {
          const items = await task();
          const result = { name, state: 'completed', attempts: attempt, durationMs: Date.now() - taskStartedAt, count: items.length, items };
          onProgress?.({ stage: 'protocol', protocol: name, state: 'completed', count: items.length, attempt });
          return result;
        } catch (error) {
          lastError = error;
          const code = error?.code || error?.name || 'DISCOVERY_PROTOCOL_FAILED';
          logger.warn({ protocol: name, attempt, attempts: retries + 1, code, err: error }, 'Kamera-Suchprotokoll ist fehlgeschlagen');
          onProgress?.({ stage: 'protocol', protocol: name, state: attempt <= retries ? 'retrying' : 'failed', attempt, error: code });
          if (attempt <= retries) await delay(config.discoveryRetryDelayMs * attempt);
        }
      }
      return {
        name, state: 'failed', attempts: retries + 1, durationMs: Date.now() - taskStartedAt, count: 0, items: [],
        error: { code: lastError?.code || 'DISCOVERY_PROTOCOL_FAILED', message: 'Suchprotokoll konnte nicht ausgeführt werden' },
      };
    };

    onProgress?.({ stage: 'starting', targets: targets.length, ranges: selectedRanges.length });
    const portTimeout = Math.max(150, Math.min(5000, Number(portTimeoutMs || Math.round(timeoutMs / 16))));
    const protocols = await Promise.all([
      runTask('onvif', () => OnvifClient.discover(Math.min(timeoutMs, 10_000), { includeUnverified: true })),
      runTask('sadp', () => discoverSadp(Math.min(timeoutMs, 5000))),
      runTask('ssdp', () => discoverSsdp(Math.min(timeoutMs, 4500))),
      runTask(scanMethod, () => activeRangeScan(targets, ports, portTimeout, scanMethod, {
        scanRanges: selectedRanges,
        concurrency: scanConcurrency,
        perHostConcurrency,
        fingerprintConcurrency,
        onProgress,
      })),
    ]);

    const devices = new Map();
    const onvif = protocols.find((entry) => entry.name === 'onvif')?.items || [];
    for (const device of onvif) {
      const normalized = {
        ...device,
        manufacturer: device.manufacturer || null,
        model: device.model || device.name || null,
        likelyCamera: Boolean(device.verified),
        cameraCandidate: Boolean(device.verified),
        onvifDiscoveryVerified: Boolean(device.onvifDiscoveryVerified || device.verified),
        // WS-Discovery announces an ONVIF endpoint but does not prove that the
        // endpoint is usable. The active HTTP fingerprint upgrades this to true.
        onvifAvailable: false,
        discoveryMethods: ['onvif'],
        openPorts: [Number(device.port || 80)],
        confidence: device.verified ? 100 : 25,
      };
      devices.set(normalized.ip, mergeDevice(devices.get(normalized.ip), normalized));
    }
    for (const protocol of protocols.filter((entry) => entry.name !== 'onvif')) {
      for (const device of protocol.items) devices.set(device.ip, mergeDevice(devices.get(device.ip), device));
    }
    const items = [...devices.values()]
      .map((device) => applyFinalCameraDiscoveryPolicy(device))
      .filter((device) => device.likelyCamera || device.verified || (includeUnverified && device.cameraCandidate && Number(device.confidence || 0) >= 45))
      .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0) || a.ip.localeCompare(b.ip, undefined, { numeric: true }));
    const diagnostics = {
      durationMs: Date.now() - startedAt,
      targetCount: targets.length,
      rangeCount: selectedRanges.length,
      ranges: selectedRanges,
      portCount: [...new Set(ports.map(Number))].length,
      protocols: protocols.map(({ items: _items, ...entry }) => entry),
      successfulProtocols: protocols.filter((entry) => entry.state === 'completed').length,
      failedProtocols: protocols.filter((entry) => entry.state === 'failed').length,
    };
    onProgress?.({ stage: 'completed', count: items.length, durationMs: diagnostics.durationMs });
    return { items, diagnostics };
  }

  static async discover(options = {}) {
    return (await this.discoverDetailed(options)).items;
  }
}

export const cameraDiscoveryDefaults = Object.freeze({
  ports: DEFAULT_SCAN_PORTS, maxHosts: MAX_SCAN_HOSTS,
  scanConcurrency: config.discoveryScanConcurrency,
  perHostConcurrency: config.discoveryPerHostConcurrency,
  fingerprintConcurrency: config.discoveryFingerprintConcurrency,
  portTimeoutMs: config.discoveryPortTimeoutMs,
});
