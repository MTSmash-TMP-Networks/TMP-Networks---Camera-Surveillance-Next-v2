import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cameraRepository } from '../cameraRepository.js';
import { cameraEventLog, sanitizeLogText } from '../CameraEventLog.js';
import { OnvifClient } from '../onvif/OnvifClient.js';
import { chooseProfiles } from '../onvif/profileRanker.js';
import { config } from '../../config.js';
import { injectCredentials, safePathPart } from '../../utils/url.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { go2RtcClient, go2RtcStreamReady } from './Go2RtcClient.js';
import { sanitize } from './FfmpegProbe.js';
import { buildFfmpegArgs, buildSnapshotLocalHlsArgs, buildLocalHlsRingArgs } from './FfmpegCommand.js';
import { manualStreamAttempts, sortMediaAttempts } from './MediaSourceService.js';
import { inferMediaSourceKind } from './MediaSource.js';
import { snapshotService } from './SnapshotService.js';
import { startSnapshotFramePump } from './SnapshotVideoBridge.js';
import { createStreamProgressTracker, consumeFfmpegProgress } from './StreamProgressTracker.js';
import { isBenignFfmpegDiagnostic } from './FfmpegDiagnostics.js';
import { brokerStreamPaths, nativeBrokerSource, normalizedVideoSource, optionalAudioSource, profileMedia, normalizedBrokerPolicy, brokerEncoderCandidates, isBrokerEncoderRetryable, parseFfprobeVideoCodec } from './BrokerPipeline.js';

const execFileAsync = promisify(execFile);


function sessionSlot(quality, viewportWidth, purpose = 'live') {
  // Recording and motion have fixed source roles by default. Their callers often
  // carry legacy 'balanced' plan values, which must not defeat the architecture.
  if (purpose === 'motion' && config.motionPreferSubstream) return 'low';
  if (purpose === 'recording' && config.recordingPreferMainstream) return 'high';
  if (quality !== 'auto') return quality;
  if (purpose === 'kiosk' && config.kioskPreferSubstream) return 'low';
  if (purpose === 'live' && config.livePreferMainstream) return 'high';
  return viewportWidth <= 720 ? 'low' : viewportWidth <= 1440 ? 'balanced' : 'high';
}

function normalizeConsumerPurpose(purpose) {
  return ['live', 'kiosk', 'recording', 'motion'].includes(purpose) ? purpose : 'live';
}

function sessionKey(cameraId, quality, profileToken = null, purpose = 'live') {
  return `${cameraId}:${purpose}:${quality}:${profileToken || 'auto'}`;
}


export function findCoalescableSession(sessions, cameraId, requestedProfileToken = null, purpose = 'live', consumerPurpose = null) {
  return [...sessions].find((candidate) =>
    candidate.cameraId === cameraId
    && (candidate.purpose || 'live') === purpose
    && candidate.requestedProfileToken === requestedProfileToken
    && (purpose === 'mainstream' || !consumerPurpose || (candidate.consumerPurpose || candidate.purpose || 'live') === consumerPurpose)
    && candidate.state === 'starting'
  ) || null;
}

export function streamPathBase(cameraId, quality, profileToken = null, purpose = 'live') {
  const cameraPart = safePathPart(cameraId).slice(0, 24) || 'camera';
  // The permanent publisher is a low-cost preview/substream path. Mainstream
  // live and recording sessions are started separately only when requested.
  if (purpose === 'ingest') return `cam_${cameraPart}_preview`;
  const digest = crypto.createHash('sha256').update(sessionKey(cameraId, quality, profileToken, purpose)).digest('hex').slice(0, 14);
  return `cam_${cameraPart}_${purpose}_${quality}_${digest}`;
}

function widthForQuality(quality) {
  return quality === 'low' ? 640 : quality === 'balanced' ? 1280 : 1920;
}


function redactedSource(source) {
  return String(source || '').replace(/:\/\/([^:@/]+):([^@/]+)@/g, '://***:***@');
}

function permanentQuality() {
  // `auto-substream` is an architectural promise, not just a hint. It must win
  // over a legacy v2.18.0 PERMANENT_CAMERA_INGEST_QUALITY=balanced value.
  if (config.permanentIngestProfile === 'auto-substream') return 'low';
  return ['low', 'balanced', 'high'].includes(config.permanentIngestQuality) ? config.permanentIngestQuality : 'low';
}

function shouldUsePermanentIngest(purpose, forceTranscode = false) {
  return Boolean(config.permanentIngestEnabled) && !forceTranscode && normalizeConsumerPurpose(purpose) === 'kiosk';
}

function permanentProfileToken(camera, explicitToken = null) {
  if (explicitToken) return explicitToken;
  return config.permanentIngestProfile === 'camera-preferred' ? (camera.preferredProfile || null) : null;
}

function errorDetails(error) {
  if (!error) return null;
  return {
    name: error.name,
    code: error.code || null,
    message: error.message,
    details: error.details || null,
  };
}

function candidateKey(candidate, profileToken = null) {
  return `${profileToken || ''}|${candidate?.uri || ''}|${candidate?.transport || ''}`;
}

export function prioritizeStableProfile(attempts, profileToken = null) {
  if (!profileToken) return attempts;
  const preferred = attempts.filter((attempt) => String(attempt?.profile?.token || '') === String(profileToken));
  if (!preferred.length) return attempts;
  return [...preferred, ...attempts.filter((attempt) => String(attempt?.profile?.token || '') !== String(profileToken))];
}

const SOURCE_FAILURE_COOLDOWN_MS = 2 * 60 * 1000;
export function prioritizeRequestedSource(attempts, requestedToken = null) {
  const sourceId = String(requestedToken || '').startsWith('source:') ? Number(String(requestedToken).slice(7)) : null;
  if (!Number.isInteger(sourceId)) return attempts;
  return [
    ...attempts.filter((attempt) => Number(attempt.candidate.sourceId) === sourceId),
    ...attempts.filter((attempt) => Number(attempt.candidate.sourceId) !== sourceId),
  ];
}

class StreamOrchestrator {
  constructor() {
    this.sessions = new Map();
    this.controlResyncTimers = new Map();
    this.cameraStartLocks = new Map();
    this.brokerRefs = new Map();
    // Encoder fallback is intentionally sticky per camera/profile/source.
    // Once copy or VAAPI failed and a more conservative encoder took over,
    // do not probe the failed path again during this backend lifetime.
    // This prevents kiosk streams from oscillating between GPU and CPU paths.
    // A backend restart explicitly starts a fresh evaluation.
    this.brokerEncoderFailures = new Map();
    this.closed = false;
    this.timer = setInterval(() => this.maintenance().catch((error) => logger.error({ err: error }, 'Stream-Wartung fehlgeschlagen')), 10000);
    this.timer.unref();
  }

  async startSerialized(session, camera, viewportWidth) {
    const cameraId = String(camera?.id || session?.cameraId || 'camera');
    const previous = this.cameraStartLocks.get(cameraId) || Promise.resolve();
    const current = previous
      .catch(() => null)
      .then(async () => {
        this.log(session, 'debug', 'stream', 'CAMERA_START_LOCK_ACQUIRED', 'Kamera-Verbindungsaufbau wird serialisiert, damit keine parallelen RTSP-Starts entstehen');
        return this.start(session, camera, viewportWidth);
      });
    this.cameraStartLocks.set(cameraId, current);
    try {
      return await current;
    } finally {
      if (this.cameraStartLocks.get(cameraId) === current) this.cameraStartLocks.delete(cameraId);
    }
  }

  async acquireBroker(session, camera, profile, candidate, sourceUri) {
    const encoder = session.brokerEncoder || 'software';
    const paths = brokerStreamPaths(camera.id, profile, candidate, encoder);
    const existing = this.brokerRefs.get(paths.video);
    session.paths.raw = paths.raw;
    session.paths.video = paths.video;
    session.paths.audio = paths.audio;
    session.paths.webrtc = paths.video;
    session.paths.hls = paths.video;
    const rawSource = nativeBrokerSource(sourceUri, candidate.transport, 20);
    const videoSource = normalizedVideoSource(paths.raw, 20, encoder);
    let inheritedRefs = 0;
    if (existing) {
      const [registeredRaw, registeredVideo] = await Promise.all([
        go2RtcClient.stream(paths.raw).catch(() => null),
        go2RtcClient.stream(paths.video).catch(() => null),
      ]);
      if (registeredRaw && registeredVideo) {
        existing.refs += 1;
        session.brokerRefKey = paths.video;
        this.log(session, 'info', 'go2rtc', 'GO2RTC_BROKER_REUSED', 'Vorhandener zentraler Kamera-Broker wird wiederverwendet', {
          profile: profile.name,
          raw: paths.raw,
          video: paths.video,
          references: existing.refs,
        });
        return { ...paths, audioConfigured: Boolean(existing.audioConfigured), reused: true };
      }
      inheritedRefs = Number(existing.refs || 0);
      this.brokerRefs.delete(paths.video);
      this.log(session, 'warn', 'go2rtc', 'GO2RTC_BROKER_RESTORED', 'Backend-Referenz bestand noch, aber go2rtc hatte den Stream verloren; Brokerpfad wird wiederhergestellt', {
        profile: profile.name,
        references: inheritedRefs,
      });
    }

    try {
      await go2RtcClient.upsertStream(paths.raw, rawSource);
      await go2RtcClient.waitUntilRegistered(paths.raw);
      this.log(session, 'info', 'go2rtc', 'GO2RTC_RAW_SOURCE_CONFIGURED', 'Zentraler nativer Kamera-Producer wurde in go2rtc angelegt und verifiziert', {
        profile: profile.name,
        transport: candidate.transport,
        raw: paths.raw,
        source: redactedSource(rawSource),
      });
      await go2RtcClient.upsertStream(paths.video, videoSource);
      await go2RtcClient.waitUntilRegistered(paths.video);
      this.log(session, 'info', 'go2rtc', 'GO2RTC_NORMALIZED_SOURCE_CONFIGURED', 'Getrennter H.264-Video-Pfad wurde aus dem Raw-Producer angelegt und verifiziert', {
        profile: profile.name,
        raw: paths.raw,
        video: paths.video,
        source: videoSource,
        encoder,
      });
      let audioConfigured = false;
      if (profile?.audioCodec) {
        const audioSource = optionalAudioSource(paths.raw, 20, encoder);
        try {
          await go2RtcClient.upsertStream(paths.audio, audioSource);
          await go2RtcClient.waitUntilRegistered(paths.audio);
          audioConfigured = true;
          this.log(session, 'info', 'go2rtc', 'GO2RTC_OPTIONAL_AUDIO_CONFIGURED', 'Optionaler AAC-Pfad wurde getrennt vom stabilen Video-Pfad angelegt', {
            profile: profile.name,
            audio: paths.audio,
            sourceCodec: profile.audioCodec,
          });
        } catch (error) {
          this.log(session, 'warn', 'go2rtc', 'GO2RTC_OPTIONAL_AUDIO_SKIPPED', 'Optionaler Audiopfad konnte nicht angelegt werden; Video bleibt davon unberührt', { error: error?.message });
        }
      }
      this.brokerRefs.set(paths.video, { refs: inheritedRefs + 1, raw: paths.raw, video: paths.video, audio: audioConfigured ? paths.audio : null, audioConfigured });
      session.brokerRefKey = paths.video;
      return { ...paths, audioConfigured, reused: false };
    } catch (error) {
      await Promise.allSettled([
        go2RtcClient.deletePreload(paths.video),
        go2RtcClient.deleteStream(paths.video),
        go2RtcClient.deleteStream(paths.raw),
      ]);
      throw error;
    }
  }

  async releaseBroker(session) {
    const key = session?.brokerRefKey;
    if (!key) return;
    session.brokerRefKey = null;
    const entry = this.brokerRefs.get(key);
    if (!entry) return;
    entry.refs = Math.max(0, Number(entry.refs || 1) - 1);
    if (entry.refs > 0) return;
    this.brokerRefs.delete(key);
    await Promise.allSettled([
      go2RtcClient.deletePreload(entry.video),
      go2RtcClient.deletePreload(entry.audio),
      go2RtcClient.deleteStream(entry.audio),
      go2RtcClient.deleteStream(entry.video),
      go2RtcClient.deleteStream(entry.raw),
    ]);
  }

  log(session, level, component, code, message, details = null) {
    cameraEventLog.append(session.cameraId, {
      level, component, code, message, details, sessionKey: session.key,
    });
    const payload = { cameraId: session.cameraId, sessionKey: session.key, code, ...((details && typeof details === 'object') ? details : {}) };
    if (level === 'error') logger.error(payload, message);
    else if (level === 'warn') logger.warn(payload, message);
    else if (level === 'debug') logger.debug(payload, message);
    else logger.info(payload, message);
  }

  phase(session, phase, message, details = null, level = 'info') {
    session.phase = phase;
    session.phaseMessage = message;
    session.phaseUpdatedAt = Date.now();
    this.log(session, level, 'stream', `STREAM_${phase.toUpperCase()}`, message, details);
  }

  async ensure(cameraId, { quality = 'auto', viewportWidth = 1280, profileToken = null, purpose = 'live', forceTranscode = false } = {}, { wait = true } = {}) {
    const consumerPurpose = normalizeConsumerPurpose(purpose);
    const effectiveForceTranscode = Boolean(forceTranscode && config.browserTranscodeFallbackEnabled && consumerPurpose !== 'kiosk');
    if (shouldUsePermanentIngest(consumerPurpose, effectiveForceTranscode)) {
      return this.ensurePermanentIngest(cameraId, { quality, viewportWidth, profileToken, purpose: consumerPurpose }, { wait });
    }
    if (this.closed) throw new AppError(503, 'STREAM_SERVICE_STOPPED', 'Stream-Dienst wird gerade beendet');
    const camera = cameraRepository.getWithCredentials(cameraId);
    if (!camera || !camera.enabled) throw new AppError(404, 'CAMERA_NOT_FOUND', 'Kamera nicht gefunden oder deaktiviert');
    const slot = sessionSlot(quality, viewportWidth, consumerPurpose);
    const requestedProfile = profileToken || null;
    const requestedSourceId = String(requestedProfile || '').startsWith('source:') ? Number(String(requestedProfile).slice(7)) : null;
    const validOnvifProfile = !requestedProfile || cameraRepository.profiles(cameraId).some((profile) => profile.token === requestedProfile);
    const validMediaSource = Number.isInteger(requestedSourceId) && cameraRepository.mediaSources(cameraId).some((source) => Number(source.id) === requestedSourceId && source.enabled);
    if (requestedProfile && !validOnvifProfile && !validMediaSource) {
      throw new AppError(400, 'INVALID_PROFILE', 'Das angeforderte Stream-Profil oder die Medienquelle gehoert nicht zu dieser Kamera');
    }
    const sharedMainstream = !effectiveForceTranscode && slot === 'high' && ['live', 'recording'].includes(consumerPurpose);
    const normalizedPurpose = effectiveForceTranscode ? 'browser-fallback' : sharedMainstream ? 'mainstream' : consumerPurpose;
    const keyPurpose = effectiveForceTranscode ? `browser-fallback-${consumerPurpose}` : normalizedPurpose;
    const key = sessionKey(cameraId, slot, requestedProfile, keyPurpose);
    let session = this.sessions.get(key);
    if (!session) {
      const inFlight = findCoalescableSession(this.sessions.values(), cameraId, requestedProfile, normalizedPurpose, consumerPurpose);
      if (inFlight) {
        session = inFlight;
        this.log(session, 'info', 'stream', 'SESSION_COALESCED', 'Paralleler Verbindungsaufbau wurde mit der laufenden Kamera-Sitzung zusammengeführt', {
          requestedQuality: slot,
          activeQuality: inFlight.quality,
        });
      } else {
        session = this.newSession(key, cameraId, slot, requestedProfile, camera.codecPreference || 'auto', camera.sourcePolicy || 'auto', normalizedPurpose, keyPurpose);
        session.consumerPurpose = consumerPurpose;
        session.forceTranscode = effectiveForceTranscode;
        this.sessions.set(key, session);
        this.log(session, 'info', 'stream', 'SESSION_CREATED', consumerPurpose === 'recording' ? 'Neue bedarfsgesteuerte Mainstream-Sitzung fuer die Aufnahme wurde angelegt' : 'Neue Live-Sitzung wurde angelegt', { quality: slot, requestedProfile: requestedProfile ? 'manuell' : 'automatisch', codecPreference: camera.codecPreference || 'auto', purpose: normalizedPurpose });
      }
    }
    session.lastRequestedAt = Date.now();
    session.consumerPurpose = consumerPurpose;
    session.forceTranscode = effectiveForceTranscode;
    session.codecPreference = camera.codecPreference || 'auto';
    session.sourcePolicy = camera.sourcePolicy || 'auto';
    if (!session.startPromise || ['failed', 'stopped'].includes(session.state)) {
      session.startFailure = null;
      session.startPromise = this.startSerialized(session, camera, viewportWidth).catch((error) => {
        session.state = 'failed';
        session.phase = 'failed';
        session.phaseMessage = error.message;
        session.lastError = error.message;
        session.startFailure = error;
        this.markCameraStreamError(session, error.message);
        this.log(session, 'error', 'stream', 'STREAM_START_FAILED', 'Live-Stream konnte mit keinem ONVIF-Profil gestartet werden', errorDetails(error));
        return null;
      });
    }
    if (!wait) {
      this.markCameraOnlineIfReady(session, 'ensure-no-wait');
      return this.publicSession(session, true);
    }
    await session.startPromise;
    if (session.state === 'failed') throw session.startFailure || new AppError(502, 'STREAM_START_FAILED', session.lastError || 'Live-Stream konnte nicht gestartet werden');
    this.markCameraOnlineIfReady(session, 'ensure-ready');
    return this.publicSession(session, true);
  }

  async ensurePermanentIngest(cameraId, { viewportWidth = 1280, profileToken = null, purpose = 'live' } = {}, { wait = true } = {}) {
    if (this.closed) throw new AppError(503, 'STREAM_SERVICE_STOPPED', 'Stream-Dienst wird gerade beendet');
    const camera = cameraRepository.getWithCredentials(cameraId);
    if (!camera || !camera.enabled) throw new AppError(404, 'CAMERA_NOT_FOUND', 'Kamera nicht gefunden oder deaktiviert');

    const slot = permanentQuality();
    const requestedProfile = permanentProfileToken(camera, profileToken);
    const permanentCodecPreference = config.permanentIngestProfile === 'auto-substream' ? 'auto' : (camera.codecPreference || 'auto');
    const requestedSourceId = String(requestedProfile || '').startsWith('source:') ? Number(String(requestedProfile).slice(7)) : null;
    const validOnvifProfile = !requestedProfile || cameraRepository.profiles(cameraId).some((profile) => profile.token === requestedProfile);
    const validMediaSource = Number.isInteger(requestedSourceId) && cameraRepository.mediaSources(cameraId).some((source) => Number(source.id) === requestedSourceId && source.enabled);
    if (requestedProfile && !validOnvifProfile && !validMediaSource) {
      throw new AppError(400, 'INVALID_PROFILE', 'Das angeforderte Stream-Profil oder die Medienquelle gehoert nicht zu dieser Kamera');
    }

    const key = sessionKey(cameraId, slot, requestedProfile, 'ingest');
    let session = this.sessions.get(key);
    if (!session) {
      session = this.newSession(key, cameraId, slot, requestedProfile, permanentCodecPreference, camera.sourcePolicy || 'auto', 'ingest');
      session.permanent = true;
      session.consumerPurpose = purpose || 'live';
      this.sessions.set(key, session);
      this.log(session, 'info', 'stream', 'PERMANENT_INGEST_CREATED', 'Permanenter Kamera-Publisher wurde angelegt', {
        quality: slot,
        requestedProfile: requestedProfile ? 'manuell' : 'automatisch',
        codecPreference: permanentCodecPreference,
        purpose: 'ingest',
        consumerPurpose: purpose || 'live',
      });
    }

    session.permanent = true;
    session.consumerPurpose = purpose || 'live';
    session.lastRequestedAt = Date.now();
    session.codecPreference = permanentCodecPreference;
    session.sourcePolicy = camera.sourcePolicy || 'auto';
    if (!session.startPromise || ['failed', 'stopped'].includes(session.state)) {
      session.startFailure = null;
      session.startPromise = this.startSerialized(session, camera, viewportWidth).catch((error) => {
        session.state = 'failed';
        session.phase = 'failed';
        session.phaseMessage = error.message;
        session.lastError = error.message;
        session.startFailure = error;
        this.markCameraStreamError(session, error.message);
        this.log(session, 'error', 'stream', 'PERMANENT_INGEST_START_FAILED', 'Permanenter Kamera-Publisher konnte nicht gestartet werden', errorDetails(error));
        this.scheduleRestart(session);
        return null;
      });
    }
    if (!wait) {
      this.markCameraOnlineIfReady(session, 'permanent-ingest-no-wait');
      return this.publicSession(session, true);
    }
    await session.startPromise;
    if (session.state === 'failed') throw session.startFailure || new AppError(502, 'STREAM_START_FAILED', session.lastError || 'Permanenter Kamera-Publisher konnte nicht gestartet werden');
    this.markCameraOnlineIfReady(session, 'permanent-ingest-ready');
    return this.publicSession(session, true);
  }

  newSession(key, cameraId, quality, requestedProfileToken = null, codecPreference = 'auto', sourcePolicy = 'auto', purpose = 'live', pathPurpose = purpose) {
    const base = streamPathBase(cameraId, quality, requestedProfileToken, pathPurpose);
    return {
      key, cameraId, quality, requestedProfileToken, codecPreference, sourcePolicy, purpose, mode: 'stream',
      permanent: purpose === 'ingest', consumerPurpose: null, forceTranscode: false,
      paths: { raw: null, video: null, audio: null, webrtc: `${base}_video`, hls: `${base}_video`, localHls: `${base}_hls` },
      state: 'idle', phase: 'idle', phaseMessage: 'Noch nicht gestartet', phaseUpdatedAt: Date.now(),
      process: null, snapshotPump: null, snapshotPumpChild: null, restartTimer: null, recoveryPromise: null,
      profile: null, probe: null, policy: null, transport: null, sourceId: null, sourceType: null, sourceLabel: null,
      activeCandidateKey: null, failedCandidates: new Map(),
      outputs: { webrtc: false, hls: false }, lastError: null,
      stderr: '', stderrLines: [], progressBuffer: '', progressTracker: createStreamProgressTracker(), createdAt: Date.now(), lastRequestedAt: Date.now(),
      lastProgressAt: null, lastStreamBrokerAliveAt: null, lastProgressSource: null, restartCount: 0, connectedAt: null, startPromise: null, cacheBuster: Date.now(),
      attemptIndex: 0, attemptCount: 0, currentAttempt: null, ffmpegPid: null, startFailure: null,
      lastLoggedStderrLine: null, lastLoggedStderrAt: 0, recordingRefs: 0, brokerRefKey: null, brokerEncoder: null,
      stableProfileToken: null, stableProfileRole: null, stableProfileName: null,
    };
  }

  async orderedAttempts(onvif, profiles, session, viewportWidth, failures, mediaSources = []) {
    let selectedProfiles = chooseProfiles(profiles, session.quality, viewportWidth, session.codecPreference);
    if (!session.stableProfileToken && session.requestedProfileToken) {
      const requested = selectedProfiles.find((profile) => profile.token === session.requestedProfileToken);
      if (requested) selectedProfiles = [requested, ...selectedProfiles.filter((profile) => profile.token !== requested.token)];
    }

    const attempts = [];
    for (const [profileIndex, profile] of selectedProfiles.entries()) {
      try {
        this.phase(session, 'resolving', `ONVIF-Medienadresse für „${profile.name}“ wird abgefragt`, { profile: profile.name });
        const candidates = await onvif.streamCandidates(profile.token, undefined, profile.mediaService);
        for (const candidate of candidates) attempts.push({ profile, profileIndex, candidate: { ...candidate, sourceType: candidate.sourceType || inferMediaSourceKind(candidate.uri, 'auto'), priority: profileIndex * 10 } });
      } catch (error) {
        failures.push(`${profile.name}: ${error.message}`);
        this.log(session, 'warn', 'onvif', 'STREAM_URI_FAILED', `ONVIF lieferte für „${profile.name}“ keine nutzbare Medienadresse`, errorDetails(error));
      }
    }
    attempts.push(...manualStreamAttempts(mediaSources));
    const failureMemory = session.failedCandidates || new Map();
    session.failedCandidates = failureMemory;
    const now = Date.now();
    for (const [key, failedAt] of failureMemory.entries()) {
      if (now - failedAt >= SOURCE_FAILURE_COOLDOWN_MS) failureMemory.delete(key);
    }
    for (const attempt of attempts) {
      if (failureMemory.has(candidateKey(attempt.candidate, attempt.profile?.token))) attempt.candidate.healthRank = 3;
    }
    const ordered = sortMediaAttempts(attempts, session.sourcePolicy || 'auto');
    const requestedFirst = prioritizeRequestedSource(ordered, session.requestedProfileToken);
    return prioritizeStableProfile(requestedFirst, session.stableProfileToken);
  }

  async start(session, camera, viewportWidth) {
    if (session.restartTimer) {
      clearTimeout(session.restartTimer);
      session.restartTimer = null;
    }
    if (session.snapshotPump) { session.snapshotPump.stop(); session.snapshotPump = null; session.snapshotPumpChild = null; }
    session.state = 'starting';
    session.lastError = null;
    session.outputs = { webrtc: false, hls: false };
    session.mode = 'stream';
    session.sourceId = null;
    session.sourceType = null;
    session.sourceLabel = null;
    session.activeCandidateKey = null;
    session.paths.recording = null;
    session.audioEnabled = false;
    session.localHlsUrl = null;
    session.attemptIndex = 0;
    session.currentAttempt = null;
    this.phase(session, 'go2rtc_check', 'go2rtc-Verfügbarkeit wird geprüft');
    try {
      const info = await go2RtcClient.info();
      this.log(session, 'info', 'go2rtc', 'GO2RTC_READY', 'go2rtc-API ist erreichbar', { version: info?.version || null });
    } catch (error) {
      throw new AppError(502, 'GO2RTC_UNAVAILABLE', 'go2rtc ist über die interne Control-API nicht erreichbar', error.message);
    }

    const directStream = camera.connectionType === 'stream';
    const onvif = directStream ? null : new OnvifClient(camera);
    const mediaSources = cameraRepository.mediaSources(camera.id);
    let profiles = cameraRepository.profiles(camera.id);
    const hadStoredProfiles = profiles.length > 0;
    this.phase(session, 'profile_loading', hadStoredProfiles ? `${profiles.length} gespeicherte ONVIF-Profile und ${mediaSources.length} alternative Quellen werden geprüft` : 'ONVIF-Profile und alternative Medienquellen werden geladen', { storedProfiles: profiles.length, alternativeSources: mediaSources.length, sourcePolicy: session.sourcePolicy });
    if (!profiles.length && !directStream) {
      try {
        profiles = await onvif.profiles();
        cameraRepository.replaceProfiles(camera.id, profiles);
        this.log(session, 'info', 'onvif', 'PROFILES_DISCOVERED', `${profiles.length} ONVIF-Profile wurden geladen`, {
          profiles: profiles.map((profile) => ({ name: profile.name, videoCodec: profile.videoCodec, audioCodec: profile.audioCodec, width: profile.width, height: profile.height, role: profile.role })),
        });
      } catch (error) {
        if (!mediaSources.some((source) => source.enabled)) throw error;
        profiles = [];
        this.log(session, 'warn', 'onvif', 'PROFILES_UNAVAILABLE_USING_ALTERNATIVES', 'ONVIF-Profile sind nicht erreichbar; alternative Medienquellen werden trotzdem geprüft', errorDetails(error));
      }
    }
    const failures = [];
    if (directStream) this.log(session, 'info', 'stream', 'DIRECT_STREAM_SOURCE', 'Direkter Netzwerkstream wird ohne ONVIF-Profilauflösung gestartet', { alternativeSources: mediaSources.length });
    const passes = hadStoredProfiles && !directStream ? 2 : 1;

    for (let pass = 0; pass < passes; pass += 1) {
      if (pass === 1) {
        try {
          this.phase(session, 'profile_refresh', 'Gespeicherte Profile schlugen fehl; ONVIF-Profile werden neu eingelesen', null, 'warn');
          profiles = await onvif.profiles();
          cameraRepository.replaceProfiles(camera.id, profiles);
          failures.push('Gespeicherte Profile fehlgeschlagen; ONVIF-Profile wurden automatisch aktualisiert.');
        } catch (error) {
          failures.push(`Profilaktualisierung: ${error.message}`);
          this.log(session, 'error', 'onvif', 'PROFILE_REFRESH_FAILED', 'ONVIF-Profile konnten nicht aktualisiert werden', errorDetails(error));
          break;
        }
      }

      const attempts = await this.orderedAttempts(onvif, profiles, session, viewportWidth, failures, mediaSources);
      session.attemptCount = attempts.length;
      this.log(session, 'info', 'stream', 'ATTEMPTS_PREPARED', `${attempts.length} Streamvarianten werden systematisch geprüft`, {
        order: attempts.map(({ profile, candidate }) => ({ profile: profile.name, sourceType: candidate.sourceType || 'onvif', sourceLabel: candidate.sourceLabel || null, videoCodec: profile.videoCodec, videoProfile: profile.videoProfile, transport: candidate.transport, endpoint: candidate.endpoint || null, endpointReason: candidate.endpointReason || null })),
      });
      for (const [index, { profile, candidate }] of attempts.entries()) {
        session.attemptIndex = index + 1;
        session.currentAttempt = { profile: profile.name, sourceType: candidate.sourceType || 'onvif', sourceLabel: candidate.sourceLabel || null, transport: candidate.transport };
        try {
          this.phase(session, 'broker_configuring', `Variante ${index + 1}/${attempts.length}: ${profile.name} über ${candidate.transport.toUpperCase()} wird an go2rtc übergeben`, {
            attempt: index + 1,
            total: attempts.length,
            profile: profile.name,
            sourceType: candidate.sourceType || 'onvif',
            sourceLabel: candidate.sourceLabel || null,
            transport: candidate.transport,
            endpoint: candidate.endpoint || null,
            endpointReason: candidate.endpointReason || null,
          });
          // Reset observations from any previous failed source attempt.
          session.observedVideoCodec = null;
          const sourceUri = injectCredentials(candidate.uri, camera.username, camera.password);
          const probe = profileMedia(profile);
          let policy = normalizedBrokerPolicy(profile);
          this.log(session, 'info', 'stream', 'BROKER_PROFILE_METADATA', `Profilinformationen für „${profile.name}“ wurden ohne blockierende Kamera-ffprobe übernommen`, {
            profile: profile.name,
            sourceType: candidate.sourceType || 'onvif',
            sourceLabel: candidate.sourceLabel || null,
            videoCodec: profile.videoCodec || null,
            videoProfile: profile.videoProfile || null,
            transport: candidate.transport,
            endpoint: candidate.endpoint || null,
            endpointReason: candidate.endpointReason || null,
            media: probe,
            policy,
          });
          this.phase(session, 'publishing', session.permanent
            ? `Zentraler Dauer-Broker für „${profile.name}“ wird aufgebaut`
            : `Zentraler Broker und lokaler HLS-Ring für „${profile.name}“ werden aufgebaut`, { profile: profile.name, transport: candidate.transport, browserVideoMode: 'broker-normalized' });
          const failureKey = brokerStreamPaths(camera.id, profile, candidate).video;
          const failedEncoders = this.brokerEncoderFailures.get(failureKey) || new Map();
          const encoders = brokerEncoderCandidates(profile, config.go2RtcFfmpegHardware, config.go2RtcH264CopyFirst)
            .filter((mode) => mode === 'software' || !failedEncoders.has(mode));
          this.log(session, 'info', 'go2rtc', 'BROKER_ENCODER_CANDIDATES', 'Encoder werden fuer das Kameraprofil vorbereitet', {
            profile: profile.name,
            declaredVideoCodec: profile.videoCodec || null,
            copyFirst: config.go2RtcH264CopyFirst,
            configuredHardware: config.go2RtcFfmpegHardware,
            availableEncoders: encoders,
            stickyEncoderFailures: [...failedEncoders.keys()],
          });
          for (const [encoderIndex, encoder] of encoders.entries()) {
            session.brokerEncoder = encoder;
            try {
              session.outputs = await this.launch(session, camera, sourceUri, candidate, profile, probe, policy);
              break;
            } catch (encodeError) {
              await this.kill(session);
              if (encoderIndex === encoders.length - 1 || !isBrokerEncoderRetryable(encodeError)) throw encodeError;
              failedEncoders.set(encoder, Date.now());
              this.brokerEncoderFailures.set(failureKey, failedEncoders);
              const copyFailure = encoder === 'copy';
              this.log(session, 'warn', 'go2rtc', copyFailure ? 'GO2RTC_H264_COPY_FALLBACK' : 'INTEL_VAAPI_CPU_FALLBACK',
                copyFailure ? 'H.264-Kopie lieferte keinen startbereiten Stream; dieses Profil wird umkodiert'
                  : 'Intel-VAAPI schlug fuer dieses Profil fehl; nur dieses Profil wechselt zu Software-Encoding', {
                  profile: profile.name, failedEncoder: encoder, retryEncoder: encoders[encoderIndex + 1],
                  code: encodeError.code || null,
                  declaredVideoCodec: profile.videoCodec || null,
                  observedVideoCodec: encodeError.details?.observedVideoCodec || null,
                  safeReason: encodeError.details?.reason || null,
                });
            }
          }
          policy = normalizedBrokerPolicy(profile, session.brokerEncoder);
          if (session.observedVideoCodec) policy.sourceVideoCodec = session.observedVideoCodec;
          if (candidate.sourceId) cameraRepository.updateMediaSourceStatus(candidate.sourceId, 'available', null);
          if (session.mode !== 'go2rtc-managed' && (!session.process || session.process.exitCode !== null)) {
            throw new AppError(502, 'FFMPEG_EXITED', 'FFmpeg wurde während der Stream-Aktivierung beendet', sanitize(session.stderr));
          }
          session.state = 'ready';
          session.phase = 'ready';
          session.phaseMessage = `${profile.name} ist live`;
          session.profile = profile;
          session.probe = probe;
          session.policy = policy;
          session.transport = candidate.transport;
          session.sourceId = candidate.sourceId || null;
          session.sourceType = candidate.sourceType || 'onvif';
          session.sourceLabel = candidate.sourceLabel || profile.name;
          session.activeCandidateKey = candidateKey(candidate, profile.token);
          session.failedCandidates.delete(session.activeCandidateKey);
          const previousStableProfile = session.stableProfileToken;
          session.stableProfileToken = profile.token || null;
          session.stableProfileRole = profile.role || null;
          session.stableProfileName = profile.name || null;
          if (previousStableProfile !== session.stableProfileToken) {
            const requestedProfile = session.requestedProfileToken
              ? profiles.find((item) => item.token === session.requestedProfileToken)
              : null;
            const downgraded = Boolean(requestedProfile && requestedProfile.token !== profile.token)
              || (!requestedProfile && session.quality === 'high' && profile.role !== 'high');
            this.log(session, downgraded ? 'warn' : 'info', 'stream', downgraded ? 'STREAM_PROFILE_DOWNGRADED' : 'STREAM_PROFILE_PINNED',
              downgraded
                ? `Gewünschtes Mainstream-Profil war nicht stabil; „${profile.name}“ wird für diese Sitzung als funktionierender Fallback beibehalten`
                : `„${profile.name}“ wird als stabiles Profil für weitere Reconnects beibehalten`, {
                requestedProfile: requestedProfile?.name || session.requestedProfileToken || null,
                requestedQuality: session.quality,
                activeProfile: profile.name,
                activeRole: profile.role || null,
              });
          }
          session.connectedAt = Date.now();
          session.cacheBuster = session.connectedAt;
          session.lastProgressAt = Date.now();
          session.lastStreamBrokerAliveAt = session.lastProgressAt;
          session.lastProgressSource = 'startup';
          session.restartCount = 0;
          session.lastError = null;
          cameraRepository.updateStatus(camera.id, 'online');
          this.log(session, 'info', 'stream', 'STREAM_READY', 'Live-Stream ist bereit', { profile: profile.name, sourceType: session.sourceType, sourceLabel: session.sourceLabel, videoCodec: profile.videoCodec, videoProfile: profile.videoProfile, quality: session.quality, codecPreference: session.codecPreference, sourcePolicy: session.sourcePolicy, transport: candidate.transport, copyVideo: policy.copyVideo, videoEncoder: session.brokerEncoder, observedVideoCodec: session.observedVideoCodec || null, sourceAudio: probe.audio?.codec || null, outputs: session.outputs });
          return;
        } catch (error) {
          session.failedCandidates.set(candidateKey(candidate, profile.token), Date.now());
          const summary = `${profile.name}/${candidate.transport}: ${error.message}`;
          failures.push(summary);
          if (candidate.sourceId) cameraRepository.updateMediaSourceStatus(candidate.sourceId, 'failed', String(error.details || error.message || error).slice(0, 1200));
          session.lastError = error.message;
          if (error?.code === 'PROFILE_MEDIA_TIMEOUT') {
            this.log(session, 'warn', 'stream', 'PROFILE_MEDIA_TIMEOUT_DOWNGRADE', `„${profile.name}“ lieferte keine ersten Medienframes; Auto wechselt ohne weitere Encoder-Versuche auf das naechste Profil`, {
              profile: profile.name,
              profileToken: profile.token || null,
              profileRole: profile.role || null,
              transport: candidate.transport,
              timeoutMs: error?.details?.firstFrameTimeoutMs || null,
            });
          }
          this.log(session, 'warn', 'stream', 'ATTEMPT_FAILED', `Streamvariante ${session.attemptIndex}/${session.attemptCount} ist fehlgeschlagen`, {
            profile: profile.name,
            sourceType: candidate.sourceType || 'onvif',
            sourceLabel: candidate.sourceLabel || null,
            transport: candidate.transport,
            endpoint: candidate.endpoint || null,
            endpointReason: candidate.endpointReason || null,
            error: errorDetails(error),
            ffmpeg: session.stderrLines.slice(-30),
          });
          await this.kill(session);
        }
      }
    }
    try {
      this.phase(session, 'snapshot_fallback', 'Bewegte Streamquellen sind nicht erreichbar; Snapshot-Video-Fallback wird aufgebaut', null, 'warn');
      const initialSnapshot = await snapshotService.capture(camera.id, session.requestedProfileToken);
      const fallbackProfile = { token: 'snapshot-video-fallback', name: 'Snapshot-Video-Fallback', role: 'fallback' };
      const fallbackProbe = {
        video: { codec: 'mjpeg', width: widthForQuality(session.quality), height: Math.round(widthForQuality(session.quality) * 9 / 16), fps: config.snapshotVideoFps },
        audio: null,
        bitRate: null,
      };
      const fallbackPolicy = {
        copyVideo: false,
        transcodeVideo: true,
        sourceVideoCodec: 'jpeg',
        outputVideoCodec: 'h264',
        reason: 'Snapshots werden serverseitig wiederholt und als kontinuierlicher H.264-Stream ausgegeben.',
      };
      session.outputs = await this.launchSnapshotVideo(session, camera, initialSnapshot, fallbackProfile, fallbackProbe, fallbackPolicy);
      session.state = 'ready';
      session.phase = 'ready';
      session.phaseMessage = 'Snapshot-Video-Fallback ist live';
      session.mode = 'snapshot-video';
      session.profile = fallbackProfile;
      session.probe = fallbackProbe;
      session.policy = fallbackPolicy;
      session.transport = 'snapshot-video';
      session.sourceId = null;
      session.sourceType = 'snapshot';
      session.sourceLabel = 'Snapshot-Video-Fallback';
      session.activeCandidateKey = 'snapshot-video-fallback';
      session.connectedAt = Date.now();
      session.cacheBuster = session.connectedAt;
      session.lastProgressAt = Date.now();
      session.restartCount = 0;
      session.lastError = null;
      cameraRepository.updateStatus(camera.id, 'online');
      this.log(session, 'warn', 'stream', 'SNAPSHOT_VIDEO_FALLBACK_READY', 'Snapshots werden ohne Bildwechsel im Browser als H.264-Livestream ausgegeben', {
        fps: config.snapshotVideoFps,
        refreshMs: config.snapshotRefreshMs,
        outputs: session.outputs,
        failures: failures.slice(-10),
      });
      return;
    } catch (snapshotError) {
      failures.push(`Snapshot-Video-Fallback: ${snapshotError.message}`);
      await this.kill(session);
    }
    throw new AppError(502, 'STREAM_START_FAILED', 'Keine Video-, HLS-, MJPEG-, RTMP-, SRT- oder Snapshot-Quelle konnte gestartet werden', failures.slice(-25));
  }

  publishUrl(path) {
    return `${config.go2RtcPublishBase.replace(/\/$/, '')}/${path}`;
  }

  localHlsDirectory(session) {
    const key = safePathPart(session?.paths?.localHls || session?.paths?.hls || session?.key || 'stream');
    return path.join(config.localHlsDir, key);
  }

  localHlsPlaylist(session) {
    return path.join(this.localHlsDirectory(session), 'index.m3u8');
  }

  publicLocalHlsUrl(session) {
    const key = encodeURIComponent(safePathPart(session?.paths?.localHls || session?.paths?.hls || session?.key || 'stream'));
    return `${config.publicLocalHlsBase.replace(/\/$/, '')}/${key}/index.m3u8`;
  }

  cleanLocalHls(session) {
    try { fs.rmSync(this.localHlsDirectory(session), { recursive: true, force: true }); } catch { /* best effort */ }
  }

  localHlsReady(session) {
    try {
      const playlist = this.localHlsPlaylist(session);
      const text = fs.readFileSync(playlist, 'utf8');
      if (!text.includes('#EXTM3U')) return false;
      const directory = this.localHlsDirectory(session);
      return fs.readdirSync(directory).some((name) => name.endsWith('.ts') && fs.statSync(path.join(directory, name)).size > 1880);
    } catch {
      return false;
    }
  }

  async waitUntilLocalHlsReady(session, { timeoutMs = config.startTimeoutMs, intervalMs = 250 } = {}) {
    const started = Date.now();
    let polls = 0;
    while (Date.now() - started < timeoutMs) {
      polls += 1;
      if (session.process && (session.process.exitCode !== null || session.process.killed)) {
        return { ready: false, polls, processExited: true };
      }
      if (this.localHlsReady(session)) return { ready: true, polls, processExited: false };
      if (polls === 1 || polls % 12 === 0) {
        this.log(session, 'info', 'stream', 'LOCAL_HLS_READINESS_POLL', 'Lokaler HLS-Ring wird vor der Browserfreigabe geprüft', { polls, playlist: this.localHlsPlaylist(session) });
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return { ready: false, polls, processExited: false };
  }

  async stopMediaChild(session, child) {
    if (!child) return;
    child.__tmpExpectedExit = true;
    if (session.process === child) session.process = null;
    session.ffmpegPid = null;
    if (!child.killed && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 1800)),
      ]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }

  async launch(session, camera, sourceUri, candidate, profile, probe, policy) {
    const broker = await this.acquireBroker(session, camera, profile, candidate, sourceUri);

    session.mode = 'local-hls-ring';
    session.progressTracker = createStreamProgressTracker();
    session.lastProgressAt = Date.now();
    session.lastProgressSource = 'go2rtc-broker-start';
    const outputDir = this.localHlsDirectory(session);

    const startRing = async (brokerName, includeAudio) => {
      this.cleanLocalHls(session);
      fs.mkdirSync(outputDir, { recursive: true });
      session.stderr = '';
      session.stderrLines = [];
      session.progressBuffer = '';
      session.progressTracker = createStreamProgressTracker();
      // Consume the broker through go2rtc's HTTP MPEG-TS endpoint. This uses
      // the same API process that registered the stream and avoids RTSP 404s
      // caused by stale/duplicate Docker DNS targets or an RTSP registry that
      // is not the same runtime instance as the Control API.
      const brokerReadUrl = go2RtcClient.streamTsUrl(brokerName);
      const args = buildLocalHlsRingArgs({
        sourceUri: brokerReadUrl,
        outputDir,
        includeAudio,
        segmentSeconds: config.localHlsSegmentSeconds,
        listSize: config.localHlsListSize,
      });
      const child = spawn(config.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      child.__tmpExpectedExit = false;
      session.process = child;
      session.ffmpegPid = child.pid || null;
      child.stdout.on('data', (chunk) => this.onProgress(session, chunk));
      child.stderr.on('data', (chunk) => this.onStderr(session, chunk));
      child.once('error', (error) => this.onExit(session, child, 1, error?.message || 'error'));
      child.once('exit', (code, signal) => this.onExit(session, child, code, signal));

      this.log(session, 'info', 'ffmpeg', 'LOCAL_HLS_FFMPEG_STARTED', 'Lokaler HLS-Ring wurde aus dem normalisierten go2rtc-Pfad gestartet', {
        pid: child.pid,
        profile: profile.name,
        rawBroker: broker.raw,
        normalizedBroker: brokerName,
        brokerReused: broker.reused,
        audioRequested: includeAudio,
        brokerInput: 'go2rtc-http-mpegts',
        output: this.publicLocalHlsUrl(session),
      });
      this.phase(session, 'local_hls_wait', 'Lokaler HLS-Ring wartet auf die ersten normalisierten Medienframes', {
        profile: profile.name,
        transport: candidate.transport,
        rawBroker: broker.raw,
        normalizedBroker: brokerName,
        audioRequested: includeAudio,
        brokerInput: 'go2rtc-http-mpegts',
      });
      const autoProfileSelection = !session.requestedProfileToken && !session.stableProfileToken;
      const firstFrameTimeoutMs = autoProfileSelection
        ? Math.min(config.startTimeoutMs, config.streamAutoProfileFirstFrameTimeoutMs)
        : config.startTimeoutMs;
      const outcome = await this.waitUntilLocalHlsReady(session, { timeoutMs: firstFrameTimeoutMs, intervalMs: 250 });
      return { child, outcome, details: sanitize(session.stderr), brokerName, includeAudio, firstFrameTimeoutMs };
    };

    let ring = null;
    if (broker.audioConfigured) {
      ring = await startRing(broker.audio, true);
      if (!ring.outcome.ready) {
        await this.stopMediaChild(session, ring.child);
        this.cleanLocalHls(session);
        this.log(session, 'warn', 'go2rtc', 'BROKER_AUDIO_FALLBACK', 'Audiopfad war nicht rechtzeitig nutzbar; derselbe Raw-Producer wird ohne Audio weiterverwendet', {
          profile: profile.name,
          sourceAudioCodec: profile.audioCodec || null,
          ffmpeg: ring.details,
        });
        ring = null;
        probe.audio = null;
      }
    }
    if (!ring) ring = await startRing(broker.video, false);

    if (!ring.outcome.ready) {
      const details = ring.details;
      await this.kill(session, ring.child);
      throw new AppError(502, 'PROFILE_MEDIA_TIMEOUT', 'Das Profil lieferte nicht rechtzeitig normalisierte Medienframes; das naechste Profil wird versucht', {
        processExited: ring.outcome.processExited,
        mode: 'broker-local-hls',
        profile: profile.name,
        profileToken: profile.token || null,
        profileRole: profile.role || null,
        transport: candidate.transport,
        rawBroker: broker.raw,
        normalizedBroker: ring.brokerName,
        audioRequested: ring.includeAudio,
        firstFrameTimeoutMs: ring.firstFrameTimeoutMs,
        reason: 'no-normalized-media-frames',
        playlist: this.localHlsPlaylist(session),
        ffmpeg: details,
      });
    }

    if (session.brokerEncoder === 'copy') {
      // Camera metadata is not always correct. Ensure that the copied stream
      // really contains H.264 before serving it to browser-HLS consumers.
      // A wrong codec or failed inspection follows the normal per-source
      // fallback (VAAPI -> CPU), not a global GPU disable.
      let observedCodec = null;
      let probeError = null;
      const segments = fs.readdirSync(outputDir)
        .filter((name) => /^seg_[0-9]+\.ts$/.test(name))
        .sort().reverse().slice(0, 3);
      // Probe completed TS files (not the camera URL). This does not open an
      // extra RTSP connection and never exposes credentials in logs.
      for (const segment of segments) {
        try {
          const { stdout } = await execFileAsync(config.ffprobePath, [
            '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name',
            '-of', 'default=noprint_wrappers=1', path.join(outputDir, segment),
          ], { timeout: 3500, maxBuffer: 16 * 1024 });
          observedCodec = parseFfprobeVideoCodec(stdout);
          if (observedCodec) break;
        } catch (error) {
          probeError = error?.code || error?.name || 'probe-failed';
        }
      }
      if (observedCodec !== 'h264') {
        throw new AppError(502, 'STREAM_NOT_READY', 'H.264-Kopie wurde durch Videopruefung abgelehnt', {
          observedVideoCodec: observedCodec,
          reason: !segments.length ? 'no-completed-segment' : observedCodec ? 'non-h264-video' : String(probeError || 'no-codec-found'),
        });
      }
      session.observedVideoCodec = observedCodec;
      if (probe?.video) probe.video.codec = observedCodec;
      if (probe) probe.source = 'verified-local-hls-segment';
      this.log(session, 'info', 'go2rtc', 'BROKER_CODEC_VERIFIED', 'Tatsaechlicher H.264-Codec des Kamerastreams vor Browserfreigabe bestaetigt', {
        profile: profile.name,
        declaredVideoCodec: profile.videoCodec || null,
        observedVideoCodec: observedCodec,
        encoder: session.brokerEncoder,
        evidence: 'ffprobe-local-hls-segment',
      });
    }

    session.paths.recording = ring.brokerName;
    session.audioEnabled = ring.includeAudio && Boolean(probe.audio);
    const brokerOutcome = await go2RtcClient.waitUntilAnyReady([broker.raw, ring.brokerName], {
      timeoutMs: Math.min(2500, config.startTimeoutMs),
      intervalMs: 250,
    }).catch((error) => ({ ready: {}, apiError: error?.message || String(error), polls: 0 }));
    const rawReady = Boolean(brokerOutcome.ready?.[broker.raw]);
    const normalizedReady = Boolean(brokerOutcome.ready?.[ring.brokerName]);

    session.lastStreamBrokerAliveAt = Date.now();
    session.lastProgressAt = session.lastStreamBrokerAliveAt;
    session.lastProgressSource = 'local-hls-ready';
    const outputs = { webrtc: false, hls: true };
    session.webrtcAudio = false;
    session.localHlsUrl = this.publicLocalHlsUrl(session);
    this.log(session, 'info', 'stream', 'LOCAL_HLS_READY', 'Lokaler HLS-Ring liefert eine Playlist und Videosegmente', {
      hlsPolls: ring.outcome.polls,
      audioEnabled: session.audioEnabled,
      output: session.localHlsUrl,
    });
    this.log(session, 'info', 'stream', 'PUBLISHER_READY', 'Zentraler go2rtc-Broker und lokaler Browser-HLS-Ring sind bereit', {
      outputs,
      brokerPolls: brokerOutcome.polls || 0,
      brokerApiError: brokerOutcome.apiError || null,
      rawReady,
      normalizedReady,
      audioEnabled: session.audioEnabled,
      mode: 'local-hls-ring',
    });
    return outputs;
  }

  async launchSnapshotVideo(session, camera, initialSnapshot, profile, probe, policy) {
    this.cleanLocalHls(session);
    const outputDir = this.localHlsDirectory(session);
    fs.mkdirSync(outputDir, { recursive: true });
    const width = widthForQuality(session.quality);
    const height = Math.round(width * 9 / 16);
    const args = buildSnapshotLocalHlsArgs({
      outputDir,
      width,
      height,
      fps: config.snapshotVideoFps,
      segmentSeconds: config.localHlsSegmentSeconds,
      listSize: config.localHlsListSize,
    });
    const child = spawn(config.ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    child.__tmpExpectedExit = false;
    child.stdin.on('error', () => {});
    session.process = child;
    session.ffmpegPid = child.pid || null;
    session.mode = 'snapshot-video';
    session.stderr = '';
    session.stderrLines = [];
    session.progressBuffer = '';
    session.progressTracker = createStreamProgressTracker();
    session.lastProgressAt = Date.now();
    session.snapshotPumpChild = child;
    session.snapshotPump = startSnapshotFramePump({
      child,
      initialBuffer: initialSnapshot.buffer,
      capture: () => snapshotService.capture(camera.id, session.requestedProfileToken),
      fps: config.snapshotVideoFps,
      refreshMs: config.snapshotRefreshMs,
      onFetchError: (error, consecutiveErrors) => {
        if (consecutiveErrors === 1 || consecutiveErrors % 10 === 0) {
          this.log(session, 'warn', 'snapshot', 'SNAPSHOT_REFRESH_FAILED', 'Neuer Snapshot konnte nicht geladen werden; das letzte gültige Bild bleibt im Stream', {
            consecutiveErrors,
            error: sanitizeLogText(error?.message || String(error), 800),
          });
        }
      },
    });

    this.log(session, 'info', 'ffmpeg', 'SNAPSHOT_LOCAL_HLS_STARTED', 'Snapshot-Video wird direkt als lokaler HLS-Ring erzeugt', {
      pid: child.pid || null,
      profile: profile.name,
      fps: config.snapshotVideoFps,
      refreshMs: config.snapshotRefreshMs,
      dimensions: `${width}x${height}`,
      output: this.publicLocalHlsUrl(session),
      timeoutStrategy: 'node-process-watchdog',
    });

    child.stdout.on('data', (chunk) => this.onProgress(session, chunk));
    child.stderr.on('data', (chunk) => this.onStderr(session, chunk));
    child.once('error', (error) => this.onExit(session, child, 1, error?.message || 'error'));
    child.once('exit', (code, signal) => this.onExit(session, child, code, signal));

    this.phase(session, 'snapshot_hls_wait', 'Snapshot-Bilder werden in einen lokalen H.264-HLS-Ring umgewandelt', {
      profile: profile.name,
      pid: child.pid || null,
      fps: config.snapshotVideoFps,
    });
    const outcome = await this.waitUntilLocalHlsReady(session, { timeoutMs: config.startTimeoutMs, intervalMs: 250 });
    if (!outcome.ready) {
      const details = sanitize(session.stderr);
      await this.kill(session, child);
      throw new AppError(502, 'SNAPSHOT_STREAM_NOT_READY', 'Snapshot-Bilder konnten nicht als lokaler Browser-HLS-Ring veröffentlicht werden', {
        processExited: outcome.processExited,
        playlist: this.localHlsPlaylist(session),
        ffmpeg: details,
      });
    }
    if (child.exitCode !== null) throw new AppError(502, 'SNAPSHOT_FFMPEG_EXITED', 'Snapshot-FFmpeg wurde unmittelbar nach dem Start beendet', sanitize(session.stderr));

    session.localHlsUrl = this.publicLocalHlsUrl(session);
    const outputs = { webrtc: false, hls: true };
    this.log(session, 'info', 'stream', 'SNAPSHOT_LOCAL_HLS_READY', 'Snapshot-Video-Fallback liefert einen lokalen HLS-Ring', { outputs, output: session.localHlsUrl, polls: outcome.polls });
    return outputs;
  }

  onStderr(session, chunk) {
    session.stderr = `${session.stderr}${chunk}`.slice(-16000);
    const lines = String(chunk).split(/\r?\n/).map((line) => sanitizeLogText(line.trim(), 1200)).filter(Boolean);
    session.stderrLines.push(...lines);
    session.stderrLines = session.stderrLines.slice(-120);
    const important = [...lines].reverse().find((line) =>
      !isBenignFfmpegDiagnostic(line)
      && /(error|failed|invalid|refused|reset by peer|unauthorized|forbidden|timed? out|no route|unable|could not|401|403|404)/i.test(line));
    const now = Date.now();
    if (important && important !== session.lastLoggedStderrLine && now - session.lastLoggedStderrAt > 700) {
      session.lastLoggedStderrLine = important;
      session.lastLoggedStderrAt = now;
      this.log(session, 'warn', 'ffmpeg', 'FFMPEG_DIAGNOSTIC', 'FFmpeg meldet ein Problem während des Verbindungsaufbaus', {
        profile: session.currentAttempt?.profile || null,
        transport: session.currentAttempt?.transport || null,
        line: important,
      });
    }
  }

  onProgress(session, chunk) {
    session.progressBuffer = `${session.progressBuffer}${chunk}`.slice(-12000);
    const lines = session.progressBuffer.split(/\r?\n/);
    session.progressBuffer = lines.pop() || '';
    if (consumeFfmpegProgress(session.progressTracker, lines)) {
      session.lastProgressAt = Date.now();
      session.lastProgressSource = 'ffmpeg-progress';
    }
  }

  cameraHasHealthySession(cameraId, excludeSession = null) {
    const now = Date.now();
    return [...this.sessions.values()].some((candidate) => {
      if (!candidate || candidate === excludeSession || String(candidate.cameraId) !== String(cameraId)) return false;
      if (!['ready', 'recovering'].includes(candidate.state)) return false;
      if (['snapshot', 'snapshot-video'].includes(candidate.mode)) return true;
      if (this.isSessionProcessAlive(candidate)) return true;
      return Boolean(candidate.lastStreamBrokerAliveAt && now - Number(candidate.lastStreamBrokerAliveAt) <= config.streamStallSeconds * 1000);
    });
  }

  markCameraStreamError(session, error) {
    if (!session) return false;
    if (this.cameraHasHealthySession(session.cameraId, session)) {
      this.log(session, 'debug', 'stream', 'CAMERA_STATUS_ERROR_SUPPRESSED', 'Temporärer Streamfehler setzt die Kamera nicht auf Rot, weil ein anderer Stream derselben Kamera weiter gesund ist', {
        error: String(error || session.lastError || '').slice(0, 1200),
      });
      return false;
    }
    cameraRepository.updateStatus(session.cameraId, 'stream_error', error || session.lastError || null);
    return true;
  }

  markCameraOnlineIfReady(session, reason = 'ready-confirmed') {
    if (!session || session.state !== 'ready') return false;
    const current = cameraRepository.get(session.cameraId);
    if (!current || current.status === 'online') return false;
    cameraRepository.updateStatus(session.cameraId, 'online', null);
    this.log(session, 'debug', 'stream', 'CAMERA_STATUS_READY_SYNC', 'Bereite Stream-Sitzung korrigiert einen veralteten Kamera-Fehlerstatus auf online', {
      reason,
      previousStatus: current.status || null,
    });
    return true;
  }

  onExit(session, child, code, signal) {
    if (session.snapshotPump && session.snapshotPumpChild === child) {
      session.snapshotPump.stop();
      session.snapshotPump = null;
      session.snapshotPumpChild = null;
    }
    if (session.process === child) session.process = null;
    session.ffmpegPid = null;
    if (child.__tmpExpectedExit) return;
    const details = sanitize(session.stderr) || `FFmpeg beendet (${code ?? signal})`;
    this.log(session, session.state === 'ready' ? 'error' : 'warn', 'ffmpeg', 'FFMPEG_EXIT', 'FFmpeg-Medienprozess wurde unerwartet beendet', { code, signal, ffmpeg: details });
    // Während eines Startversuchs übernimmt start()/launch() den Fallback. Erst ein
    // bereits laufender Stream darf hier einen automatischen Wiederaufbau auslösen.
    if (session.state !== 'ready') return;
    session.state = 'failed';
    session.phase = 'failed';
    session.phaseMessage = 'Medienprozess wurde beendet';
    session.lastError = details;
    if (session.activeCandidateKey) session.failedCandidates.set(session.activeCandidateKey, Date.now());
    if (session.sourceId) cameraRepository.updateMediaSourceStatus(session.sourceId, 'failed', session.lastError);
    this.markCameraStreamError(session, session.lastError);
    if (session.permanent || session.recordingRefs > 0 || Date.now() - session.lastRequestedAt < config.streamIdleSeconds * 1000) this.scheduleRestart(session);
  }

  isSessionProcessAlive(session) {
    return Boolean(session?.mode === 'go2rtc-managed' || (session?.process && session.process.exitCode === null && !session.process.killed));
  }

  isSessionStalled(session, now = Date.now()) {
    if (!session || session.state !== 'ready' || !session.lastProgressAt) return false;
    const progressAge = now - Number(session.lastProgressAt || 0);
    const mediaAge = session.lastStreamBrokerAliveAt ? now - Number(session.lastStreamBrokerAliveAt || 0) : Number.POSITIVE_INFINITY;
    return progressAge > config.streamStallSeconds * 1000 && mediaAge > config.streamStallSeconds * 1000;
  }

  async refreshStreamBrokerLiveness(session, reason = 'watchdog') {
    if (!session || session.state !== 'ready') return false;
    try {
      const mediaAlive = await this.hasStreamBrokerTracks(session);
      if (!mediaAlive) return false;
      const now = Date.now();
      session.lastStreamBrokerAliveAt = now;
      session.lastProgressAt = now;
      session.lastProgressSource = 'go2rtc-liveness';
      this.log(session, 'debug', 'stream', 'STREAM_BROKER_LIVENESS_OK', 'go2rtc sieht weiterhin aktive Spuren; Watchdog startet den Publisher nicht neu', { reason });
      return true;
    } catch (error) {
      const lastAliveAt = Number(session.lastStreamBrokerAliveAt || session.connectedAt || session.createdAt || 0);
      const withinGrace = Boolean(lastAliveAt) && Date.now() - lastAliveAt < config.streamBrokerApiGraceMs;
      if (withinGrace && this.isSessionProcessAlive(session)) {
        this.log(session, 'debug', 'stream', 'STREAM_BROKER_API_GRACE', 'go2rtc-API ist kurz nicht erreichbar; laufender FFmpeg-Prozess bleibt unangetastet', { reason, error: error?.message });
        return true;
      }
      return false;
    }
  }

  async recoverStalledSession(session, reason = 'watchdog') {
    if (!session) return false;
    if (session.recoveryPromise) return session.recoveryPromise;
    if (session.state !== 'ready') return false;
    const recovery = (async () => {
      const stalledForMs = Date.now() - Number(session.lastProgressAt || 0);
      const processAlive = this.isSessionProcessAlive(session) || ['snapshot', 'snapshot-video'].includes(session.mode);
      const hardStallMs = Math.max(config.streamHardStallSeconds * 1000, config.streamStallSeconds * 2000);
      if (processAlive && await this.refreshStreamBrokerLiveness(session, reason)) {
        this.log(session, 'debug', 'stream', 'STREAM_SOFT_STALL_IGNORED', 'FFmpeg-Fortschritt war alt, aber go2rtc oder der Browserpfad ist weiterhin lebendig; kein harter Neuaufbau', {
          reason,
          stalledForMs,
          hardStallMs,
          lastProgressSource: session.lastProgressSource,
        });
        return false;
      }
      if (processAlive && stalledForMs < hardStallMs) {
        this.log(session, 'debug', 'stream', 'STREAM_HARD_STALL_GRACE', 'Stream wirkt kurzzeitig still; harter Neustart wird bis zur Hard-Stall-Grenze unterdrueckt', {
          reason,
          stalledForMs,
          hardStallMs,
        });
        return false;
      }
      session.state = 'recovering';
      session.phase = 'recovering';
      session.phaseMessage = 'Stillstehender Stream wird neu aufgebaut';
      this.log(session, 'warn', 'stream', 'STREAM_STALLED', 'Stillstehenden Live-Stream erkannt', {
        reason,
        stalledForMs,
        processAlive,
      });
      await this.kill(session);
      session.state = 'failed';
      session.phase = 'failed';
      session.phaseMessage = 'Keine neuen Audio-/Videodaten empfangen';
      session.lastError = session.phaseMessage;
      if (session.activeCandidateKey) session.failedCandidates.set(session.activeCandidateKey, Date.now());
      if (session.sourceId) cameraRepository.updateMediaSourceStatus(session.sourceId, 'failed', session.lastError);
      this.markCameraStreamError(session, session.lastError);
      this.scheduleRestart(session);
      return true;
    })();
    session.recoveryPromise = recovery;
    try {
      return await recovery;
    } finally {
      if (session.recoveryPromise === recovery) session.recoveryPromise = null;
    }
  }

  async hasStreamBrokerTracks(session) {
    if (!session?.paths) return false;
    const paths = await go2RtcClient.paths();
    const names = session.mode === 'local-hls-ring' ? [session.paths.raw, session.paths.recording || session.paths.video].filter(Boolean) : [session.paths.webrtc, session.paths.hls].filter(Boolean);
    return names.some((name) => {
      const item = paths.get(name);
      return Boolean(go2RtcStreamReady(item) || Number(item?.readers?.length || 0) > 0 || Number(item?.consumers?.length || 0) > 0);
    });
  }

  scheduleRestart(session, requestedDelayMs = null) {
    if (session.restartTimer) return;
    const baseDelay = requestedDelayMs === null
      ? Math.min(config.streamRestartInitialDelayMs * (2 ** Math.min(session.restartCount, 5)), config.maxRestartBackoffMs)
      : Math.max(0, Number(requestedDelayMs) || 0);
    const errorText = String(session.lastError || '');
    const reasonDelay = /go2rtc|Stream-Broker|Broker|API|fetch failed|GO2RTC_UNAVAILABLE/i.test(errorText)
      ? Math.max(baseDelay, config.streamBrokerUnavailableRetryMs)
      : baseDelay;
    const jitter = config.streamRestartJitterMs > 0 ? Math.floor(Math.random() * config.streamRestartJitterMs) : 0;
    const delay = reasonDelay + jitter;
    session.restartCount += 1;
    this.log(session, 'warn', 'stream', 'AUTO_RESTART_SCHEDULED', 'Stream wird automatisch neu aufgebaut', { delay, restartCount: session.restartCount, error: session.lastError, jitter });
    session.restartTimer = setTimeout(() => {
      session.restartTimer = null;
      const camera = cameraRepository.getWithCredentials(session.cameraId);
      if (!camera || (!session.permanent && session.recordingRefs === 0 && Date.now() - session.lastRequestedAt >= config.streamIdleSeconds * 1000)) return;
      session.startPromise = this.startSerialized(session, camera, widthForQuality(session.quality)).catch((error) => {
        session.state = 'failed';
        session.phase = 'failed';
        session.phaseMessage = error.message;
        session.lastError = error.message;
        this.log(session, 'error', 'stream', 'AUTO_RESTART_FAILED', 'Automatischer Wiederaufbau ist fehlgeschlagen', errorDetails(error));
        this.scheduleRestart(session);
      });
    }, delay);
    session.restartTimer.unref?.();
  }

  findReusableReadySession(cameraId, requestedProfile = null, preferredQuality = null, consumerPurpose = 'recording') {
    const purpose = normalizeConsumerPurpose(consumerPurpose);
    const candidates = [...this.sessions.entries()]
      .filter(([, session]) => session.cameraId === cameraId
        && ['live', 'mainstream', 'ingest', 'recording', 'motion'].includes(session.purpose || 'live')
        && session.state === 'ready'
        && session.mode !== 'snapshot'
        && (session.requestedProfileToken || null) === (requestedProfile || null)
        && this.isSessionProcessAlive(session))
      .filter(([, session]) => {
        const role = session.profile?.role || session.quality;
        if (purpose === 'recording' && config.recordingPreferMainstream) return role === 'high' || session.quality === 'high';
        if (purpose === 'motion' && config.motionPreferSubstream) return session.purpose === 'ingest' || role === 'low' || session.quality === 'low';
        return true;
      });
    if (!candidates.length) return null;
    return candidates.sort(([, left], [, right]) => {
      const leftPermanent = Number(left.purpose === 'ingest');
      const rightPermanent = Number(right.purpose === 'ingest');
      if (purpose === 'motion' && leftPermanent !== rightPermanent) return rightPermanent - leftPermanent;
      const leftPreferred = Number(left.quality === preferredQuality);
      const rightPreferred = Number(right.quality === preferredQuality);
      if (leftPreferred !== rightPreferred) return rightPreferred - leftPreferred;
      const leftRefs = Number(left.recordingRefs || 0);
      const rightRefs = Number(right.recordingRefs || 0);
      if (leftRefs !== rightRefs) return leftRefs - rightRefs;
      return Number(right.lastRequestedAt || 0) - Number(left.lastRequestedAt || 0);
    })[0];
  }

  async retain(cameraId, { quality = 'balanced', viewportWidth = 1280, profileToken = null, purpose = 'recording' } = {}) {
    const consumerPurpose = purpose === 'motion' ? 'motion' : 'recording';
    const slot = sessionSlot(quality, viewportWidth, consumerPurpose);
    const requestedProfile = profileToken || null;
    const retainedPair = this.findReusableReadySession(cameraId, requestedProfile, slot, consumerPurpose);
    if (retainedPair) {
      const [key, session] = retainedPair;
      try {
        await this.ensureRetainedHls(session);
        session.recordingRefs += 1;
        session.lastRequestedAt = Date.now();
        this.log(session, 'info', consumerPurpose === 'motion' ? 'motion-detection' : 'recording', 'STREAM_RETAINED_REUSE', consumerPurpose === 'motion'
          ? 'Bewegungserkennung nutzt den ressourcenschonenden Substream-Publisher'
          : 'Aufnahme nutzt einen bereits laufenden Mainstream-Publisher', {
          recordingRefs: session.recordingRefs,
          pathType: consumerPurpose === 'motion' ? 'shared-substream-hls' : 'shared-mainstream-hls',
          quality: session.quality,
        });
        return { key, path: session.mode === 'local-hls-ring' ? (session.paths.recording || session.paths.video || session.paths.webrtc) : session.paths.hls, purpose: session.purpose || consumerPurpose, quality: session.quality, profile: session.profile, media: session.probe };
      } catch (error) {
        this.log(session, 'warn', consumerPurpose === 'motion' ? 'motion-detection' : 'recording', 'STREAM_RETAIN_REUSE_FAILED', 'Vorhandener Publisher konnte nicht weiterverwendet werden', errorDetails(error));
      }
    }

    const ready = await this.ensure(cameraId, { quality: slot, viewportWidth, profileToken: requestedProfile, purpose: consumerPurpose }, { wait: true });
    const key = ready?.paths
      ? [...this.sessions.entries()].find(([, candidate]) => candidate.cameraId === cameraId && candidate.paths?.hls === ready.paths.hls)?.[0]
      : sessionKey(cameraId, ready.quality, ready.requestedProfileToken || null, consumerPurpose);
    const session = this.sessions.get(key);
    if (!session || session.state !== 'ready') throw new AppError(502, 'STREAM_NOT_READY', 'Kamerastream ist fuer den Medienverbrauch nicht bereit');
    if (session.mode === 'snapshot') throw new AppError(409, 'SNAPSHOT_MODE_NOT_RECORDABLE', 'Der Snapshot-Livemodus kann nicht als Videoquelle verwendet werden');
    await this.ensureRetainedHls(session);
    session.recordingRefs += 1;
    session.lastRequestedAt = Date.now();
    this.log(session, 'info', consumerPurpose === 'motion' ? 'motion-detection' : 'recording', 'STREAM_RETAINED', consumerPurpose === 'motion'
      ? 'Substream wird durch die Bewegungserkennung aktiv gehalten'
      : 'Mainstream wird durch die Aufnahme aktiv gehalten', {
      recordingRefs: session.recordingRefs,
      pathType: consumerPurpose === 'motion' ? 'motion-substream-hls' : 'recording-mainstream-hls',
    });
    return { key, path: session.mode === 'local-hls-ring' ? (session.paths.recording || session.paths.video || session.paths.webrtc) : session.paths.hls, purpose: session.purpose || consumerPurpose, quality: session.quality, profile: session.profile, media: session.probe };
  }

  async ensureRetainedHls(session) {
    if (!session) throw new AppError(502, 'STREAM_NOT_READY', 'Kamerastream ist fuer den Medienverbrauch nicht bereit');
    if (session.mode === 'local-hls-ring') {
      if (!this.localHlsReady(session)) {
        const ready = await this.waitUntilLocalHlsReady(session, { timeoutMs: Math.min(8000, config.startTimeoutMs), intervalMs: 250 });
        session.outputs.hls = Boolean(ready.ready);
      }
      if (!session.outputs.hls) throw new AppError(502, 'RECORDING_PATH_NOT_READY', 'Der lokale HLS-Ring ist nicht bereit');
      return session;
    }
    if (!session.outputs.hls) {
      const extra = await go2RtcClient.waitUntilAnyReady([session.paths.hls], {
        timeoutMs: Math.min(8000, config.startTimeoutMs),
        intervalMs: 300,
        isProcessAlive: () => Boolean(session.process && session.process.exitCode === null && !session.process.killed),
      });
      session.outputs.hls = Boolean(extra.ready?.[session.paths.hls]);
    }
    if (!session.outputs.hls) throw new AppError(502, 'RECORDING_PATH_NOT_READY', 'Der AAC/HLS-Medienpfad fuer die Aufnahme ist nicht bereit');
    return session;
  }

  async retainedSession(key, { ensureHls = true } = {}) {
    let session = this.sessions.get(key);
    if (!session) return null;
    session.lastRequestedAt = Date.now();
    if (session.state !== 'ready' || !session.process || session.process.exitCode !== null || session.process.killed) {
      const camera = cameraRepository.getWithCredentials(session.cameraId);
      if (!camera || !camera.enabled) throw new AppError(404, 'CAMERA_NOT_FOUND', 'Kamera nicht gefunden oder deaktiviert');
      if (session.restartTimer) clearTimeout(session.restartTimer);
      session.restartTimer = null;
      session.startPromise = null;
      if (session.permanent || session.purpose === 'ingest') {
        await this.ensurePermanentIngest(session.cameraId, {
          viewportWidth: widthForQuality(session.quality),
          profileToken: session.requestedProfileToken,
          purpose: session.consumerPurpose || 'motion',
        }, { wait: true });
      } else {
        await this.ensure(session.cameraId, {
          quality: session.quality,
          viewportWidth: widthForQuality(session.quality),
          profileToken: session.requestedProfileToken,
          purpose: session.purpose || 'live',
        }, { wait: true });
      }
      session = this.sessions.get(key) || session;
    }
    if (ensureHls) await this.ensureRetainedHls(session);
    return this.publicSession(session, true);
  }

  findSession(cameraId, quality = 'auto', viewportWidth = 1280, profileToken = null, purpose = 'live', forceTranscode = false) {
    const consumerPurpose = normalizeConsumerPurpose(purpose);
    const effectiveForceTranscode = Boolean(forceTranscode && config.browserTranscodeFallbackEnabled);
    const slot = sessionSlot(quality, viewportWidth, consumerPurpose);
    const requestedProfile = profileToken || null;
    const actualPurpose = effectiveForceTranscode
      ? 'browser-fallback'
      : shouldUsePermanentIngest(consumerPurpose, false)
        ? 'ingest'
        : slot === 'high' && ['live', 'recording'].includes(consumerPurpose)
          ? 'mainstream'
          : consumerPurpose;
    const camera = cameraRepository.get(cameraId);
    const effectiveProfile = actualPurpose === 'ingest' ? permanentProfileToken(camera || {}, requestedProfile) : requestedProfile;
    const keyPurpose = effectiveForceTranscode ? `browser-fallback-${consumerPurpose}` : actualPurpose;
    return this.sessions.get(sessionKey(
      cameraId,
      actualPurpose === 'ingest' ? permanentQuality() : slot,
      effectiveProfile,
      keyPurpose,
    )) || [...this.sessions.values()].find((session) => session.cameraId === cameraId
      && (session.purpose || 'live') === actualPurpose
      && (actualPurpose !== 'browser-fallback' || (session.consumerPurpose || consumerPurpose) === consumerPurpose)
      && (!requestedProfile || (session.requestedProfileToken || null) === requestedProfile)
      && ['ready', 'starting', 'failed', 'recovering'].includes(session.state))
      || null;
  }


  async heartbeat(cameraId, { quality = 'auto', viewportWidth = 1280, profileToken = null, purpose = 'live', forceTranscode = false } = {}) {
    await this.ensure(cameraId, { quality, viewportWidth, profileToken, purpose, forceTranscode }, { wait: false });
    const session = this.findSession(cameraId, quality, viewportWidth, profileToken, purpose, forceTranscode);
    // Client heartbeats are leases, not restart orders. A visible browser can
    // still receive frames even when FFmpeg progress output is temporarily quiet,
    // so hard recovery is left to the backend watchdog after go2rtc checks.
    const current = this.findSession(cameraId, quality, viewportWidth, profileToken, purpose, forceTranscode) || session;
    this.markCameraOnlineIfReady(current, 'heartbeat-ready');
    return {
      serverTime: new Date().toISOString(),
      session: current ? this.publicSession(current, true) : null,
    };
  }

  release(key) {
    const session = this.sessions.get(key);
    if (!session) return;
    session.recordingRefs = Math.max(0, session.recordingRefs - 1);
    session.lastRequestedAt = Date.now();
    this.log(session, 'info', 'recording', 'STREAM_RELEASED', 'Aufnahme hat die Medien-Sitzung freigegeben', { recordingRefs: session.recordingRefs });
  }

  cancelControlResync(cameraId, reason = 'ptz-move') {
    const key = String(cameraId);
    const timer = this.controlResyncTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.controlResyncTimers.delete(key);
      for (const session of this.sessions.values()) {
        if (session.cameraId === cameraId && ['live', 'mainstream', 'ingest', 'browser-fallback'].includes(session.purpose || 'live')) {
          this.log(session, 'debug', 'stream', 'PTZ_LIVE_RESYNC_CANCELLED', 'Geplante Live-Resynchronisierung wurde durch neue PTZ-Aktivitaet verworfen', { reason });
        }
      }
    }
  }

  scheduleLiveResyncAfterControl(cameraId, reason = 'ptz-stop') {
    if (!config.ptzLiveResyncEnabled) return { scheduled: false, reason: 'disabled' };
    const key = String(cameraId);
    this.cancelControlResync(cameraId, `${reason}-replace`);
    const delay = Math.max(0, Number(config.ptzMotionSettleMs || 0) + Number(config.ptzLiveResyncDelayMs || 0));
    const timer = setTimeout(() => {
      this.controlResyncTimers.delete(key);
      void this.resyncLiveAfterControl(cameraId, reason).catch((error) => {
        logger.warn({ cameraId, reason, err: error }, 'Live-Resynchronisierung nach PTZ fehlgeschlagen');
      });
    }, delay);
    timer.unref?.();
    this.controlResyncTimers.set(key, timer);
    for (const session of this.sessions.values()) {
      if (session.cameraId === cameraId && ['live', 'mainstream', 'ingest', 'browser-fallback'].includes(session.purpose || 'live')) {
        this.log(session, 'info', 'stream', 'PTZ_LIVE_RESYNC_SCHEDULED', 'Live-Publisher wird nach PTZ stabilisiert und neu synchronisiert', { reason, delayMs: delay });
      }
    }
    return { scheduled: true, delayMs: delay };
  }

  async resyncLiveAfterControl(cameraId, reason = 'ptz-stop') {
    const targets = [...this.sessions.values()].filter((session) => session.cameraId === cameraId
      && ['live', 'mainstream', 'ingest', 'browser-fallback'].includes(session.purpose || 'live')
      && ['ready', 'recovering', 'failed', 'starting'].includes(session.state));
    let verified = 0;
    let recovered = 0;
    let restarted = 0;
    for (const session of targets) {
      session.lastRequestedAt = Date.now();
      if (session.restartTimer) {
        clearTimeout(session.restartTimer);
        session.restartTimer = null;
      }
      if (session.state === 'failed') {
        this.log(session, 'warn', 'stream', 'PTZ_LIVE_RESYNC_FAILED_RESTART', 'Fehlgeschlagener Live-Publisher wird nach PTZ neu gestartet', { reason });
        this.scheduleRestart(session, 0);
        restarted += 1;
        continue;
      }
      if (session.state !== 'ready') {
        this.log(session, 'debug', 'stream', 'PTZ_LIVE_RESYNC_DEFERRED', 'Live-Publisher ist noch nicht bereit; PTZ-Resync wartet auf normalen Aufbau', { reason, state: session.state });
        continue;
      }
      this.log(session, 'info', 'stream', 'PTZ_LIVE_RESYNC_VERIFY', 'PTZ beendet; Live-Publisher bleibt aktiv und wird nur auf Fortschritt geprüft', { reason, recordingRefs: session.recordingRefs });
      const result = await this.verifyProgressAfterControl(cameraId, Math.max(1000, config.ptzStreamVerifyMs), `${reason}-verify`);
      verified += Number(result.checked || 0);
      recovered += Number(result.recovered || 0);
      break;
    }
    return { checked: targets.length, verified, recovered, restarted };
  }

  async verifyProgressAfterControl(cameraId, delayMs = config.ptzStreamVerifyMs, reason = 'ptz-post-stop') {
    const targets = [...this.sessions.values()]
      .filter((session) => session.cameraId === cameraId && ['live', 'mainstream', 'ingest', 'browser-fallback'].includes(session.purpose || 'live') && session.state === 'ready');
    if (!targets.length) return { checked: 0, recovered: 0 };
    const results = await Promise.all(targets.map(async (session) => {
      if (session.controlVerifyPromise) return session.controlVerifyPromise;
      const verify = (async () => {
        const process = session.process;
        const progressUpdates = Number(session.progressTracker?.updates || 0);
        const lastProgressAt = Number(session.lastProgressAt || 0);
        const waitMs = Math.max(1000, Number(delayMs) || 5000);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        if (session.state !== 'ready' || session.process !== process) return false;
        const progressed = Number(session.progressTracker?.updates || 0) > progressUpdates
          || Number(session.lastProgressAt || 0) > lastProgressAt;
        if (progressed) return false;
        // A single missed 5-second progress window is not enough to terminate a
        // publisher. On slow NAS systems this created false-positive restarts
        // immediately after PTZ. Recover only when the normal stall threshold
        // is also exceeded or the FFmpeg process has actually disappeared.
        if (!this.isSessionProcessAlive(session) && !['snapshot', 'snapshot-video', 'go2rtc-managed'].includes(session.mode)) {
          return this.recoverStalledSession(session, `${reason}-process-missing`);
        }
        const staleForMs = Date.now() - Number(session.lastProgressAt || 0);
        const thresholdMs = Math.max(config.streamStallSeconds * 1000, waitMs * 2, 10_000);
        if (staleForMs < thresholdMs) return false;
        if (await this.refreshStreamBrokerLiveness(session, reason)) return false;
        return this.recoverStalledSession(session, reason);
      })();
      session.controlVerifyPromise = verify;
      try {
        return await verify;
      } finally {
        if (session.controlVerifyPromise === verify) session.controlVerifyPromise = null;
      }
    }));
    return { checked: targets.length, recovered: results.filter(Boolean).length };
  }

  async recoverCamera(cameraId, reason = 'runtime-coordinator') {
    const targets = [...this.sessions.values()].filter((session) => session.cameraId === cameraId && ['live', 'mainstream', 'ingest', 'browser-fallback'].includes(session.purpose || 'live'));
    let stalled = 0;
    let restarted = 0;
    let healthy = 0;
    const now = Date.now();
    for (const session of targets) {
      session.lastRequestedAt = now;
      if (session.state === 'ready' && this.isSessionStalled(session, now)) {
        await this.recoverStalledSession(session, reason);
        stalled += 1;
      } else if (session.state === 'ready' && !this.isSessionProcessAlive(session) && !['snapshot', 'snapshot-video', 'go2rtc-managed'].includes(session.mode)) {
        await this.recoverStalledSession(session, `${reason}-process-missing`);
        restarted += 1;
      } else if (session.state === 'failed' && !session.restartTimer) {
        this.scheduleRestart(session);
        restarted += 1;
      } else {
        healthy += 1;
      }
    }
    return { checked: targets.length, stalled, restarted, healthy };
  }

  async restart(cameraId) {
    const targets = [...this.sessions.values()].filter((session) => session.cameraId === cameraId && session.purpose !== 'recording' && Number(session.recordingRefs || 0) === 0);
    for (const session of targets) {
      if (session.restartTimer) clearTimeout(session.restartTimer);
      session.restartTimer = null;
      await this.kill(session);
      session.state = 'stopped';
      session.phase = 'stopped';
      session.phaseMessage = 'Manuell neu zu verbinden';
      session.startPromise = null;
      this.log(session, 'info', 'stream', 'MANUAL_RESTART', 'Stream wurde manuell zum Neuaufbau freigegeben');
    }
    return { restarted: targets.length };
  }

  async stopCamera(cameraId) {
    const targets = [...this.sessions.entries()].filter(([, session]) => session.cameraId === cameraId);
    for (const [key, session] of targets) {
      if (session.restartTimer) clearTimeout(session.restartTimer);
      await this.kill(session);
      this.sessions.delete(key);
      this.log(session, 'info', 'stream', 'SESSION_STOPPED', 'Live-Sitzung wurde beendet');
    }
  }

  async kill(session, child = session.process) {
    if (session.snapshotPump && (!session.snapshotPumpChild || session.snapshotPumpChild === child)) {
      session.snapshotPump.stop();
      session.snapshotPump = null;
      session.snapshotPumpChild = null;
    }
    if (child) {
      child.__tmpExpectedExit = true;
      if (session.process === child) session.process = null;
      session.ffmpegPid = null;
      if (!child.killed && child.exitCode === null) {
        child.kill('SIGTERM');
        await Promise.race([
          new Promise((resolve) => child.once('exit', resolve)),
          new Promise((resolve) => setTimeout(resolve, 1800)),
        ]);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
    }
    if (session?.brokerRefKey) await this.releaseBroker(session);
    if (['local-hls-ring', 'snapshot-video'].includes(session?.mode)) this.cleanLocalHls(session);
  }

  publicSession(session, includePaths = false) {
    const result = {
      cameraId: session.cameraId,
      purpose: session.purpose || 'live',
      quality: session.quality,
      requestedProfileToken: session.requestedProfileToken,
      state: session.state,
      phase: session.phase,
      phaseMessage: session.phaseMessage,
      phaseUpdatedAt: session.phaseUpdatedAt ? new Date(session.phaseUpdatedAt).toISOString() : null,
      attemptIndex: session.attemptIndex,
      attemptCount: session.attemptCount,
      currentAttempt: session.currentAttempt,
      profile: session.profile,
      media: session.probe,
      policy: session.policy,
      transport: session.transport,
      mode: session.mode || 'stream',
      sourceId: session.sourceId || null,
      sourceType: session.sourceType || null,
      sourceLabel: session.sourceLabel || null,
      sourcePolicy: session.sourcePolicy || 'auto',
      videoEncoder: session.brokerEncoder || null,
      outputs: { ...session.outputs },
      connectedAt: session.connectedAt ? new Date(session.connectedAt).toISOString() : null,
      lastProgressAt: session.lastProgressAt ? new Date(session.lastProgressAt).toISOString() : null,
      progressAgeMs: session.lastProgressAt ? Math.max(0, Date.now() - session.lastProgressAt) : null,
      lastStreamBrokerAliveAt: session.lastStreamBrokerAliveAt ? new Date(session.lastStreamBrokerAliveAt).toISOString() : null,
      streamBrokerAgeMs: session.lastStreamBrokerAliveAt ? Math.max(0, Date.now() - session.lastStreamBrokerAliveAt) : null,
      lastProgressSource: session.lastProgressSource || null,
      heartbeatAt: new Date().toISOString(),
      stalled: this.isSessionStalled(session),
      cacheBuster: session.cacheBuster || session.connectedAt || session.createdAt,
      lastError: session.lastError,
      restartCount: session.restartCount,
      ffmpegRunning: this.isSessionProcessAlive(session),
      retainedByRecordings: session.recordingRefs,
      permanent: Boolean(session.permanent),
      consumerPurpose: session.consumerPurpose || null,
      forceTranscode: Boolean(session.forceTranscode),
      localHlsUrl: session.localHlsUrl || (['local-hls-ring', 'snapshot-video'].includes(session.mode) ? this.publicLocalHlsUrl(session) : null),
    };
    if (includePaths) result.paths = { ...session.paths };
    return result;
  }

  compressionActivity(now = Date.now()) {
    const live = [...this.sessions.values()].filter((session) => ['live', 'mainstream', 'ingest', 'browser-fallback'].includes(session.purpose || 'live'));
    return {
      total: live.length,
      ready: live.filter((session) => session.state === 'ready').length,
      starting: live.filter((session) => session.state === 'starting').length,
      recovering: live.filter((session) => session.state === 'recovering').length,
      stalled: live.filter((session) => this.isSessionStalled(session, now)).length,
      missingProcess: live.filter((session) => session.state === 'ready'
        && !this.isSessionProcessAlive(session)
        && !['snapshot', 'snapshot-video', 'go2rtc-managed'].includes(session.mode)).length,
    };
  }

  status(cameraId) {
    return [...this.sessions.values()].filter((session) => session.cameraId === cameraId).map((session) => this.publicSession(session));
  }

  hasReady(cameraId) {
    return [...this.sessions.values()].some((session) => String(session.cameraId) === String(cameraId)
      && session.state === 'ready'
      && (this.isSessionProcessAlive(session) || ['snapshot', 'snapshot-video'].includes(session.mode)));
  }

  async maintenance() {
    if (this.closed) return;
    const now = Date.now();
    for (const [key, session] of this.sessions.entries()) {
      if (!session.permanent && session.recordingRefs === 0 && now - session.lastRequestedAt > config.streamIdleSeconds * 1000) {
        if (session.restartTimer) clearTimeout(session.restartTimer);
        await this.kill(session);
        session.state = 'stopped';
        session.phase = 'stopped';
        this.sessions.delete(key);
        this.log(session, 'info', 'stream', 'SESSION_IDLE_STOP', 'Live-Sitzung wurde wegen Inaktivität beendet');
        continue;
      }
      if (this.isSessionStalled(session, now) && !(await this.refreshStreamBrokerLiveness(session, 'backend-watchdog'))) await this.recoverStalledSession(session, 'backend-watchdog');
    }
  }

  async startPermanentIngestForCamera(cameraId, { wait = false, reason = 'camera-enabled' } = {}) {
    if (!config.permanentIngestEnabled) return { started: false, reason: 'disabled' };
    const camera = cameraRepository.getWithCredentials(cameraId);
    if (!camera || !camera.enabled) return { started: false, reason: 'camera-disabled-or-missing' };
    const task = this.ensurePermanentIngest(cameraId, {
      viewportWidth: widthForQuality(permanentQuality()),
      profileToken: null,
      purpose: 'kiosk',
    }, { wait }).catch((error) => {
      logger.warn({ cameraId, reason, err: error }, 'Permanenter Kamera-Publisher konnte nicht gestartet werden');
      return null;
    });
    if (wait) await task;
    return { started: true, reason, waited: Boolean(wait) };
  }

  async startPermanentIngestForAll({ wait = false, staggerMs = config.permanentIngestStartupStaggerMs } = {}) {
    if (!config.permanentIngestEnabled) return { started: 0, reason: 'disabled' };
    const cameras = cameraRepository.listEnabled();
    let started = 0;
    for (const [index, camera] of cameras.entries()) {
      const run = async () => {
        await this.startPermanentIngestForCamera(camera.id, { wait, reason: 'backend-startup' });
      };
      if (wait) await run();
      else {
        const delay = Math.max(0, Number(staggerMs) || 0) * index;
        const timer = setTimeout(() => { void run(); }, delay);
        timer.unref?.();
      }
      started += 1;
    }
    logger.info({ started, quality: permanentQuality(), permanentIngest: true }, 'Permanente Kamera-Publisher wurden initialisiert');
    return { started, quality: permanentQuality() };
  }

  async shutdown() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const timer of this.controlResyncTimers.values()) clearTimeout(timer);
    this.controlResyncTimers.clear();
    const sessions = [...this.sessions.values()];
    for (const session of sessions) {
      if (session.restartTimer) clearTimeout(session.restartTimer);
      session.restartTimer = null;
      session.state = 'stopping';
      session.phase = 'stopping';
    }
    await Promise.allSettled(sessions.map(async (session) => {
      try { await this.kill(session); }
      catch (error) { logger.warn({ cameraId: session.cameraId, sessionKey: session.key, err: error }, 'Stream konnte beim Herunterfahren nicht sauber beendet werden'); }
    }));
    this.sessions.clear();
  }
}

export const streamOrchestrator = new StreamOrchestrator();
