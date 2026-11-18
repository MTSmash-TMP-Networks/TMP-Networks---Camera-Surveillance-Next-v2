// Limit expensive camera connection startup and prevent cold-recovery jobs
// from starving foreground recordings. FIFO within each effective priority;
// older jobs age into priority to keep recovery fair, even during a busy day.
export class CameraStartLimiter {
  constructor(limit = 2) {
    this.limit = Math.max(1, Math.floor(Number(limit) || 2));
    this.active = 0;
    this.waiters = [];
    this.sequence = 0;
  }

  async run(task, { priority = 0 } = {}) {
    await this.acquire({ priority });
    try { return await task(); }
    finally { this.release(); }
  }

  acquire({ priority = 0 } = {}) {
    const safePriority = Math.max(0, Math.min(3, Math.floor(Number(priority) || 0)));
    if (this.active < this.limit && this.waiters.length === 0) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push({ resolve, priority: safePriority, queuedAt: Date.now(), order: this.sequence++ });
    });
  }

  release() {
    if (!this.waiters.length) {
      this.active = Math.max(0, this.active - 1);
      return;
    }
    const now = Date.now();
    // Every 15s of waiting adds one effective priority level. A long-waiting
    // camera will eventually beat newer, urgent jobs: no permanent starvation.
    const score = (waiter) => Math.min(10, waiter.priority + Math.floor(Math.max(0, now - waiter.queuedAt) / 15000));
    let best = 0;
    for (let i = 1; i < this.waiters.length; i += 1) {
      if (score(this.waiters[i]) > score(this.waiters[best])) best = i;
    }
    const [next] = this.waiters.splice(best, 1);
    next.resolve();
    // Active stays unchanged: this slot is handed straight to the next job.
  }

  status() {
    const now = Date.now();
    return {
      active: this.active,
      queued: this.waiters.length,
      limit: this.limit,
      oldestQueuedMs: this.waiters.length ? Math.max(0, now - this.waiters[0].queuedAt) : 0,
    };
  }
}
