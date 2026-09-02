import { config } from '../../config.js';
import { cameraEventLog, sanitizeLogText } from '../CameraEventLog.js';
import { logger } from '../../utils/logger.js';
import { CameraTaskCancelledError, PerCameraTaskQueue } from './CameraTaskQueue.js';
import { ptzAutomationInterlock } from './PtzAutomationInterlock.js';
import { ptzCommandRuntime } from '../ptz/PtzCommandRuntime.js';
import { ptzClientPool } from '../ptz/PtzClientPool.js';

export class PtzActiveError extends Error {
  constructor(cameraId, details = {}) {
    super('Motion-Erfassung wurde waehrend einer PTZ-Bewegung unterdrueckt');
    this.name = 'PtzActiveError';
    this.code = 'MOTION_SUPPRESSED_DURING_PTZ';
    this.cameraId = cameraId;
    this.details = details;
  }
}

/**
 * Coordinates only cross-domain runtime concerns. Recording control remains in
 * its own per-camera queue; PTZ moves use PtzCommandRuntime and never share that
 * queue. Motion captures are cancellable and are aborted when the PTZ interlock
 * enters active/settling state.
 */
class CameraRuntimeCoordinator {
  constructor() {
    this.recordingQueue = new PerCameraTaskQueue({ name: 'recording-control', maxPending: config.recordingQueueMaxPending });
    this.motionControllers = new Map();
    this.onPtzState = (state) => {
      if (state.blocked) this.abortMotionTasks(state.cameraId, state.reason || 'ptz-interlock');
    };
    ptzAutomationInterlock.on('state', this.onPtzState);
  }

  isPtzBusy(cameraId, at = Date.now()) {
    return ptzAutomationInterlock.isBlocked(cameraId, at);
  }

  abortMotionTasks(cameraId, reason = 'ptz-activity') {
    const id = String(cameraId);
    const controllers = this.motionControllers.get(id);
    if (!controllers?.size) return 0;
    let aborted = 0;
    for (const controller of [...controllers]) {
      if (!controller.signal.aborted) {
        controller.abort(new PtzActiveError(id, { reason }));
        aborted += 1;
      }
    }
    return aborted;
  }

  // Compatibility helper for discrete callers. Continuous PTZ does not use
  // this queue anymore, preventing input lag caused by a backlog of move pulses.
  async runPtzCommand(cameraId, action, task) {
    const temporaryId = `compat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    ptzAutomationInterlock.begin(cameraId, {
      interactionId: temporaryId,
      userId: 'runtime-compat',
      clientId: 'runtime-compat',
      action,
      ttlMs: Math.max(config.ptzLeaseTtlMs, config.ptzCommandTimeoutMs + 500),
    });
    try {
      return await task({ signal: null, queuedMs: 0, sequence: 0 });
    } finally {
      ptzAutomationInterlock.end(cameraId, {
        interactionId: temporaryId,
        userId: 'runtime-compat',
        clientId: 'runtime-compat',
        action: 'stop',
        reason: 'compat-command-complete',
      });
    }
  }

  async runMotionFrameTask(cameraId, task) {
    if (config.motionDetectionSkipDuringPtz && this.isPtzBusy(cameraId)) {
      throw new PtzActiveError(cameraId, { reason: 'ptz-active-before-capture' });
    }
    const id = String(cameraId);
    const controller = new AbortController();
    if (!this.motionControllers.has(id)) this.motionControllers.set(id, new Set());
    this.motionControllers.get(id).add(controller);
    try {
      const result = await task({ signal: controller.signal });
      if (config.motionDetectionSkipDuringPtz && this.isPtzBusy(cameraId)) {
        throw new PtzActiveError(cameraId, { reason: 'ptz-active-after-capture' });
      }
      return result;
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason) throw controller.signal.reason;
      throw error;
    } finally {
      const controllers = this.motionControllers.get(id);
      controllers?.delete(controller);
      if (controllers?.size === 0) this.motionControllers.delete(id);
    }
  }

  async runRecordingTask(cameraId, action, task) {
    return this.recordingQueue.enqueue(cameraId, async (context) => task(context), {
      type: action,
      priority: action === 'stop-recording' ? 20 : 10,
      timeoutMs: 0,
    });
  }

  status(cameraId = null) {
    const interlock = ptzAutomationInterlock.status(cameraId);
    return {
      ptz: Array.isArray(interlock) ? interlock : [interlock],
      ptzCommands: ptzCommandRuntime.status(cameraId),
      ptzClients: cameraId === null
        ? ptzClientPool.status()
        : ptzClientPool.status().filter((entry) => entry.cameraId === String(cameraId)),
      queues: {
        recording: this.recordingQueue.stats(cameraId),
      },
      motionCaptures: [...this.motionControllers.entries()]
        .filter(([id]) => cameraId === null || id === String(cameraId))
        .map(([id, controllers]) => ({ cameraId: id, active: controllers.size })),
    };
  }

  logRecoveredError(cameraId, component, code, message, error) {
    const details = { error: sanitizeLogText(error?.message || String(error), 800) };
    cameraEventLog.append(cameraId, { level: 'warn', component, code, message, details });
    logger.warn({ cameraId, code, err: error }, message);
  }

  shutdown() {
    ptzAutomationInterlock.off('state', this.onPtzState);
    for (const cameraId of [...this.motionControllers.keys()]) this.abortMotionTasks(cameraId, 'shutdown');
    this.motionControllers.clear();
    this.recordingQueue.shutdown?.();
  }
}

export const cameraRuntimeCoordinator = new CameraRuntimeCoordinator();
export { CameraTaskCancelledError };
