import { createRequire as __tmpCreateRequire } from 'module';
const __tmpRequire = __tmpCreateRequire(import.meta.url);
__tmpRequire('./__tmp_onvif_ptz_evidence.cjs').installOnvifPtzPatch(__tmpRequire('onvif'));
import { createRequire } from 'node:module';
import { config } from '../../config.js';
import { cameraMediaUriCandidates, normalizeCameraUri, safeMediaEndpoint } from '../../utils/url.js';
import { AppError } from '../../utils/errors.js';
import { rankProfiles } from './profileRanker.js';
import { inferMediaSourceKind } from '../media/MediaSource.js';
import { classifyDiscoveredDevice } from '../media/OnvifDiscoveryClassifier.js';
import {
  mediaServiceCandidates,
  mergeOnvifProfiles,
  normalizeMediaService,
  normalizeOnvifProfile,
} from './profileDiscovery.js';
import {
  availableMediaServices,
  media2Protocol,
  profilesForService,
  snapshotUriForService,
  streamUriForService,
  soapRequest,
} from './mediaSoap.js';
import { enrichProfilesWithPtzSupport, ptzServiceUrl } from './ptzDiscovery.js';
import { onvifConnectionOptions, onvifEndpointLabel } from './connectionOptions.js';

export { normalizeVideoCodec, normalizeVideoProfile } from './profileDiscovery.js';

const require = createRequire(import.meta.url);
const { Cam, Discovery } = require('onvif');

function call(cam, method, options) {
  return new Promise((resolve, reject) => {
    const callback = (error, result) => error ? reject(error) : resolve(result);
    if (options === undefined) cam[method](callback);
    else cam[method](options, callback);
  });
}

function connect(options) {
  const timeoutMs = Number(options?.timeout || config.cameraConnectTimeoutMs);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AppError(504, 'ONVIF_TIMEOUT', 'ONVIF-Verbindung hat das Zeitlimit ueberschritten')), timeoutMs);
    const cam = new Cam({ ...options, timeout: timeoutMs }, (error) => {
      clearTimeout(timer);
      if (error) reject(new AppError(502, 'ONVIF_CONNECTION_FAILED', 'ONVIF-Verbindung fehlgeschlagen', String(error.message || error)));
      else resolve(cam);
    });
  });
}

export { classifyDiscoveredDevice } from '../media/OnvifDiscoveryClassifier.js';

export class OnvifClient {
  constructor(camera, options = {}) {
    this.camera = camera;
    this.options = options || {};
    this.cam = null;
    this.openPromise = null;
    this.profileMediaServices = new Map();
  }

  async open() {
    if (this.cam) return this.cam;
    if (!this.openPromise) {
      this.openPromise = connect(onvifConnectionOptions(this.camera, this.options.timeoutMs || config.cameraConnectTimeoutMs))
        .then((cam) => { this.cam = cam; return cam; })
        .finally(() => { this.openPromise = null; });
    }
    return this.openPromise;
  }

  async deviceInfo() {
    const cam = await this.open();
    const info = await call(cam, 'getDeviceInformation').catch(() => ({}));
    return {
      manufacturer: info.manufacturer || info.Manufacturer || null,
      model: info.model || info.Model || null,
      firmwareVersion: info.firmwareVersion || info.FirmwareVersion || null,
      serialNumber: info.serialNumber || info.SerialNumber || null,
      hardwareId: info.hardwareId || info.HardwareId || null,
      capabilities: cam.capabilities || {},
    };
  }

  async profiles() {
    const cam = await this.open();
    const discoveredGroups = [];

    // Media1 und Media2 koennen unterschiedliche Profilmengen liefern. Deshalb
    // werden beide vorhandenen Dienste abgefragt, statt nur cam.profiles zu verwenden.
    for (const service of availableMediaServices(cam)) {
      try {
        discoveredGroups.push(await profilesForService(cam, service));
      } catch {
        // Ein fehlerhafter optionaler Mediendienst darf die Profile des anderen
        // Dienstes und die beim Verbindungsaufbau geladenen Fallbackdaten nicht verwerfen.
      }
    }

    const fallbackService = cam.media2Support ? 'media2' : 'media';
    const fallbackRawProfiles = cam.profiles ? (Array.isArray(cam.profiles) ? cam.profiles : [cam.profiles]) : [];
    const fallbackProfiles = fallbackRawProfiles
      .map((profile) => normalizeOnvifProfile(profile, { mediaService: fallbackService }))
      .filter((profile) => profile.token);
    const mergedProfiles = mergeOnvifProfiles(discoveredGroups, fallbackProfiles);
    // Manche Kameras melden ihre PTZConfiguration nicht direkt in GetProfiles,
    // obwohl der PTZ-Service den Profil-Token akzeptiert. Read-only PTZ-Probes
    // stellen die Verknuepfung wieder her, ohne die Kamera zu bewegen.
    const rawProfilePtz = mergedProfiles.some((profile) => Boolean(profile?.hasPtz));
    const advertisedPtzService = ptzServiceUrl(cam) || null;
    const ptzAwareProfiles = await enrichProfilesWithPtzSupport(cam, mergedProfiles, { request: soapRequest });
    const profiles = rankProfiles(ptzAwareProfiles);
    const ptzProfiles = profiles.filter((profile) => profile.hasPtz).map((profile) => profile.token);
    this.lastPtzDiagnostics = {
      searched: true,
      detected: ptzProfiles.length > 0,
      serviceUrl: advertisedPtzService,
      profileTokens: ptzProfiles,
      evidence: rawProfilePtz ? 'media-profile' : ptzProfiles.length && advertisedPtzService ? 'ptz-service-or-readonly-probe' : ptzProfiles.length ? 'readonly-probe' : advertisedPtzService ? 'advertised-service-unconfirmed' : 'none',
    };
    this.profileMediaServices = new Map(profiles.map((profile) => [profile.token, profile.mediaService]));
    return profiles;
  }

  async diagnostics() {
    const cam = await this.open();
    const endpoint = onvifEndpointLabel(this.camera);
    return {
      endpoint,
      port: Number(onvifConnectionOptions(this.camera).port || 80),
      path: onvifConnectionOptions(this.camera).path || '/onvif/device_service',
      services: {
        media: cam?.uri?.media?.href || cam?.uri?.media?.path || null,
        media2: cam?.uri?.media2?.href || cam?.uri?.media2?.path || null,
        ptz: ptzServiceUrl(cam) || null,
      },
      ptz: this.lastPtzDiagnostics || { searched: false, detected: false, serviceUrl: ptzServiceUrl(cam) || null, profileTokens: [], evidence: 'not-scanned' },
    };
  }

  async streamCandidates(profileToken, protocols = ['TCP', 'RTSP', 'UDP'], mediaService = null) {
    const cam = await this.open();
    const protocolList = Array.isArray(protocols) ? protocols : ['TCP', 'RTSP', 'UDP'];
    const requestedProtocols = [...new Set(protocolList.map((value) => String(value).toUpperCase()))];
    const serviceHint = normalizeMediaService(mediaService || this.profileMediaServices.get(profileToken));
    const available = new Set(availableMediaServices(cam));
    const services = profileToken
      ? mediaServiceCandidates(serviceHint, cam.media2Support).filter((service) => available.has(service))
      : [];
    let mediaResult = null;
    let sourceProtocol = null;
    let sourceService = null;
    const directRequests = new Set();

    // Ein erfolgreiches GetStreamUri reicht. Die Anfrage erfolgt gezielt ueber
    // den Dienst, von dem das Profil stammt; das ist fuer Media2-only/H.265-Tokens
    // entscheidend. Doppelte Media2-Protokollabbildungen werden vermieden.
    for (const service of services) {
      for (const protocol of requestedProtocols) {
        const requestKey = `${service}:${service === 'media2' ? media2Protocol(protocol) : protocol}`;
        if (directRequests.has(requestKey)) continue;
        directRequests.add(requestKey);
        try {
          const raw = await streamUriForService(cam, service, profileToken, protocol);
          if (!raw) continue;
          mediaResult = raw;
          sourceProtocol = protocol;
          sourceService = service;
          break;
        } catch { /* Nicht jeder Dienst beziehungsweise Transport wird vollstaendig implementiert. */ }
      }
      if (mediaResult) break;
    }

    // Kompatibilitaets-Fallback fuer aeltere Bibliotheksversionen oder Geraete,
    // deren Service-URL beim Verbindungsaufbau nicht separat erkannt wurde.
    if (!mediaResult && typeof cam.getStreamUri === 'function') {
      for (const protocol of requestedProtocols) {
        try {
          const result = await call(cam, 'getStreamUri', { stream: 'RTP-Unicast', protocol, profileToken });
          const raw = result?.uri || result?.Uri || result?.URI;
          if (!raw) continue;
          mediaResult = raw;
          sourceProtocol = protocol;
          sourceService = cam.media2Support ? 'media2' : 'media';
          break;
        } catch { /* Hersteller implementieren oft nur einen Teil der Transportarten. */ }
      }
    }

    if (!mediaResult) throw new AppError(502, 'NO_STREAM_URI', 'Die Kamera liefert fuer dieses ONVIF-Profil keine Medienadresse');

    const results = [];
    const seen = new Set();
    for (const candidate of cameraMediaUriCandidates(mediaResult, this.camera.onvif.ip, sourceProtocol)) {
      const endpoint = safeMediaEndpoint(candidate.uri);
      const sourceType = inferMediaSourceKind(candidate.uri, 'auto');
      const transports = ['rtsp', 'rtsps'].includes(endpoint.scheme) ? ['tcp', 'udp'] : [sourceType];
      for (const transport of transports) {
        const key = `${candidate.uri}|${transport}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          uri: candidate.uri,
          protocol: sourceProtocol,
          mediaService: sourceService || serviceHint,
          transport,
          endpoint,
          endpointReason: candidate.reason,
          sourceType,
        });
      }
    }
    return results;
  }

  async snapshotUri(profileToken, mediaService = null) {
    const cam = await this.open();
    const serviceHint = normalizeMediaService(mediaService || this.profileMediaServices.get(profileToken));
    const available = new Set(availableMediaServices(cam));
    const services = mediaServiceCandidates(serviceHint, cam.media2Support).filter((service) => available.has(service));

    if (profileToken) {
      for (const service of services) {
        try {
          const raw = await snapshotUriForService(cam, service, profileToken);
          if (raw) return normalizeCameraUri(raw, this.camera.onvif.ip);
        } catch { /* Snapshot ist bei einigen Profilen oder Diensten optional. */ }
      }
    }

    if (typeof cam.getSnapshotUri === 'function') {
      const result = await call(cam, 'getSnapshotUri', { profileToken });
      const raw = result?.uri || result?.Uri || result?.URI;
      return raw ? normalizeCameraUri(raw, this.camera.onvif.ip) : null;
    }
    return null;
  }

  async ptzMove(profileToken, velocity, timeout = 300) {
    const cam = await this.open();
    await call(cam, 'continuousMove', { profileToken, x: velocity.x || 0, y: velocity.y || 0, zoom: velocity.zoom || 0, timeout });
  }

  async ptzStop(profileToken) {
    const cam = await this.open();
    await call(cam, 'stop', { profileToken, panTilt: true, zoom: true });
  }

  async ptzHome(profileToken) {
    const cam = await this.open();
    await call(cam, 'gotoHomePosition', { profileToken });
  }

  async presets(profileToken) {
    const cam = await this.open();
    const result = await call(cam, 'getPresets', { profileToken });
    return Object.entries(result || {}).map(([token, preset]) => ({ token, name: preset?.name || preset?.Name || token }));
  }

  async gotoPreset(profileToken, presetToken) {
    const cam = await this.open();
    await call(cam, 'gotoPreset', { profileToken, preset: presetToken });
  }

  static discover(timeoutMs = 5000, { includeUnverified = false } = {}) {
    return new Promise((resolve) => {
      const devices = new Map();
      const onDevice = (cam, remoteInfo) => {
        const classified = classifyDiscoveredDevice(cam, remoteInfo);
        if (!classified.device || (!classified.likelyCamera && !includeUnverified)) return;
        const device = classified.device;
        devices.set(`${device.ip}:${device.port}`, device);
      };
      const onError = () => {};
      Discovery.on('device', onDevice);
      Discovery.on('error', onError);
      Discovery.probe(timeoutMs);
      setTimeout(() => {
        Discovery.removeListener('device', onDevice);
        Discovery.removeListener('error', onError);
        resolve([...devices.values()].sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true })));
      }, timeoutMs + 250);
    });
  }
}
