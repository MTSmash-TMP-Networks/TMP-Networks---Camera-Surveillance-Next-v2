import DigestClient from 'digest-fetch';
import { AppError } from '../utils/errors.js';
import { mediaSourceService } from './media/MediaSourceService.js';
import { parseHikvisionStreamingChannels } from './HikvisionChannels.js';
import { CAMERA_RTSP_PORTS, CAMERA_TLS_PORTS, CAMERA_WEB_PORTS } from './media/CameraPortCatalog.js';

function xmlValue(xml, tag) {
  const match = String(xml || '').match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i'));
  return match ? match[1].replace(/<[^>]+>/g, '').trim() : null;
}

function safeWebPort(input) {
  const ports = (input.openPorts || []).map(Number);
  const requested = Number(input.port);
  if (CAMERA_WEB_PORTS.includes(requested)) return requested;
  return Number(
    ports.find((port) => CAMERA_WEB_PORTS.includes(port) && !CAMERA_TLS_PORTS.includes(port))
    || ports.find((port) => CAMERA_WEB_PORTS.includes(port) && CAMERA_TLS_PORTS.includes(port))
    || 80,
  );
}

function hikvisionWebTargets(input) {
  const ports = [...new Set([safeWebPort(input), ...(input.openPorts || [])].map(Number))]
    .filter((port) => CAMERA_WEB_PORTS.includes(port));
  return ports.map((port) => ({ port, scheme: CAMERA_TLS_PORTS.includes(port) ? 'https' : 'http' }));
}

async function hikvisionFetch(input, path, { accept404 = false } = {}) {
  let authFailure = false;
  for (const { port, scheme } of hikvisionWebTargets(input)) {
    try {
      const client = new DigestClient(input.username || '', input.password || '', { basic: true });
      const response = await client.fetch(`${scheme}://${input.ip}:${port}${path}`, { signal: AbortSignal.timeout(7000) });
      if ([401, 403].includes(response.status)) { authFailure = true; continue; }
      if (response.status === 404 && accept404) continue;
      if (!response.ok) continue;
      return { text: await response.text(), port, scheme, status: response.status };
    } catch { /* nächsten Webport versuchen */ }
  }
  if (authFailure) throw new AppError(401, 'CAMERA_AUTH_FAILED', 'Die Hikvision-Zugangsdaten wurden abgelehnt');
  return null;
}

async function hikvisionDeviceInfo(input) {
  const result = await hikvisionFetch(input, '/ISAPI/System/deviceInfo', { accept404: true });
  if (!result) return null;
  return {
    manufacturer: 'Hikvision',
    model: xmlValue(result.text, 'model') || input.model || null,
    name: xmlValue(result.text, 'deviceName') || input.name || null,
    firmware: xmlValue(result.text, 'firmwareVersion') || null,
    serialNumber: xmlValue(result.text, 'serialNumber') || null,
    macAddress: xmlValue(result.text, 'macAddress') || input.macAddress || null,
    deviceType: xmlValue(result.text, 'deviceType') || 'IPCamera',
    webPort: result.port,
    driver: 'hikvision-isapi',
  };
}


async function hikvisionStreamingChannels(input) {
  const result = await hikvisionFetch(input, '/ISAPI/Streaming/channels', { accept404: true });
  if (!result) return [];
  return parseHikvisionStreamingChannels(result.text, input);
}

function hikvisionFallbackCandidates(input) {
  const rtspPorts = (input.openPorts || []).map(Number).filter((port) => CAMERA_RTSP_PORTS.includes(port) && !CAMERA_TLS_PORTS.includes(port));
  if (!(input.openPorts || []).map(Number).includes(554) && !rtspPorts.length) return [];
  const port = rtspPorts[0] || 554;
  const host = String(input.ip || '').includes(':') ? `[${input.ip}]` : input.ip;
  return [
    { id: '101', role: 'main', label: 'Hikvision Hauptstream · Kanal 101' },
    { id: '102', role: 'sub', label: 'Hikvision Substream · Kanal 102' },
  ].map((entry, index) => ({
    label: entry.label, kind: 'rtsp', priority: 5 + index, enabled: true, origin: 'catalog',
    url: `rtsp://${host}:${port}/Streaming/Channels/${entry.id}`,
    confidence: 98, catalogProvider: 'Hikvision-Modellprofil', catalogFamily: input.model || 'Hikvision IP-Kamera',
    catalogRole: entry.role, matchedBy: 'Hikvision-Standardkanal für erkanntes Kameramodell',
    forceFfprobeOnRtspFailure: true, highConfidenceCandidate: true, deviceChannelId: entry.id,
  }));
}

function inferredDevice(input) {
  const manufacturer = input.manufacturer || (/\b(?:DS|iDS|HWI|HWT)-/i.test(input.model || '') ? 'Hikvision' : null);
  return {
    manufacturer,
    model: input.model || null,
    name: input.name || input.model || `Kamera ${input.ip}`,
    firmware: null,
    serialNumber: input.serialNumber || null,
    macAddress: input.macAddress || null,
    deviceType: 'NetworkCamera',
    webPort: safeWebPort(input),
    driver: manufacturer?.toLowerCase().includes('hikvision') ? 'hikvision-generic' : 'generic-network-camera',
  };
}

export const genericCameraInstaller = {
  async inspect(input) {
    let device = inferredDevice(input);
    let seedCandidates = [];
    const hikvision = /hikvision|hilook|ezviz/i.test(`${device.manufacturer || ''} ${device.model || ''}`);
    if (hikvision) {
      device = (await hikvisionDeviceInfo(input)) || device;
      seedCandidates = await hikvisionStreamingChannels(input);
      if (!seedCandidates.length) seedCandidates = hikvisionFallbackCandidates(input);
    }
    const camera = {
      id: 'inspection',
      name: input.name || device.name,
      enabled: true,
      onvif: { ip: input.ip, port: device.webPort || safeWebPort(input), xaddr: null },
      username: input.username || '',
      password: input.password || '',
      capabilities: { device },
      discoveryProfiles: [],
    };
    const discovery = await mediaSourceService.discoverTemporary(camera, {
      aggressive: true, onlineCatalogs: false, seedCandidates, resultLimit: seedCandidates.length ? Math.min(2, seedCandidates.length) : 2,
    });
    const sources = [...(discovery.items || []), ...(discovery.confirmedPaths || []), ...(discovery.provisionalPaths || [])]
      .sort((left, right) => {
        const leftDevice = left.declaredByDevice ? 0 : left.highConfidenceCandidate ? 1 : left.catalogProvider?.includes('Hikvision') ? 2 : 3;
        const rightDevice = right.declaredByDevice ? 0 : right.highConfidenceCandidate ? 1 : right.catalogProvider?.includes('Hikvision') ? 2 : 3;
        return leftDevice - rightDevice || Number(left.priority || 999) - Number(right.priority || 999);
      });
    if (!sources.length) {
      throw new AppError(422, 'NO_CAMERA_STREAM_FOUND', 'Das Gerät wurde erkannt, aber kein nutzbarer Stream-Pfad konnte bestätigt werden', {
        device, services: discovery.services, diagnostics: discovery.diagnostics,
      });
    }
    return {
      mode: 'generic',
      device: { ...device, ...(discovery.device || {}) },
      profiles: [],
      mediaSources: sources,
      services: discovery.services,
      diagnostics: discovery.diagnostics,
      warnings: discovery.diagnostics?.warnings || [],
      capabilities: { driver: device.driver, onvif: false, ptz: false, audio: false },
    };
  },
};
