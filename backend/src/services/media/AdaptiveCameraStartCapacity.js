import fs from 'node:fs';
import os from 'node:os';

function readCgroupNumber(filename) {
  try {
    const content = fs.readFileSync(filename, 'utf8').trim();
    const number = Number(content);
    return Number.isFinite(number) && number >= 0 ? number : null;
  } catch { return null; }
}

// Do not mistake idle HOST RAM for free CONTAINER RAM. Docker installations
// from older versions may still cap the backend to 1.5 GiB.
export function availableMemoryBytes({ freeHostBytes, cgroupMax, cgroupUsed }) {
  let free = Number.isFinite(freeHostBytes) ? Math.max(0, freeHostBytes) : null;
  if (Number.isFinite(cgroupMax) && cgroupMax > 0 && cgroupMax < 2 ** 60 && Number.isFinite(cgroupUsed)) {
    const containerFree = Math.max(0, cgroupMax - cgroupUsed);
    free = free === null ? containerFree : Math.min(free, containerFree);
  }
  return free;
}

export function chooseCameraStartLimit({
  baseline = 4, max = 8, current = baseline, cores = 4, loadRatio = null,
  availableMemory = null, waiting = 0,
} = {}) {
  const minimum = Math.max(1, Math.min(max, Math.floor(baseline)));
  const maximum = Math.max(minimum, Math.floor(max));
  const effectiveCores = Math.max(1, Math.floor(cores));
  const resourceCap = Math.min(maximum, Math.max(minimum, effectiveCores + 2));
  const old = Math.max(minimum, Math.min(resourceCap, Math.floor(current)));
  // Missing metrics do NOT mean an idle server; be conservative.
  if (!Number.isFinite(loadRatio) || !Number.isFinite(availableMemory)) return minimum;
  if (loadRatio > 0.9 || availableMemory < 256 * 1024 ** 2) return minimum;
  if (loadRatio > 0.75 || availableMemory < 384 * 1024 ** 2) return Math.max(minimum, old - 1);
  if (waiting > 0 && loadRatio < 0.55 && availableMemory >= 512 * 1024 ** 2) {
    return Math.min(resourceCap, old + 1);
  }
  return old;
}

export class AdaptiveCameraStartCapacity {
  constructor({ limiter, baseline = 4, max = 8, loadAverage = () => os.loadavg()[0],
    cores = () => os.availableParallelism?.() || os.cpus().length,
    freeHostBytes = () => os.freemem(),
    cgroupMax = () => readCgroupNumber('/sys/fs/cgroup/memory.max'),
    cgroupUsed = () => readCgroupNumber('/sys/fs/cgroup/memory.current'),
    logger = null,
  }) {
    this.limiter = limiter;
    this.baseline = baseline;
    this.max = max;
    this.loadAverage = loadAverage;
    this.cores = cores;
    this.freeHostBytes = freeHostBytes;
    this.cgroupMax = cgroupMax;
    this.cgroupUsed = cgroupUsed;
    this.logger = logger;
    this.timer = null;
  }

  sample() {
    const cores = this.cores();
    const loadRatio = this.loadAverage() / Math.max(1, cores);
    const memory = availableMemoryBytes({
      freeHostBytes: this.freeHostBytes(),
      cgroupMax: this.cgroupMax(),
      cgroupUsed: this.cgroupUsed(),
    });
    const previous = this.limiter.limit;
    const next = chooseCameraStartLimit({
      baseline: this.baseline, max: this.max, current: previous, cores,
      loadRatio, availableMemory: memory, waiting: this.limiter.waiters.length,
    });
    if (next !== previous) {
      this.limiter.setLimit(next);
      this.logger?.info({ previous, next, baseline: this.baseline, max: this.max,
        cores, loadRatio: Number.isFinite(loadRatio) ? Math.round(loadRatio * 100) / 100 : null,
        availableMemoryMiB: Number.isFinite(memory) ? Math.floor(memory / 2 ** 20) : null },
      'CAMERA_START_CAPACITY_ADJUSTED');
    }
    return next;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try { this.sample(); }
      catch (error) { this.logger?.warn({ err: error }, 'Kamera-Ressourcenpruefung fehlgeschlagen'); }
    }, 5000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
