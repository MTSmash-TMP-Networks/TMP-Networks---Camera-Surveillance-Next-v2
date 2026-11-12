import { cameraRepository } from './cameraRepository.js';
import { OnvifClient } from './onvif/OnvifClient.js';
import { onvifEndpointLabel } from './onvif/connectionOptions.js';
import { AppError } from '../utils/errors.js';
import { streamOrchestrator } from './media/StreamOrchestrator.js';
import { mediaSourceService } from './media/MediaSourceService.js';
import { genericCameraInstaller } from './GenericCameraInstaller.js';
import { NetworkCameraDiscovery, cameraDiscoveryDefaults } from './NetworkCameraDiscovery.js';
import { inspectDirectStream, normalizeDirectStreamInput } from './DirectStreamInstaller.js';
import { onvifProbeCandidates } from './onvif/setupProbePlan.js';

function normalizeCameraIp(value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return new URL(raw).hostname;
    if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(raw)) return raw.slice(0, raw.lastIndexOf(':'));
  } catch { /* unverändert validieren lassen */ }
  return raw.replace(/^\[|\]$/g, '');
}

async function resolveCameraInput(input) {
  const normalized = {
    ...input,
    ip: normalizeCameraIp(input.ip),
    port: Number(input.port || 0),
    openPorts: [...new Set((input.openPorts || []).map(Number).filter((port) => Number.isInteger(port) && port > 0 && port <= 65535))],
  };
  if (normalized.port > 0 && normalized.openPorts.length) return normalized;

  const detected = await NetworkCameraDiscovery.inspectHost(normalized.ip, { timeoutMs: 900 });
  if (!detected.reachable || !detected.openPorts?.length) {
    throw new AppError(422, 'CAMERA_SERVICES_NOT_FOUND', 'Unter dieser IP-Adresse wurde auf keinem bekannten Kamera-Port ein Dienst gefunden', {
      ip: normalized.ip,
      checkedPorts: cameraDiscoveryDefaults.ports.length,
      hint: 'Prüfe VPN-Route, Firewall und ob die Kamera vom Docker-Host erreichbar ist.',
    });
  }
  return {
    ...normalized,
    // An explicitly entered ONVIF port must take priority over a discovered
    // web/legacy endpoint. Otherwise a user's :8000 selection is silently
    // replaced with :80 or :8080 during the manual IP inspection.
    port: Number(normalized.port || detected.onvifPort || detected.port || 80),
    xaddr: normalized.xaddr || (!normalized.port || Number(detected.onvifPort || 0) === normalized.port ? detected.xaddr : null) || null,
    openPorts: detected.openPorts,
    manufacturer: normalized.manufacturer || detected.manufacturer || null,
    model: normalized.model || detected.model || null,
    serialNumber: normalized.serialNumber || detected.serialNumber || null,
    macAddress: normalized.macAddress || detected.macAddress || null,
    deviceUid: normalized.deviceUid || detected.deviceUid || null,
    discoveryEvidence: normalized.discoveryEvidence || (detected.evidences || [detected.evidence]).filter(Boolean).join(' · '),
  };
}

function connectionSummary(input) {
  return {
    ip: input.ip,
    port: Number(input.port || 80),
    xaddr: input.xaddr || null,
    openPorts: input.openPorts || [],
    manufacturer: input.manufacturer || null,
    model: input.model || null,
    discoveryEvidence: input.discoveryEvidence || null,
  };
}

function tempCamera(input) {
  return {
    id: input.id || 'test',
    name: input.name || input.ip,
    enabled: true,
    onvif: { ip: input.ip, port: input.port || 80, xaddr: input.xaddr || null },
    username: input.username || '',
    password: input.password || '',
  };
}

async function inspectOnvifCandidate(input) {
  const camera = tempCamera(input);
  const client = new OnvifClient(camera);
  const [device, profiles] = await Promise.all([client.deviceInfo(), client.profiles()]);
  if (!profiles.length) throw new AppError(422, 'NO_CAMERA_PROFILES', 'Das ONVIF-Gerät stellt keine Video-Profile bereit');
  const clientDiagnostics = await client.diagnostics();
  const effectiveXaddr = input.xaddr || clientDiagnostics.endpoint || null;
  const effectivePort = Number(clientDiagnostics.port || input.port || 80);
  return {
    mode: 'onvif',
    device,
    profiles,
    mediaSources: [],
    connection: connectionSummary({ ...input, port: effectivePort, xaddr: effectiveXaddr }),
    capabilities: {
      ...device.capabilities,
      driver: 'onvif',
      onvif: true,
      ptz: profiles.some((profile) => profile.hasPtz),
      audio: profiles.some((profile) => Boolean(profile.audioCodec)),
    },
    clientDiagnostics,
  };
}

async function inspectOnvif(input) {
  const attempts = [];
  let lastError = null;
  for (const candidate of onvifProbeCandidates(input)) {
    const startedAt = Date.now();
    try {
      const result = await inspectOnvifCandidate(candidate);
      attempts.push({ endpoint: result.clientDiagnostics.endpoint, port: result.clientDiagnostics.port, source: candidate.probeSource, ok: true, durationMs: Date.now() - startedAt });
      return {
        ...result,
        diagnostics: {
          onvif: {
            searched: true,
            detected: true,
            endpoint: result.clientDiagnostics.endpoint,
            port: result.clientDiagnostics.port,
            path: result.clientDiagnostics.path,
            attempts,
          },
          ptz: { ...result.clientDiagnostics.ptz, searched: true },
        },
      };
    } catch (error) {
      lastError = error;
      const endpoint = onvifEndpointLabel(tempCamera(candidate));
      attempts.push({ endpoint, port: Number(candidate.port || 80), source: candidate.probeSource, ok: false, durationMs: Date.now() - startedAt, code: error.code || 'ONVIF_FAILED' });
    }
  }
  throw new AppError(422, 'ONVIF_PROBE_FAILED', 'ONVIF konnte auf den erkannten Kamera-Ports nicht authentifiziert geöffnet werden', {
    diagnostics: {
      onvif: { searched: true, detected: false, endpoint: null, port: null, path: null, attempts },
      ptz: { searched: false, detected: false, serviceUrl: null, profileTokens: [], evidence: 'onvif-not-connected' },
    },
    lastError: lastError?.message || null,
  });
}

function sourceUrlForToken(sources, token) {
  if (!token?.startsWith('source:')) return null;
  const id = Number(token.slice(7));
  return sources.find((source) => Number(source.id) === id)?.url || null;
}

export const cameraService = {
  async inspect(input) {
    const requestedMode = input.connectionMode || 'auto';
    if (requestedMode === 'stream') return inspectDirectStream(input);
    const resolvedInput = await resolveCameraInput(input);
    const mode = resolvedInput.connectionMode || 'auto';
    let onvifError = null;
    if (mode !== 'generic') {
      try {
        const result = await inspectOnvif(resolvedInput);
        return result;
      }
      catch (error) {
        onvifError = error;
        if (mode === 'onvif') throw error;
      }
    }
    try {
      const result = await genericCameraInstaller.inspect(resolvedInput);
      return {
        ...result,
        connection: connectionSummary({ ...resolvedInput, port: result.device?.webPort || resolvedInput.port }),
        diagnostics: onvifError?.details?.diagnostics || {
          onvif: { searched: mode !== 'generic', detected: false, attempts: [] },
          ptz: { searched: false, detected: false, evidence: mode === 'generic' ? 'onvif-disabled' : 'onvif-not-connected' },
        },
        onvifError: onvifError ? { code: onvifError.code, message: onvifError.message } : null,
      };
    } catch (genericError) {
      if (onvifError) {
        throw new AppError(422, 'CAMERA_INSPECTION_FAILED', 'Die Kamera konnte weder über ONVIF noch über Hersteller-/Netzwerkprofile eingerichtet werden', {
          onvif: onvifError.message,
          generic: genericError.message,
          genericDetails: genericError.details,
        });
      }
      throw genericError;
    }
  },

  async create(input) {
    if ((input.connectionMode || 'auto') === 'stream') {
      const directInput = normalizeDirectStreamInput(input);
      const existingStream = cameraRepository.findStreamDuplicate(directInput.primarySource.url);
      if (existingStream) throw new AppError(409, 'STREAM_ALREADY_EXISTS', `Der Netzwerkstream ist bereits als „${existingStream.name}“ hinzugefügt`);
      const inspection = await this.inspect(directInput);
      const normalizedSources = mediaSourceService.normalize(inspection.mediaSources, inspection.connection.ip, { allowExternalHost: true });
      const camera = cameraRepository.create({
        ...directInput,
        ip: inspection.connection.ip,
        port: Number(inspection.connection.port || 0),
        preferredProfile: null,
        capabilities: inspection.capabilities,
        sourcePolicy: directInput.sourcePolicy || 'manual-first',
      });
      const persistedSources = cameraRepository.replaceMediaSources(camera.id, normalizedSources);
      const preferred = persistedSources.find((source) => source.enabled && source.kind !== 'snapshot') || persistedSources.find((source) => source.enabled);
      if (preferred) cameraRepository.update(camera.id, { preferredProfile: `source:${preferred.id}` });
      cameraRepository.updateStatus(camera.id, 'online');
      void streamOrchestrator.startPermanentIngestForCamera(camera.id, { wait: false, reason: 'direct-stream-created' });
      return { camera: cameraRepository.get(camera.id), profiles: [], mediaSources: persistedSources };
    }
    const existingInput = cameraRepository.findDiscoveryDuplicate(input);
    if (existingInput) throw new AppError(409, 'CAMERA_ALREADY_EXISTS', `Die Kamera ist bereits als „${existingInput.name}“ hinzugefügt`);
    const inspection = await this.inspect(input);
    const effectiveInput = {
      ...input,
      ip: inspection.connection?.ip || input.ip,
      port: Number(inspection.connection?.port || input.port || 80),
      xaddr: inspection.connection?.xaddr || input.xaddr || null,
      openPorts: inspection.connection?.openPorts || input.openPorts || [],
      manufacturer: input.manufacturer || inspection.device?.manufacturer || inspection.connection?.manufacturer || null,
      model: input.model || inspection.device?.model || inspection.connection?.model || null,
      serialNumber: input.serialNumber || inspection.device?.serialNumber || null,
      macAddress: input.macAddress || inspection.device?.macAddress || null,
      deviceUid: input.deviceUid || inspection.device?.deviceUid || inspection.device?.hardwareId || null,
      discoveryEvidence: input.discoveryEvidence || inspection.connection?.discoveryEvidence || null,
    };
    const existingResolved = cameraRepository.findDiscoveryDuplicate(effectiveInput);
    if (existingResolved) throw new AppError(409, 'CAMERA_ALREADY_EXISTS', `Die Kamera ist bereits als „${existingResolved.name}“ hinzugefügt`);
    if (inspection.mode === 'onvif') {
      if (effectiveInput.preferredProfile && !inspection.profiles.some((profile) => profile.token === effectiveInput.preferredProfile)) {
        throw new AppError(400, 'INVALID_PROFILE', 'Das ausgewaehlte ONVIF-Profil gehoert nicht zu dieser Kamera');
      }
      const preferred = effectiveInput.preferredProfile || inspection.profiles.find((profile) => profile.role === 'balanced')?.token || inspection.profiles[0]?.token || null;
      const normalizedSources = mediaSourceService.normalize(effectiveInput.mediaSources || [], effectiveInput.ip);
      const camera = cameraRepository.create({
        ...effectiveInput,
        preferredProfile: preferred,
        macAddress: effectiveInput.macAddress || inspection.device.macAddress || null,
        serialNumber: effectiveInput.serialNumber || inspection.device.serialNumber || null,
        deviceUid: effectiveInput.deviceUid || inspection.device.hardwareId || null,
        capabilities: { ...inspection.capabilities, device: inspection.device },
      });
      cameraRepository.replaceProfiles(camera.id, inspection.profiles);
      if (normalizedSources.length) cameraRepository.replaceMediaSources(camera.id, normalizedSources);
      cameraRepository.updateStatus(camera.id, 'online');
      void streamOrchestrator.startPermanentIngestForCamera(camera.id, { wait: false, reason: 'camera-created' });
      return { camera: cameraRepository.get(camera.id), profiles: inspection.profiles, mediaSources: cameraRepository.mediaSources(camera.id) };
    }

    const normalizedSources = mediaSourceService.normalize(effectiveInput.mediaSources?.length ? effectiveInput.mediaSources : inspection.mediaSources, effectiveInput.ip);
    if (!normalizedSources.length) throw new AppError(422, 'NO_CAMERA_STREAM_FOUND', 'Es wurde keine nutzbare Medienquelle gefunden');
    const camera = cameraRepository.create({
      ...input,
      ...effectiveInput,
      preferredProfile: null,
      port: inspection.device.webPort || effectiveInput.port,
      macAddress: effectiveInput.macAddress || inspection.device.macAddress || null,
      serialNumber: effectiveInput.serialNumber || inspection.device.serialNumber || null,
      deviceUid: effectiveInput.deviceUid || inspection.device.deviceUid || inspection.device.hardwareId || null,
      capabilities: { ...inspection.capabilities, device: inspection.device },
    });
    const persistedSources = cameraRepository.replaceMediaSources(camera.id, normalizedSources);
    const requestedUrl = effectiveInput.preferredSourceUrl || sourceUrlForToken(normalizedSources, effectiveInput.preferredProfile);
    const preferred = persistedSources.find((source) => source.url === requestedUrl)
      || persistedSources.find((source) => source.enabled && source.kind !== 'snapshot')
      || persistedSources.find((source) => source.enabled);
    if (preferred) cameraRepository.update(camera.id, { preferredProfile: `source:${preferred.id}` });
    cameraRepository.updateStatus(camera.id, 'online');
    void streamOrchestrator.startPermanentIngestForCamera(camera.id, { wait: false, reason: 'camera-created' });
    return { camera: cameraRepository.get(camera.id), profiles: [], mediaSources: persistedSources };
  },

  async update(cameraId, patch) {
    const current = cameraRepository.getWithCredentials(cameraId);
    if (!current) throw new AppError(404, 'CAMERA_NOT_FOUND', 'Kamera nicht gefunden');

    const directStream = current.connectionType === 'stream';
    if (directStream && patch.mediaSources !== undefined) {
      const normalizedDirect = normalizeDirectStreamInput({
        name: patch.name ?? current.name,
        username: patch.username ?? current.username,
        password: patch.password ?? current.password,
        mediaSources: patch.mediaSources,
      });
      const duplicate = cameraRepository.findStreamDuplicate(normalizedDirect.primarySource.url, { excludeCameraId: cameraId });
      if (duplicate) throw new AppError(409, 'STREAM_ALREADY_EXISTS', `Der Netzwerkstream ist bereits als „${duplicate.name}“ hinzugefügt`);
      patch.ip = normalizedDirect.ip;
      patch.port = normalizedDirect.port;
    }
    const connectionChanged = ['ip', 'port', 'username', 'password'].some((field) => patch[field] !== undefined);
    let inspection = null;
    if (connectionChanged) {
      inspection = await this.inspect({
        id: current.id,
        name: patch.name ?? current.name,
        ip: patch.ip ?? current.onvif.ip,
        port: patch.port ?? current.onvif.port,
        username: patch.username ?? current.username,
        password: patch.password ?? current.password,
        connectionMode: directStream ? 'stream' : current.capabilities?.driver === 'onvif' ? 'onvif' : 'auto',
        manufacturer: current.capabilities?.device?.manufacturer,
        model: current.capabilities?.device?.model,
        mediaSources: patch.mediaSources ?? cameraRepository.mediaSources(cameraId),
      });
    }

    const validProfiles = inspection?.profiles || cameraRepository.profiles(cameraId);
    const existingSources = cameraRepository.mediaSources(cameraId);
    if (patch.preferredProfile && !patch.preferredProfile.startsWith('source:') && !validProfiles.some((profile) => profile.token === patch.preferredProfile)) {
      throw new AppError(400, 'INVALID_PROFILE', 'Das ausgewaehlte Profil gehoert nicht zu dieser Kamera');
    }

    const targetIp = patch.ip ?? current.onvif.ip;
    const sourceInput = patch.mediaSources === undefined ? null : patch.mediaSources;
    const normalizedSources = sourceInput === null ? null : mediaSourceService.normalize(sourceInput, targetIp, { allowExternalHost: directStream });
    const updated = cameraRepository.update(cameraId, {
      ...patch,
      capabilities: inspection ? { ...inspection.capabilities, device: inspection.device } : undefined,
    });
    if (inspection?.mode === 'onvif') cameraRepository.replaceProfiles(cameraId, inspection.profiles);
    if (inspection?.mode === 'generic') {
      cameraRepository.replaceProfiles(cameraId, []);
      const refreshedSources = cameraRepository.replaceMediaSources(cameraId, mediaSourceService.normalize(inspection.mediaSources, targetIp));
      const preferred = refreshedSources.find((source) => source.enabled && source.kind !== 'snapshot') || refreshedSources.find((source) => source.enabled);
      if (preferred) cameraRepository.update(cameraId, { preferredProfile: `source:${preferred.id}` });
    } else if (inspection?.mode === 'stream') {
      cameraRepository.replaceProfiles(cameraId, []);
      const refreshedSources = cameraRepository.replaceMediaSources(cameraId, mediaSourceService.normalize(inspection.mediaSources, inspection.connection?.ip || targetIp, { allowExternalHost: true }));
      const preferred = refreshedSources.find((source) => source.enabled && source.kind !== 'snapshot') || refreshedSources.find((source) => source.enabled);
      if (preferred) cameraRepository.update(cameraId, { preferredProfile: `source:${preferred.id}` });
    } else if (normalizedSources) cameraRepository.replaceMediaSources(cameraId, normalizedSources);
    const streamAffecting = connectionChanged || ['preferredProfile', 'profilePolicy', 'codecPreference', 'sourcePolicy', 'mediaSources', 'rotation', 'enabled']
      .some((field) => patch[field] !== undefined);
    if (streamAffecting) await streamOrchestrator.restart(cameraId);
    const effectiveCamera = cameraRepository.get(cameraId) || updated;
    if (streamAffecting) {
      if (effectiveCamera?.enabled) void streamOrchestrator.startPermanentIngestForCamera(cameraId, { wait: false, reason: 'camera-updated' });
      else await streamOrchestrator.stopCamera(cameraId);
    }
    return { camera: effectiveCamera, profiles: inspection?.profiles || validProfiles, mediaSources: cameraRepository.mediaSources(cameraId).length ? cameraRepository.mediaSources(cameraId) : existingSources };
  },

  async refreshProfiles(cameraId) {
    const camera = cameraRepository.getWithCredentials(cameraId);
    if (!camera) throw new AppError(404, 'CAMERA_NOT_FOUND', 'Kamera nicht gefunden');
    if (camera.connectionType === 'stream') {
      const results = await mediaSourceService.testCameraSources(cameraId);
      const online = results.some((item) => item.ok && item.kind !== 'snapshot');
      cameraRepository.updateStatus(cameraId, online ? 'online' : 'degraded', online ? null : 'Direkter Netzwerkstream nicht erreichbar');
      if (online) {
        await streamOrchestrator.restart(cameraId);
        void streamOrchestrator.startPermanentIngestForCamera(cameraId, { wait: false, reason: 'direct-stream-refreshed' });
      }
      return [];
    }
    if (camera.capabilities?.driver !== 'onvif') {
      // v2.20.0-v2.20.6 could persist a discovered camera as generic when the
      // unauthenticated discovery scan had not yet proven ONVIF. Once credentials
      // are available, retry ONVIF before staying on the generic driver so existing
      // installations can recover profiles and PTZ without deleting the camera.
      try {
        const onvifClient = new OnvifClient(camera);
        const [device, recoveredProfiles] = await Promise.all([onvifClient.deviceInfo(), onvifClient.profiles()]);
        if (recoveredProfiles.length) {
          cameraRepository.replaceProfiles(cameraId, recoveredProfiles);
          cameraRepository.update(cameraId, {
            capabilities: {
              ...device.capabilities,
              driver: 'onvif',
              onvif: true,
              ptz: recoveredProfiles.some((profile) => profile.hasPtz),
              audio: recoveredProfiles.some((profile) => Boolean(profile.audioCodec)),
              device,
            },
          });
          cameraRepository.updateStatus(cameraId, 'online');
          await streamOrchestrator.restart(cameraId);
          void streamOrchestrator.startPermanentIngestForCamera(cameraId, { wait: false, reason: 'generic-camera-onvif-recovered' });
          return recoveredProfiles;
        }
      } catch {
        // Not every generic camera supports ONVIF. Preserve the existing generic
        // discovery path when authenticated ONVIF probing still fails.
      }
      const result = await mediaSourceService.discover(cameraId, { onlineCatalogs: false, aggressive: true });
      if (result.items.length) cameraRepository.replaceMediaSources(cameraId, mediaSourceService.normalize(result.items, camera.onvif.ip));
      cameraRepository.updateStatus(cameraId, result.items.length ? 'online' : 'degraded');
      return [];
    }
    const client = new OnvifClient(camera);
    const profiles = await client.profiles();
    if (!profiles.length) throw new AppError(422, 'NO_CAMERA_PROFILES', 'Das ONVIF-Gerät stellt keine Video-Profile bereit');
    cameraRepository.replaceProfiles(cameraId, profiles);
    cameraRepository.update(cameraId, {
      capabilities: {
        ...(camera.capabilities || {}),
        ptz: profiles.some((profile) => profile.hasPtz),
        audio: profiles.some((profile) => Boolean(profile.audioCodec)),
      },
    });
    cameraRepository.updateStatus(cameraId, 'online');
    await streamOrchestrator.restart(cameraId);
    void streamOrchestrator.startPermanentIngestForCamera(cameraId, { wait: false, reason: 'profiles-refreshed' });
    return profiles;
  },
};
