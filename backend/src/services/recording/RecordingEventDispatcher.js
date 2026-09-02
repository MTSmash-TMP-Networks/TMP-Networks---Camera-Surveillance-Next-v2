import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { cameraEventLog, sanitizeLogText } from '../CameraEventLog.js';
import { ptzAutomationInterlock } from '../runtime/PtzAutomationInterlock.js';
import { recordingPolicyRepository } from './RecordingPolicyRepository.js';
import { recordingScheduler } from './RecordingScheduler.js';

/**
 * Central ingress for automatic recording events.
 *
 * Events are stored synchronously, then the expensive plan evaluation is
 * coalesced. While PTZ is active (or still settling), automatic events are
 * explicitly suppressed before persistence. The scheduler and RecordingService
 * repeat the same check, so a race cannot bypass the interlock.
 */
class RecordingEventDispatcher {
  constructor() {
    this.timer = null;
    this.running = false;
    this.pending = [];
    this.lastRequestedAt = null;
    this.lastCompletedAt = null;
    this.lastError = null;
    this.totalEvents = 0;
    this.totalSuppressedEvents = 0;
    this.totalSchedulerRequests = 0;
    this.closed = false;
  }

  publish(cameraId, input = {}, { schedule = true, log = true, reason = 'event', automatic = true } = {}) {
    if (automatic) {
      const blocked = ptzAutomationInterlock.blockDetails(cameraId);
      if (blocked) {
        this.totalSuppressedEvents += 1;
        ptzAutomationInterlock.noteSuppressedEvent(cameraId);
        const suppressed = {
          id: null,
          cameraId: String(cameraId),
          type: String(input.type || 'event'),
          source: String(input.source || 'unknown'),
          state: String(input.state || 'pulse'),
          suppressed: true,
          code: 'RECORDING_EVENT_SUPPRESSED_PTZ',
          reason: blocked.reason,
          settleUntil: blocked.settleUntil,
          createdAt: new Date().toISOString(),
        };
        cameraEventLog.append(cameraId, {
          level: 'info', component: 'recording-event', code: 'RECORDING_EVENT_SUPPRESSED_PTZ',
          message: `Automatisches Aufnahmeereignis „${suppressed.type}“ wurde waehrend PTZ ignoriert`,
          details: {
            type: suppressed.type,
            source: suppressed.source,
            reason,
            activeLeases: blocked.activeLeases,
            activeUsers: blocked.activeUsers,
            settleUntil: blocked.settleUntil,
          },
        });
        return suppressed;
      }
    }

    const event = recordingPolicyRepository.addEvent(cameraId, input);
    this.totalEvents += 1;
    if (log) {
      cameraEventLog.append(cameraId, {
        level: event.severity === 'error' ? 'error' : event.severity === 'warn' ? 'warn' : 'info',
        component: 'recording-event',
        code: 'RECORDING_EVENT_PUBLISHED',
        message: `Aufnahmeereignis „${event.type}“ wurde registriert`,
        details: {
          eventId: event.id,
          type: event.type,
          source: event.source,
          state: event.state,
          expiresAt: event.expiresAt,
          reason,
          automatic: Boolean(automatic),
        },
      });
    }
    if (schedule) this.requestScheduler({ cameraId, eventId: event.id, type: event.type, source: event.source, reason });
    return { ...event, suppressed: false };
  }

  requestScheduler(reason = {}) {
    if (this.closed) return;
    this.totalSchedulerRequests += 1;
    this.pending.push({ ...reason, requestedAt: new Date().toISOString() });
    this.pending = this.pending.slice(-50);
    this.lastRequestedAt = new Date().toISOString();
    if (this.timer) return;
    const delay = Math.max(0, Number(config.recordingSchedulerImmediateDebounceMs) || 0);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch((error) => {
        this.lastError = sanitizeLogText(error?.message || String(error), 1000);
        logger.warn({ err: error }, 'Aufnahmeplaner konnte nach Ereignis nicht sofort ausgefuehrt werden');
      });
    }, delay);
    this.timer.unref?.();
  }

  async flush() {
    if (this.closed) return recordingScheduler.status();
    if (this.running) {
      if (!this.timer) this.requestScheduler({ reason: 'scheduler-busy' });
      return recordingScheduler.status();
    }
    this.running = true;
    const reasons = this.pending.splice(0);
    try {
      const result = await recordingScheduler.tick(new Date());
      this.lastError = null;
      this.lastCompletedAt = new Date().toISOString();
      if (reasons.length) logger.debug({ reasons: reasons.slice(-10), count: reasons.length }, 'Aufnahmeplaner wurde ereignisgesteuert ausgewertet');
      return result;
    } finally {
      this.running = false;
      if (this.pending.length && !this.timer) this.requestScheduler({ reason: 'pending-after-flush' });
    }
  }

  status() {
    return {
      running: this.running,
      pending: this.pending.length,
      timerActive: Boolean(this.timer),
      lastRequestedAt: this.lastRequestedAt,
      lastCompletedAt: this.lastCompletedAt,
      lastError: this.lastError,
      totalEvents: this.totalEvents,
      totalSuppressedEvents: this.totalSuppressedEvents,
      totalSchedulerRequests: this.totalSchedulerRequests,
      recentReasons: this.pending.slice(-10),
    };
  }

  shutdown() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = [];
  }
}

export const recordingEventDispatcher = new RecordingEventDispatcher();
