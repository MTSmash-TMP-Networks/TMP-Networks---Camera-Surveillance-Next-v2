import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { cameraRepository } from '../cameraRepository.js';
import { cameraEventLog } from '../CameraEventLog.js';
import { recordingService } from '../RecordingService.js';
import { streamOrchestrator } from '../media/StreamOrchestrator.js';
import { adminAlertService } from '../AdminAlertService.js';
import { recordingPolicyRepository } from './RecordingPolicyRepository.js';
import { ptzAutomationInterlock } from '../runtime/PtzAutomationInterlock.js';
import { evaluateRecordingPlans } from './RecordingSchedule.js';

async function mapLimit(items, limit, mapper) {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      await mapper(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, worker));
}

/**
 * Evaluates enabled cameras with bounded parallelism. Overlapping plans are
 * merged by RecordingSchedule; only one physical recorder per camera is used.
 */
class RecordingScheduler {
  constructor() {
    this.timer = null;
    this.running = false;
    this.lastRunAt = null;
    this.lastCompletedAt = null;
    this.lastError = null;
    this.decisions = new Map();
    this.prebufferLeases = new Map();
    this.prebufferFailures = new Map();
  }

  start() {
    if (this.timer) return;
    const run = () => this.tick().catch((error) => logger.error({ err: error }, 'Aufnahmeplanung fehlgeschlagen'));
    this.timer = setInterval(run, config.recordingSchedulerIntervalMs);
    this.timer.unref?.();
    setTimeout(run, Math.min(1500, config.recordingSchedulerIntervalMs)).unref?.();
    logger.info({ intervalMs: config.recordingSchedulerIntervalMs }, 'Aufnahmeplanung wurde gestartet');
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const cameraId of [...this.prebufferLeases.keys()]) this.releasePrebuffer(cameraId, 'scheduler-stopped');
    this.prebufferFailures.clear();
  }

  status() {
    return {
      running: Boolean(this.timer),
      busy: this.running,
      intervalMs: config.recordingSchedulerIntervalMs,
      lastRunAt: this.lastRunAt,
      lastCompletedAt: this.lastCompletedAt,
      lastError: this.lastError,
      prebufferedCameras: [...this.prebufferLeases.keys()],
      prebufferBackoffCameras: [...this.prebufferFailures.entries()]
        .filter(([, state]) => state.nextRetryAt > Date.now())
        .map(([cameraId, state]) => ({ cameraId, nextRetryAt: new Date(state.nextRetryAt).toISOString(), attempts: state.attempts })),
      decisions: [...this.decisions.entries()].map(([cameraId, decision]) => ({ cameraId, ...decision })),
    };
  }

  async tick(date = new Date()) {
    if (this.running) return this.status();
    this.running = true;
    this.lastRunAt = date.toISOString();
    this.lastError = null;
    try {
      const cameras = cameraRepository.listEnabled();
      const enabledCameraIds = new Set(cameras.map((camera) => camera.id));
      for (const cameraId of [...this.prebufferLeases.keys()]) {
        if (!enabledCameraIds.has(cameraId)) this.releasePrebuffer(cameraId, 'camera-disabled-or-removed');
      }
      for (const cameraId of [...this.prebufferFailures.keys()]) {
        if (!enabledCameraIds.has(cameraId)) this.prebufferFailures.delete(cameraId);
      }
      await mapLimit(cameras, config.recordingSchedulerConcurrency, (camera) => this.evaluateCamera(camera, date));
      this.lastCompletedAt = new Date().toISOString();
      return this.status();
    } catch (error) {
      this.lastError = 'Ein oder mehrere Aufnahmepläne konnten nicht ausgewertet werden.';
      throw error;
    } finally {
      this.running = false;
    }
  }

  releasePrebuffer(cameraId, reason = 'not-required') {
    const lease = this.prebufferLeases.get(cameraId);
    if (!lease) return;
    this.prebufferLeases.delete(cameraId);
    streamOrchestrator.release(lease.key);
    cameraEventLog.append(cameraId, {
      level: 'info', component: 'recording-scheduler', code: 'EVENT_PREBUFFER_RELEASED',
      message: 'Ereignis-Vorlaufpuffer wurde freigegeben', details: { reason, quality: lease.quality },
    });
  }

  async ensurePrebuffer(camera, decision) {
    const required = decision.eventStandby && decision.standbyPrebufferSeconds > 0 && !decision.shouldRecord;
    if (!required) {
      this.prebufferFailures.delete(camera.id);
      this.releasePrebuffer(camera.id, decision.shouldRecord ? 'recording-active' : 'outside-event-calendar');
      return { state: 'not-required' };
    }

    const failure = this.prebufferFailures.get(camera.id);
    if (failure?.nextRetryAt > Date.now()) {
      return { state: 'backoff', nextRetryAt: failure.nextRetryAt, attempts: failure.attempts };
    }
    const desired = {
      quality: decision.standbyQuality || 'balanced',
      profileToken: decision.standbyProfileToken || null,
      prebufferSeconds: Math.min(config.recordingPrebufferMaxSeconds, decision.standbyPrebufferSeconds),
    };
    const current = this.prebufferLeases.get(camera.id);
    if (current && current.quality === desired.quality && current.profileToken === desired.profileToken) {
      this.prebufferFailures.delete(camera.id);
      return { state: 'ready' };
    }
    if (current) this.releasePrebuffer(camera.id, 'configuration-changed');
    try {
      const retained = await streamOrchestrator.retain(camera.id, {
        quality: desired.quality, viewportWidth: 1280, profileToken: desired.profileToken, purpose: 'recording',
      });
      this.prebufferFailures.delete(camera.id);
      this.prebufferLeases.set(camera.id, { ...desired, key: retained.key, retainedAt: new Date().toISOString() });
      cameraEventLog.append(camera.id, {
        level: 'info', component: 'recording-scheduler', code: 'EVENT_PREBUFFER_READY',
        message: 'Kamerastream wird für den Ereignis-Vorlaufpuffer warm gehalten',
        details: { prebufferSeconds: desired.prebufferSeconds, quality: desired.quality, planIds: decision.standbyPlanIds },
      });
      return { state: 'ready' };
    } catch (error) {
      const attempts = (failure?.attempts || 0) + 1;
      const delayMs = Math.min(
        config.recordingReconnectMaxMs,
        config.recordingReconnectBaseMs * (2 ** Math.min(attempts - 1, 8)),
      );
      this.prebufferFailures.set(camera.id, { attempts, nextRetryAt: Date.now() + delayMs });
      throw error;
    }
  }

  async evaluateCamera(camera, date = new Date()) {
    const plans = recordingPolicyRepository.listPlans(camera.id);
    const events = recordingPolicyRepository.recentEvents(camera.id, { sinceHours: 48, limit: 1000 });
    const decision = evaluateRecordingPlans(plans, events, date);
    const active = recordingService.activeForCamera(camera.id);
    const ptzBlock = ptzAutomationInterlock.blockDetails(camera.id, date.getTime());
    const publicDecision = {
      shouldRecord: decision.shouldRecord,
      mode: decision.mode,
      planIds: decision.planIds,
      eventId: decision.eventId,
      eventStandby: decision.eventStandby,
      standbyPrebufferSeconds: Math.min(config.recordingPrebufferMaxSeconds, decision.standbyPrebufferSeconds || 0),
      evaluatedAt: date.toISOString(),
      action: 'none',
      ptzInterlock: ptzBlock || null,
    };

    try {
      if (decision.shouldRecord && !active && ptzBlock) {
        const prebuffer = await this.ensurePrebuffer(camera, { ...decision, shouldRecord: false });
        publicDecision.action = 'suppressed-ptz';
        publicDecision.suppressedReason = ptzBlock.reason;
        if (prebuffer.nextRetryAt) publicDecision.nextRetryAt = new Date(prebuffer.nextRetryAt).toISOString();
        cameraEventLog.append(camera.id, {
          level: 'info', component: 'recording-scheduler', code: 'RECORDING_START_SUPPRESSED_PTZ',
          message: 'Automatischer Aufnahmestart wurde waehrend der PTZ-Bedienung verschoben',
          details: { mode: decision.mode, planIds: decision.planIds, eventId: decision.eventId, ...ptzBlock },
        });
      } else if (decision.shouldRecord && !active) {
        await recordingService.start(camera.id, {
          quality: decision.quality,
          profileToken: decision.profileToken,
          triggerType: decision.mode,
          planId: decision.primaryPlanId,
          planIds: decision.planIds,
          eventId: decision.eventId,
          retentionClass: decision.eventId ? 'event' : 'standard',
          requestedBy: 'recording-scheduler',
          prebufferSeconds: decision.prebufferSeconds,
          automatic: true,
        });
        this.releasePrebuffer(camera.id, 'recording-started');
        publicDecision.action = 'started';
      } else if (!decision.shouldRecord && active && active.triggerType !== 'manual' && ptzBlock) {
        // Never tear down an already running recording while a user is moving
        // the camera. The scheduler reevaluates after the settle window and can
        // then stop it normally. This keeps FFmpeg and the live media path stable.
        this.releasePrebuffer(camera.id, 'recording-active-during-ptz');
        publicDecision.action = 'kept-active-ptz';
      } else if (!decision.shouldRecord && active && active.triggerType !== 'manual') {
        await recordingService.stop(active.id);
        const prebuffer = await this.ensurePrebuffer(camera, decision);
        publicDecision.action = prebuffer.state === 'backoff' ? 'prebuffer-backoff' : 'stopped';
        if (prebuffer.nextRetryAt) publicDecision.nextRetryAt = new Date(prebuffer.nextRetryAt).toISOString();
      } else if (decision.shouldRecord && active?.triggerType === 'manual') {
        this.releasePrebuffer(camera.id, 'manual-recording-active');
        // Manual recording wins; the scheduler starts its own run after manual stop.
        publicDecision.action = 'manual-active';
      } else if (decision.shouldRecord && active) {
        this.releasePrebuffer(camera.id, 'recording-active');
        publicDecision.action = 'kept-active';
      } else {
        const prebuffer = await this.ensurePrebuffer(camera, decision);
        publicDecision.action = prebuffer.state === 'backoff'
          ? 'prebuffer-backoff'
          : (decision.eventStandby && decision.standbyPrebufferSeconds > 0 ? 'prebuffering' : 'none');
        if (prebuffer.nextRetryAt) publicDecision.nextRetryAt = new Date(prebuffer.nextRetryAt).toISOString();
      }
      this.decisions.set(camera.id, publicDecision);
    } catch (error) {
      if (error?.code === 'AUTOMATIC_RECORDING_SUPPRESSED_PTZ') {
        publicDecision.action = 'suppressed-ptz';
        publicDecision.errorCode = error.code;
        publicDecision.ptzInterlock = error.details || ptzAutomationInterlock.blockDetails(camera.id);
        this.decisions.set(camera.id, publicDecision);
        return;
      }
      publicDecision.action = 'error';
      publicDecision.errorCode = error?.code || 'RECORDING_SCHEDULER_ERROR';
      this.decisions.set(camera.id, publicDecision);
      cameraEventLog.append(camera.id, {
        level: 'error', component: 'recording-scheduler', code: publicDecision.errorCode,
        message: 'Geplante Aufnahmeaktion konnte nicht ausgeführt werden',
        details: { mode: decision.mode, planIds: decision.planIds, error: error.message },
      });
      logger.error({ cameraId: camera.id, planIds: decision.planIds, err: error }, 'Geplante Aufnahmeaktion fehlgeschlagen');
      adminAlertService.notify({
        level: 'error', code: 'RECORDING_SCHEDULER_ERROR', cameraId: camera.id,
        message: 'Eine geplante Aufnahmeaktion ist fehlgeschlagen.',
        details: { mode: decision.mode, planIds: decision.planIds },
      }).catch(() => {});
    }
  }
}

export const recordingScheduler = new RecordingScheduler();
