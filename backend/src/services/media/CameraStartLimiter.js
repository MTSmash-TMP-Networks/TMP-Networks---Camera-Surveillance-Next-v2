export class CameraStartLimiter {
  constructor(limit = 2) {
    this.limit = Math.max(1, Math.floor(Number(limit) || 2));
    this.active = 0;
    this.waiters = [];
  }

  async run(task) {
    await this.acquire();
    try { return await task(); }
    finally { this.release(); }
  }

  acquire() {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.active = Math.max(0, this.active - 1);
  }

  status() { return { active: this.active, queued: this.waiters.length, limit: this.limit }; }
}
