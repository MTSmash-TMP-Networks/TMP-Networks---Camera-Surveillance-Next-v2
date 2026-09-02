/** Dependency-free bounded per-camera serial task queue. */
export class CameraTaskTimeoutError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CameraTaskTimeoutError';
    this.code = 'CAMERA_TASK_TIMEOUT';
    this.details = details;
  }
}

export class CameraTaskCancelledError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CameraTaskCancelledError';
    this.code = 'CAMERA_TASK_CANCELLED';
    this.details = details;
  }
}

function timeoutSignal(timeoutMs, parentSignal = null) {
  const controller = new AbortController();
  let timer = null;
  let parentAbort = null;
  const abort = (reason) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  if (parentSignal) {
    parentAbort = () => abort(parentSignal.reason || new CameraTaskCancelledError('Task wurde abgebrochen'));
    if (parentSignal.aborted) parentAbort();
    else parentSignal.addEventListener('abort', parentAbort, { once: true });
  }
  if (Number(timeoutMs) > 0) {
    timer = setTimeout(() => abort(new CameraTaskTimeoutError('Kamera-Task hat das Zeitlimit ueberschritten', { timeoutMs })), timeoutMs);
    timer.unref?.();
  }
  return {
    signal: controller.signal,
    clear: () => {
      if (timer) clearTimeout(timer);
      if (parentSignal && parentAbort) parentSignal.removeEventListener('abort', parentAbort);
    },
  };
}

class SerialQueue {
  constructor(cameraId, { name = 'camera-queue', maxPending = 50 } = {}) {
    this.cameraId = cameraId;
    this.name = name;
    this.maxPending = Math.max(1, Number(maxPending) || 50);
    this.pending = [];
    this.running = null;
    this.sequence = 0;
    this.completed = 0;
    this.failed = 0;
    this.cancelled = 0;
    this.closed = false;
    this.lastActiveAt = Date.now();
  }

  cancelPendingByKey(coalesceKey, replacementType = 'task') {
    if (!coalesceKey) return 0;
    const keep = [];
    let cancelled = 0;
    for (const item of this.pending) {
      if (item.coalesceKey === coalesceKey) {
        cancelled += 1;
        this.cancelled += 1;
        item.reject(new CameraTaskCancelledError('Wartender Kamera-Task wurde durch einen neueren Befehl ersetzt', {
          cameraId: this.cameraId,
          queue: this.name,
          type: item.type,
          replacementType,
          coalesceKey,
        }));
      } else keep.push(item);
    }
    this.pending = keep;
    return cancelled;
  }

  enqueue(task, options = {}) {
    if (this.closed) return Promise.reject(new CameraTaskCancelledError('Kamera-Queue wurde beendet', { cameraId: this.cameraId, queue: this.name }));
    const coalesceKey = options.coalesceKey ? String(options.coalesceKey) : null;
    if (coalesceKey) this.cancelPendingByKey(coalesceKey, String(options.type || 'task'));
    if (this.pending.length >= this.maxPending) {
      return Promise.reject(new CameraTaskCancelledError('Zu viele wartende Kamera-Tasks; neue Aktion wurde verworfen', {
        cameraId: this.cameraId,
        queue: this.name,
        maxPending: this.maxPending,
      }));
    }
    const item = {
      task,
      priority: Number(options.priority || 0),
      timeoutMs: Number(options.timeoutMs || 0),
      type: String(options.type || 'task'),
      coalesceKey,
      enqueuedAt: Date.now(),
      sequence: this.sequence += 1,
      parentSignal: options.signal || null,
      resolve: null,
      reject: null,
    };
    this.lastActiveAt = Date.now();
    const promise = new Promise((resolve, reject) => {
      item.resolve = resolve;
      item.reject = reject;
    });
    this.pending.push(item);
    this.pending.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
    queueMicrotask(() => this.drain());
    return promise;
  }

  async drain() {
    if (this.closed || this.running || !this.pending.length) return;
    const item = this.pending.shift();
    this.running = item;
    this.lastActiveAt = Date.now();
    const taskSignal = timeoutSignal(item.timeoutMs, item.parentSignal);
    let abortListener = null;
    try {
      if (taskSignal.signal.aborted) throw taskSignal.signal.reason || new CameraTaskCancelledError('Task wurde abgebrochen');
      const context = {
        signal: taskSignal.signal,
        cameraId: this.cameraId,
        queue: this.name,
        type: item.type,
        queuedMs: Math.max(0, Date.now() - item.enqueuedAt),
      };
      const abortPromise = new Promise((_, reject) => {
        abortListener = () => reject(taskSignal.signal.reason || new CameraTaskCancelledError('Task wurde abgebrochen'));
        taskSignal.signal.addEventListener('abort', abortListener, { once: true });
      });
      const taskPromise = Promise.resolve().then(() => item.task(context));
      taskPromise.catch(() => {});
      const result = await Promise.race([taskPromise, abortPromise]);
      this.completed += 1;
      item.resolve(result);
    } catch (error) {
      this.failed += 1;
      item.reject(error);
    } finally {
      if (abortListener) taskSignal.signal.removeEventListener('abort', abortListener);
      taskSignal.clear();
      this.running = null;
      this.lastActiveAt = Date.now();
      if (this.pending.length && !this.closed) queueMicrotask(() => this.drain());
    }
  }

  isIdle() { return !this.running && this.pending.length === 0; }

  shutdown(reason = 'queue-shutdown') {
    if (this.closed) return;
    this.closed = true;
    for (const item of this.pending.splice(0)) {
      this.cancelled += 1;
      item.reject(new CameraTaskCancelledError('Kamera-Task wurde beim Herunterfahren abgebrochen', {
        cameraId: this.cameraId,
        queue: this.name,
        reason,
      }));
    }
  }

  stats() {
    return {
      cameraId: this.cameraId,
      queue: this.name,
      pending: this.pending.length,
      running: this.running ? {
        type: this.running.type,
        priority: this.running.priority,
        queuedMs: Math.max(0, Date.now() - this.running.enqueuedAt),
      } : null,
      completed: this.completed,
      failed: this.failed,
      cancelled: this.cancelled,
      lastActiveAt: new Date(this.lastActiveAt).toISOString(),
    };
  }
}

export class PerCameraTaskQueue {
  constructor({ name = 'camera-queue', maxPending = 50, idleTtlMs = 300_000 } = {}) {
    this.name = name;
    this.maxPending = maxPending;
    this.idleTtlMs = Math.max(60_000, Number(idleTtlMs) || 300_000);
    this.queues = new Map();
    this.closed = false;
    this.sweepTimer = setInterval(() => this.sweep(), Math.min(60_000, Math.round(this.idleTtlMs / 2)));
    this.sweepTimer.unref?.();
  }

  queueFor(cameraId) {
    if (this.closed) throw new CameraTaskCancelledError('Kamera-Queue wurde beendet', { queue: this.name });
    const id = String(cameraId || 'unknown');
    if (!this.queues.has(id)) this.queues.set(id, new SerialQueue(id, { name: this.name, maxPending: this.maxPending }));
    return this.queues.get(id);
  }

  enqueue(cameraId, task, options = {}) {
    try { return this.queueFor(cameraId).enqueue(task, options); }
    catch (error) { return Promise.reject(error); }
  }

  sweep(now = Date.now()) {
    for (const [cameraId, queue] of this.queues) {
      if (queue.isIdle() && now - queue.lastActiveAt >= this.idleTtlMs) {
        queue.shutdown('idle-expired');
        this.queues.delete(cameraId);
      }
    }
  }

  stats(cameraId = null) {
    if (cameraId) {
      const queue = this.queues.get(String(cameraId));
      return queue ? queue.stats() : { cameraId: String(cameraId), queue: this.name, pending: 0, running: null, completed: 0, failed: 0, cancelled: 0 };
    }
    return [...this.queues.values()].map((queue) => queue.stats());
  }

  shutdown() {
    if (this.closed) return;
    this.closed = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    for (const queue of this.queues.values()) queue.shutdown();
    this.queues.clear();
  }
}
