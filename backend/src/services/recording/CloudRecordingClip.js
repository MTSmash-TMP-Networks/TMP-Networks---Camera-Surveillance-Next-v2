import { spawn } from 'node:child_process';

export const CLOUD_CLIP_SECONDS = 4;
export const CLOUD_CLIP_MAX_BYTES = 3_500_000;
const MAX_CONCURRENT_CLIPS = 2;
const MAX_PENDING_CLIPS = 8;
const MAX_CACHED_BYTES = 24 * 1024 * 1024;
const CACHE_TTL_MS = 90_000;
const WAIT_TIMEOUT_MS = 9_000;
let activeRenders = 0;
let pendingRenders = 0;
let cachedBytes = 0;
const waiters = [];
const cache = new Map();
const inFlight = new Map();

function acquireSlot() {
  if (activeRenders < MAX_CONCURRENT_CLIPS) {
    activeRenders++;
    return Promise.resolve();
  }
  if (pendingRenders >= MAX_PENDING_CLIPS) {
    return Promise.reject(Object.assign(new Error('CLOUD_CLIP_BUSY'), { status: 503 }));
  }
  pendingRenders++;
  return new Promise((resolve, reject) => {
    const waiter = {
      resolve: () => { clearTimeout(waiter.timer); pendingRenders--; activeRenders++; resolve(); },
      reject: (reason) => { clearTimeout(waiter.timer); pendingRenders--; reject(reason); },
      timer: null,
    };
    waiter.timer = setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) { waiters.splice(index, 1); waiter.reject(Object.assign(new Error('CLOUD_CLIP_QUEUE_TIMEOUT'), { status: 503 })); }
    }, WAIT_TIMEOUT_MS);
    waiter.timer.unref?.();
    waiters.push(waiter);
  });
}
function releaseSlot() {
  activeRenders--;
  const next = waiters.shift();
  if (next) next.resolve();
}
function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.until <= Date.now()) {
    cachedBytes -= entry.bytes.length;
    cache.delete(key);
    return null;
  }
  cache.delete(key); cache.set(key, entry);
  return entry.bytes;
}
function saveCached(key, bytes) {
  for (const [cacheKey, entry] of cache) {
    if (entry.until <= Date.now() || cachedBytes + bytes.length > MAX_CACHED_BYTES) {
      cache.delete(cacheKey); cachedBytes -= entry.bytes.length;
    }
    if (cachedBytes + bytes.length <= MAX_CACHED_BYTES) break;
  }
  if (bytes.length > MAX_CACHED_BYTES || cachedBytes + bytes.length > MAX_CACHED_BYTES) return;
  cache.set(key, { bytes, until: Date.now() + CACHE_TTL_MS });
  cachedBytes += bytes.length;
}

/**
 * Produce one self-contained H.264/AAC MPEG-TS archive clip.
 * Never transfer a complete recording block through the MySQL-backed relay.
 * Recording originals remain untouched; only cloud playback is downscaled.
 */
export async function renderCloudRecordingClip({ filePath, part, durationSeconds, ffmpegPath = 'ffmpeg', timeoutMs = 12_000 }) {
  if (typeof filePath !== 'string' || !filePath || !Number.isInteger(part) || part < 0 || part > 1800) {
    throw Object.assign(new Error('INVALID_CLOUD_CLIP'), { status: 400 });
  }
  const duration = Number(durationSeconds);
  const offset = part * CLOUD_CLIP_SECONDS;
  if (!Number.isFinite(duration) || duration <= 0 || offset >= duration) {
    throw Object.assign(new Error('CLOUD_CLIP_OUT_OF_RANGE'), { status: 404 });
  }
  const segmentDuration = Math.min(CLOUD_CLIP_SECONDS, duration - offset);
  const key = JSON.stringify([filePath, part, duration, ffmpegPath]);
  const hit = getCached(key);
  if (hit) return hit;
  if (inFlight.has(key)) return inFlight.get(key);
  const task = (async () => {
    await acquireSlot();
    try {
      const result = await encodeClip();
      saveCached(key, result);
      return result;
    } finally { releaseSlot(); }
  })();
  inFlight.set(key, task);
  try { return await task; }
  finally { inFlight.delete(key); }

  async function encodeClip() {
    return await new Promise((resolve, reject) => {
      const args = [
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-ss', offset.toFixed(3), '-i', filePath,
        '-t', segmentDuration.toFixed(3),
        '-map', '0:v:0', '-map', '0:a?',
        '-vf', 'scale=-2:360', '-r', '12',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
        '-pix_fmt', 'yuv420p', '-b:v', '580k', '-maxrate', '750k', '-bufsize', '1500k',
        '-g', '24', '-keyint_min', '24', '-sc_threshold', '0',
        '-c:a', 'aac', '-b:a', '64k', '-ar', '32000', '-ac', '2',
        '-mpegts_flags', '+resend_headers',
        '-avoid_negative_ts', 'make_zero', '-f', 'mpegts', 'pipe:1',
      ];
      const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks = [];
      let bytes = 0;
      let settled = false;
      const finish = (error, buffer) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(buffer);
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(Object.assign(new Error('CLOUD_CLIP_TIMEOUT'), { status: 504 }));
      }, timeoutMs);
      timer.unref?.();
      child.stdout.on('data', (chunk) => {
        bytes += chunk.byteLength;
        if (bytes > CLOUD_CLIP_MAX_BYTES) {
          child.kill('SIGKILL');
          finish(Object.assign(new Error('CLOUD_CLIP_TOO_LARGE'), { status: 413 }));
        } else chunks.push(chunk);
      });
      child.stderr.on('data', () => {});
      child.on('error', () => finish(Object.assign(new Error('CLOUD_CLIP_ENCODER_UNAVAILABLE'), { status: 503 })));
      child.on('close', (code) => {
        if (settled) return;
        if (code !== 0 || bytes < 188) {
          finish(Object.assign(new Error('CLOUD_CLIP_NOT_PLAYABLE'), { status: 422 }));
          return;
        }
        finish(null, Buffer.concat(chunks, bytes));
      });
    });
  }
}
