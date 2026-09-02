import crypto from 'node:crypto';
import { config } from '../../config.js';
import { cameraRepository } from '../cameraRepository.js';
import { cameraEventLog, sanitizeLogText } from '../CameraEventLog.js';
import { cameraRuntimeCoordinator } from '../runtime/CameraRuntimeCoordinator.js';
import { ptzAutomationInterlock } from '../runtime/PtzAutomationInterlock.js';
import { ptzClientPool } from './PtzClientPool.js';
import { ptzCommandRuntime } from './PtzCommandRuntime.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { streamOrchestrator } from '../media/StreamOrchestrator.js';
import { cameraAdvertisesPtz } from './ptzCapability.js';

function resolveProfile(cameraId, camera, requested) {
  const token = requested ? String(requested).trim() : '';
  const profiles = cameraRepository.profiles(cameraId);
  const requestedProfile = token ? profiles.find((item) => item.token === token) : null;
  const preferredProfile = profiles.find((item) => item.token === camera.preferredProfile);
  const profile = (requestedProfile?.hasPtz ? requestedProfile : null)
    || (preferredProfile?.hasPtz ? preferredProfile : null)
    || profiles.find((item) => item.hasPtz)
    || requestedProfile
    || preferredProfile
    || profiles[0];
  if (!profile) throw new AppError(409, 'PTZ_UNAVAILABLE', 'Kein ONVIF-Profil fuer die PTZ-Steuerung vorhanden');
  // Some cameras advertise a valid PTZ service through GetCapabilities but omit
  // PTZConfiguration from GetProfiles. Older releases then persisted hasPtz=false
  // and the UI blocked a camera that node-onvif can actually control. A genuine
  // advertised PTZ service is sufficient to try the selected/preferred profile;
  // the physical command remains the final authority and still returns an error
  // if that profile is not compatible.
  if (!profile.hasPtz && !cameraAdvertisesPtz(camera)) {
    throw new AppError(409, 'PTZ_UNAVAILABLE', 'Kein ONVIF-Profil dieser Kamera meldet PTZ-Unterstuetzung');
  }
  return profile;
}

function cameraAndProfile(cameraId, profileToken) {
  const camera = cameraRepository.getWithCredentials(cameraId);
  if (!camera) throw new AppError(404, 'CAMERA_NOT_FOUND', 'Kamera nicht gefunden');
  return { camera, profile: resolveProfile(cameraId, camera, profileToken) };
}

function actor(input = {}, actorContext = {}) {
  return {
    interactionId: String(input.interactionId || crypto.randomUUID()),
    clientId: String(input.clientId || actorContext.clientId || 'unknown-client'),
    userId: String(actorContext.userId || 'unknown-user'),
    sequence: Number(input.sequence || 0),
  };
}

class PtzService {
  constructor() {
    this.onCommandError = ({ cameraId, command, error }) => {
      cameraEventLog.append(cameraId, {
        level: 'warn', component: 'ptz', code: error?.code || 'PTZ_ASYNC_COMMAND_FAILED',
        message: 'Asynchroner PTZ-Befehl konnte nicht ausgefuehrt werden',
        details: {
          action: command?.action || 'move',
          interactionId: command?.interactionId || null,
          error: sanitizeLogText(error?.message || String(error), 500),
        },
      });
      logger.warn({ cameraId, err: error }, 'Asynchroner PTZ-Befehl fehlgeschlagen');
      ptzClientPool.invalidate(cameraId, command?.action === 'stop' ? 'stop' : 'move');
    };
    this.onRuntimeWarning = ({ cameraId, code, error }) => {
      logger.warn({ cameraId, code, err: error }, 'PTZ-Runtime hat einen wiederherstellbaren Fehler gemeldet');
    };
    this.onLeaseExpired = ({ cameraId }) => {
      // Never stop another user's still-active lease. Their next latest-wins
      // pulse replaces the expired command. If no lease remains, issue one
      // physical recovery stop so a lost browser tab cannot leave the camera moving.
      const state = ptzAutomationInterlock.status(cameraId);
      if (state.active) return;
      void this.recoveryStop(cameraId, 'lease-expired').catch((error) => {
        logger.warn({ cameraId, err: error }, 'PTZ-Recovery-Stop nach Lease-Ablauf fehlgeschlagen');
      });
    };
    ptzCommandRuntime.on('error', this.onCommandError);
    ptzCommandRuntime.on('warning', this.onRuntimeWarning);
    ptzAutomationInterlock.on('leasesExpired', this.onLeaseExpired);
  }

  interlockInput(profile, input, actorContext, action) {
    const owner = actor(input, actorContext);
    return {
      ...owner,
      profileToken: profile.token,
      action,
      // A physical stop may legitimately take longer than the normal browser
      // heartbeat lease. Keep the fence closed until the bounded ONVIF stop
      // request has either completed or failed into recovery handling.
      ttlMs: action === 'stop'
        ? Math.max(config.ptzLeaseTtlMs, config.ptzCommandTimeoutMs + 1000)
        : config.ptzLeaseTtlMs,
    };
  }

  async move(cameraId, input = {}, actorContext = {}) {
    const { camera, profile } = cameraAndProfile(cameraId, input.profileToken);
    streamOrchestrator.cancelControlResync(cameraId, 'ptz-move');
    const owner = this.interlockInput(profile, input, actorContext, 'move');
    const interlock = ptzAutomationInterlock.begin(cameraId, owner);
    if (interlock.stale) {
      return {
        ok: true,
        accepted: false,
        queued: false,
        stale: true,
        interactionId: owner.interactionId,
        profileToken: profile.token,
        automaticRecordingBlocked: interlock.blocked,
        interlock,
      };
    }
    for (const interactionId of interlock.supersededInteractions || []) {
      ptzCommandRuntime.cancelInteraction(cameraId, interactionId);
    }
    const client = ptzClientPool.get(camera, 'move');
    const command = {
      action: 'move',
      interactionId: owner.interactionId,
      clientId: owner.clientId,
      userId: owner.userId,
      sequence: owner.sequence,
      profileToken: profile.token,
      x: Number(input.x || 0),
      y: Number(input.y || 0),
      zoom: Number(input.zoom || 0),
    };
    const dispatch = ptzCommandRuntime.submitMove(
      cameraId,
      command,
      () => client.ptzMove(profile.token, command, config.ptzContinuousMoveTimeoutMs),
      {
        isInteractionActive: (interactionId) => ptzAutomationInterlock
          .status(cameraId).leases.some((lease) => lease.interactionId === interactionId),
      },
    );
    // ContinuousMove is refreshed several times per second. Persist only the
    // beginning of an interaction; queue/coalescing counters remain available
    // through the runtime status without blocking the event loop or SQLite.
    if (interlock.newLease) {
      cameraEventLog.append(cameraId, {
        level: 'info', component: 'ptz', code: 'PTZ_MOVE_ACCEPTED',
        message: 'PTZ-Interaktion wurde ohne Recording- oder Motion-Abhaengigkeit gestartet',
        details: {
          interactionId: owner.interactionId,
          sequence: owner.sequence,
          profileToken: profile.token,
          queued: dispatch.queued,
          automaticRecordingBlocked: true,
        },
      });
    }
    return {
      ok: true,
      accepted: dispatch.accepted,
      queued: dispatch.queued,
      interactionId: owner.interactionId,
      profileToken: profile.token,
      automaticRecordingBlocked: interlock.blocked,
      interlock,
    };
  }

  heartbeat(cameraId, input = {}, actorContext = {}) {
    const { camera, profile } = cameraAndProfile(cameraId, input.profileToken);
    void camera; // validates camera and credentials without contacting the device.
    const owner = this.interlockInput(profile, input, actorContext, 'move');
    const interlock = ptzAutomationInterlock.touch(cameraId, owner);
    return { ok: true, interactionId: owner.interactionId, profileToken: profile.token, interlock };
  }

  async stop(cameraId, input = {}, actorContext = {}) {
    const { camera, profile } = cameraAndProfile(cameraId, input.profileToken);
    const current = ptzAutomationInterlock.status(cameraId);
    const fallbackLease = !input.interactionId
      ? ptzAutomationInterlock.findLease(cameraId, {
        userId: actorContext.userId,
        clientId: actorContext.clientId,
      })
      : null;
    if (!input.interactionId && !fallbackLease && current.activeLeases > 0) {
      throw new AppError(409, 'PTZ_INTERACTION_REQUIRED', 'Eine aktive PTZ-Interaktion eines anderen Clients darf nicht ohne Interaktions-ID gestoppt werden');
    }
    const normalizedInput = { ...input, interactionId: input.interactionId || fallbackLease?.interactionId || `legacy-${actorContext.userId || 'user'}` };
    const owner = this.interlockInput(profile, normalizedInput, actorContext, 'stop');
    const leaseExists = current.leases.some((lease) => lease.interactionId === owner.interactionId);
    if (leaseExists) ptzAutomationInterlock.touch(cameraId, owner);

    if (!leaseExists && current.activeLeases > 0) {
      return {
        ok: true,
        interactionId: owner.interactionId,
        profileToken: profile.token,
        physicalStopSkipped: true,
        alreadyClosed: true,
        reason: 'other-active-leases',
        interlock: ptzAutomationInterlock.status(cameraId),
      };
    }

    if (leaseExists && current.activeLeases > 1) {
      cameraEventLog.append(cameraId, {
        level: 'warn', component: 'ptz', code: 'PTZ_LEASE_INVARIANT_RECOVERED',
        message: 'Mehrere PTZ-Leases wurden erkannt; ein physischer Sicherheits-Stop wird dennoch ausgefuehrt',
        details: { interactionId: owner.interactionId, activeLeases: current.activeLeases },
      });
    }

    const client = ptzClientPool.get(camera, 'stop');
    try {
      await ptzCommandRuntime.stop(cameraId, () => client.ptzStop(profile.token), { interactionId: owner.interactionId });
      const interlock = ptzAutomationInterlock.end(cameraId, {
        ...owner,
        action: 'stop',
        reason: input.reason || 'user-stop',
      });
      cameraEventLog.append(cameraId, {
        level: 'info', component: 'ptz', code: 'PTZ_STOP_OK',
        message: 'PTZ wurde priorisiert gestoppt; die automatische Aufnahme bleibt bis zum Ende der Stabilisierungsphase gesperrt',
        details: {
          interactionId: owner.interactionId,
          profileToken: profile.token,
          remainingLeases: interlock.activeLeases,
          settleUntil: interlock.settleUntil,
        },
      });
      void streamOrchestrator.verifyProgressAfterControl(cameraId, config.ptzStreamVerifyMs, 'ptz-stop').catch((error) => {
        logger.warn({ cameraId, err: error }, 'Stream-Pruefung nach PTZ-Stop fehlgeschlagen');
      });
      if (!interlock.active && Number(interlock.activeLeases || 0) === 0) {
        streamOrchestrator.scheduleLiveResyncAfterControl(cameraId, 'ptz-stop');
      }
      return { ok: true, interactionId: owner.interactionId, profileToken: profile.token, interlock };
    } catch (error) {
      // Keep the lease alive. It expires into a physical recovery stop instead
      // of prematurely reopening automatic recording while the camera may move.
      if (leaseExists) {
        try { ptzAutomationInterlock.touch(cameraId, owner); } catch { /* best effort */ }
      }
      cameraEventLog.append(cameraId, {
        level: 'error', component: 'ptz', code: error?.code || 'PTZ_STOP_FAILED',
        message: 'PTZ-Stop ist fehlgeschlagen; Automationssperre bleibt bis zum Recovery-Ablauf aktiv',
        details: { interactionId: owner.interactionId, error: sanitizeLogText(error.message || String(error), 500) },
      });
      ptzClientPool.invalidate(cameraId, 'stop');
      throw error;
    }
  }

  async recoveryStop(cameraId, reason = 'runtime-recovery') {
    const { camera, profile } = cameraAndProfile(cameraId, null);
    const client = ptzClientPool.get(camera, 'stop');
    await ptzCommandRuntime.stop(cameraId, () => client.ptzStop(profile.token), { interactionId: `recovery:${reason}` });
    cameraEventLog.append(cameraId, {
      level: 'warn', component: 'ptz', code: 'PTZ_RECOVERY_STOP',
      message: 'Ein verwaister PTZ-Vorgang wurde durch einen Recovery-Stop beendet',
      details: { reason, profileToken: profile.token },
    });
    void streamOrchestrator.verifyProgressAfterControl(cameraId, config.ptzStreamVerifyMs, 'ptz-recovery-stop').catch(() => {});
    streamOrchestrator.scheduleLiveResyncAfterControl(cameraId, 'ptz-recovery-stop');
    return { ok: true };
  }

  async runDiscrete(cameraId, action, profileToken, input, actorContext, callback) {
    const { camera, profile } = cameraAndProfile(cameraId, profileToken);
    const owner = this.interlockInput(profile, input, actorContext, action);
    ptzAutomationInterlock.begin(cameraId, owner);
    try {
      const client = ptzClientPool.get(camera, 'discrete');
      await ptzCommandRuntime.runDiscrete(cameraId, { action, interactionId: owner.interactionId }, () => callback(client, profile));
      return { ok: true, profileToken: profile.token, interactionId: owner.interactionId };
    } catch (error) {
      ptzClientPool.invalidate(cameraId, 'discrete');
      cameraEventLog.append(cameraId, {
        level: 'warn', component: 'ptz', code: error?.code || 'PTZ_COMMAND_FAILED',
        message: 'PTZ-Befehl konnte nicht ausgefuehrt werden',
        details: { action, interactionId: owner.interactionId, error: sanitizeLogText(error.message || String(error), 500) },
      });
      throw error;
    } finally {
      try {
        ptzAutomationInterlock.end(cameraId, { ...owner, action: 'stop', reason: `${action}-complete` });
      } catch { /* lease may already have expired */ }
      void streamOrchestrator.verifyProgressAfterControl(cameraId, config.ptzStreamVerifyMs, `ptz-${action}-complete`).catch(() => {});
      streamOrchestrator.scheduleLiveResyncAfterControl(cameraId, `ptz-${action}-complete`);
    }
  }

  async home(cameraId, input = {}, actorContext = {}) {
    return this.runDiscrete(cameraId, 'home', input.profileToken, input, actorContext, (client, profile) => client.ptzHome(profile.token));
  }

  async presets(cameraId, profileToken) {
    const { camera, profile } = cameraAndProfile(cameraId, profileToken);
    try {
      return await ptzClientPool.get(camera, 'discrete').presets(profile.token);
    } catch (error) {
      ptzClientPool.invalidate(cameraId, 'discrete');
      cameraEventLog.append(cameraId, {
        level: 'warn', component: 'ptz', code: 'PTZ_PRESETS_FAILED',
        message: 'PTZ-Presets konnten nicht geladen werden',
        details: { error: sanitizeLogText(error.message || String(error), 500) },
      });
      throw error;
    }
  }

  async gotoPreset(cameraId, presetToken, input = {}, actorContext = {}) {
    return this.runDiscrete(cameraId, 'gotoPreset', input.profileToken, input, actorContext, (client, profile) => client.gotoPreset(profile.token, presetToken));
  }

  status(cameraId) {
    return cameraRuntimeCoordinator.status(cameraId);
  }

  shutdown() {
    ptzCommandRuntime.off('error', this.onCommandError);
    ptzCommandRuntime.off('warning', this.onRuntimeWarning);
    ptzAutomationInterlock.off('leasesExpired', this.onLeaseExpired);
    ptzCommandRuntime.shutdown();
    ptzClientPool.shutdown();
  }
}

export const ptzService = new PtzService();
