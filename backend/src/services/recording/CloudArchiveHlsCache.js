import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../../config.js';

export const ARCHIVE_HLS_WINDOW_SECONDS = 30;
const SEGMENT_MAX_BYTES = 3_400_000;
const CACHE_TTL_MS = 90 * 60_000;
const CACHE_MAX_BYTES = 384 * 1024 * 1024;
const MAX_ACTIVE = 2;
const MAX_PENDING = 8;
const segmentName = /^seg_[0-9]{4,5}\.ts$/;
const pending = new Map();
const queue = [];
let active = 0;
let lastClean = 0;

const error = (status, message) => Object.assign(new Error(message), { status });
const root = path.resolve(config.dataDir, 'cloud-archive-hls-cache');

export function selectArchiveWindow(recording, segments, index) {
  if (!recording || !Number.isInteger(index) || index < 0 || index > 4095) return null;
  const blocks = recording.archiveFormat === 'block_archive_v1'
    ? (Array.isArray(segments) ? segments : []).filter((b) => b.playable === true && Number(b.durationSeconds) > 0)
        .sort((a, b) => Number(a.segmentIndex) - Number(b.segmentIndex))
    : [{ segmentIndex: 'file', durationSeconds: Number(recording.durationSeconds),
        sizeBytes: Number(recording.fileSizeBytes || 0), finalizedAt: recording.endedAt || '' }];
  let remaining = index;
  let totalWindows = 0;
  for (const b of blocks) totalWindows += Math.ceil(Number(b.durationSeconds) / ARCHIVE_HLS_WINDOW_SECONDS);
  if (!totalWindows || totalWindows > 100_000) return null;
  let elapsed = 0;
  for (const b of blocks) {
    const duration = Number(b.durationSeconds);
    const count = Math.ceil(duration / ARCHIVE_HLS_WINDOW_SECONDS);
    if (remaining >= count) { remaining -= count; elapsed += duration; continue; }
    const offsetSeconds = remaining * ARCHIVE_HLS_WINDOW_SECONDS;
    const windowDurationSeconds = Math.min(ARCHIVE_HLS_WINDOW_SECONDS, duration - offsetSeconds);
    if (!(windowDurationSeconds > 0)) return null;
    return { recordingId: Number(recording.id), index, blockIndex: b.segmentIndex,
      offsetSeconds, durationSeconds: windowDurationSeconds, positionSeconds: elapsed + offsetSeconds,
      totalWindows,
      fingerprint: String(b.segmentIndex) + ':' + String(b.sizeBytes || 0) + ':' +
        String(b.finalizedAt || '') + ':' + String(recording.endedAt || '') };
  }
  return null;
}

function keyFor(spec) {
  return crypto.createHash('sha256').update(JSON.stringify([
    spec.recordingId, spec.index, spec.blockIndex, spec.offsetSeconds,
    spec.durationSeconds, spec.fingerprint,
  ])).digest('hex').slice(0, 40);
}
function directoryFor(spec) { return path.join(root, keyFor(spec)); }

async function inspect(directory) {
  const text = await fs.promises.readFile(path.join(directory, 'index.m3u8'), 'utf8');
  if (!text.startsWith('#EXTM3U') || !text.includes('#EXT-X-ENDLIST')) throw error(422, 'ARCHIVE_HLS_INVALID_PLAYLIST');
  const names = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  if (!names.length || names.length > 80 || names.some((name) => !segmentName.test(name)) ||
      new Set(names).size !== names.length) throw error(422, 'ARCHIVE_HLS_INVALID_SEGMENTS');
  const durations = [...text.matchAll(/^#EXTINF:([0-9.]+),/gm)].map((x) => Number(x[1]));
  if (durations.length !== names.length || durations.some((n) => !(n > 0) || n > 12)) {
    throw error(422, 'ARCHIVE_HLS_INVALID_DURATION');
  }
  let bytes = Buffer.byteLength(text);
  for (const name of names) {
    const stat = await fs.promises.stat(path.join(directory, name));
    if (!stat.isFile() || stat.size < 188 || stat.size > SEGMENT_MAX_BYTES) {
      throw error(413, 'ARCHIVE_HLS_SEGMENT_TOO_LARGE');
    }
    bytes += stat.size;
  }
  return { text, names, bytes, durationSeconds: durations.reduce((a, b) => a + b, 0) };
}

async function cached(spec) {
  const folder = directoryFor(spec);
  try {
    const meta = JSON.parse(await fs.promises.readFile(path.join(folder, 'manifest.json'), 'utf8'));
    if (meta.key !== keyFor(spec) || !Number.isInteger(meta.bytes) || meta.bytes > CACHE_MAX_BYTES) return null;
    const playlist = await inspect(folder);
    return { ...playlist, folder };
  } catch { return null; }
}

async function exec(program, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', settled = false;
    const finish = (reason) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (reason) reject(reason); else resolve(output);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL'); finish(error(504, 'ARCHIVE_HLS_ENCODER_TIMEOUT'));
    }, timeoutMs);
    timer.unref?.();
    child.stdout.on('data', (chunk) => { if (output.length < 4096) output += chunk.toString('utf8'); });
    child.stderr.resume();
    child.on('error', () => finish(error(503, 'ARCHIVE_HLS_ENCODER_MISSING')));
    child.on('close', (code) => finish(code === 0 ? null : error(422, 'ARCHIVE_HLS_ENCODING_FAILED')));
  });
}

async function cleanup() {
  if (Date.now() - lastClean < 60_000) return;
  lastClean = Date.now();
  let entries;
  try { entries = await fs.promises.readdir(root, { withFileTypes: true }); }
  catch { return; }
  const folders = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{40}$/.test(entry.name) || pending.has(entry.name)) continue;
    const dir = path.join(root, entry.name);
    try {
      const stat = await fs.promises.stat(dir);
      const meta = JSON.parse(await fs.promises.readFile(path.join(dir, 'manifest.json'), 'utf8'));
      folders.push({ dir, bytes: Number(meta.bytes || 0), mtime: stat.mtimeMs });
    } catch {}
  }
  folders.sort((a, b) => a.mtime - b.mtime);
  let total = folders.reduce((n, f) => n + f.bytes, 0);
  for (const f of folders) {
    if (Date.now() - f.mtime < CACHE_TTL_MS && total <= CACHE_MAX_BYTES) continue;
    await fs.promises.rm(f.dir, { force: true, recursive: true }).catch(() => {});
    total -= f.bytes;
  }
}

async function prepare(job) {
  const { spec, sourceProvider, key } = job;
  await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
  const source = await sourceProvider();
  const sourcePath = typeof source === 'string' ? source : source?.path;
  if (!sourcePath) throw error(404, 'ARCHIVE_HLS_SOURCE_MISSING');
  const staging = path.join(root, '.working-' + key + '-' + crypto.randomBytes(5).toString('hex'));
  try {
    let codec = '';
    try {
      const probe = await exec(config.ffprobePath, [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name',
        '-of', 'default=noprint_wrappers=1:nokey=1', sourcePath,
      ], 10_000);
      codec = probe.trim().split(/\s+/)[0] || '';
    } catch {}
    const modes = codec === 'h264' ? ['copy', 'transcode'] : ['transcode'];
    let inspected;
    for (const mode of modes) {
      await fs.promises.rm(staging, { force: true, recursive: true });
      await fs.promises.mkdir(staging, { mode: 0o700 });
      try {
        const args = ['-hide_banner', '-loglevel', 'error', '-nostdin',
          '-ss', spec.offsetSeconds.toFixed(3), '-i', sourcePath,
          '-t', spec.durationSeconds.toFixed(3), '-map', '0:v:0', '-map', '0:a?'];
        if (mode === 'copy') args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '48k');
        else args.push('-c:v', 'libx264', '-threads', '1', '-preset', 'veryfast',
          '-vf', 'scale=w=854:h=480:force_original_aspect_ratio=decrease:force_divisible_by=2',
          '-r', '15', '-pix_fmt', 'yuv420p', '-b:v', '700k', '-maxrate', '850k',
          '-bufsize', '1700k', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
          '-c:a', 'aac', '-b:a', '48k', '-ar', '32000');
        args.push('-avoid_negative_ts', 'make_zero', '-f', 'hls', '-hls_time', '2',
          '-hls_list_size', '0', '-hls_playlist_type', 'vod', '-hls_segment_type', 'mpegts',
          '-hls_flags', 'independent_segments',
          '-hls_segment_filename', path.join(staging, 'seg_%04d.ts'),
          path.join(staging, 'index.m3u8'));
        await exec(config.ffmpegPath, args, mode === 'copy' ? 35_000 : 100_000);
        inspected = await inspect(staging);
        if (mode === 'copy') {
          for (const name of inspected.names) {
            if ((await fs.promises.stat(path.join(staging, name))).size > 1_000_000) {
              throw error(413, 'ARCHIVE_HLS_COPY_BITRATE_TOO_HIGH');
            }
          }
        }
        break;
      } catch (err) {
        if (mode === modes[modes.length - 1]) throw err;
      }
    }
    if (!inspected) throw error(422, 'ARCHIVE_HLS_EMPTY');
    await fs.promises.writeFile(path.join(staging, 'manifest.json'), JSON.stringify({
      key, bytes: inspected.bytes, createdAt: Date.now(),
    }), { mode: 0o600 });
    await fs.promises.rm(directoryFor(spec), { recursive: true, force: true });
    await fs.promises.rename(staging, directoryFor(spec));
    await cleanup();
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift();
    active++; job.state = 'working';
    void prepare(job).then(() => pending.delete(job.key)).catch((err) => {
      job.state = 'failed';
      job.failedAt = Date.now();
      job.message = String(err?.message || 'ARCHIVE_HLS_FAILED').slice(0, 90);
    }).finally(() => { active--; pump(); });
  }
}

export const cloudArchiveHlsCache = {
  async status(spec, sourceProvider) {
    if (!spec || typeof sourceProvider !== 'function') throw error(400, 'ARCHIVE_HLS_INVALID_REQUEST');
    const existing = await cached(spec);
    if (existing) return { state: 'ready', ...this.describe(spec, existing) };
    const key = keyFor(spec);
    const job = pending.get(key);
    if (job) {
      if (job.state === 'failed') {
        if (Date.now() - job.failedAt < 20_000)
          return { state: 'failed', error: job.message, ...this.describe(spec) };
        pending.delete(key);
      } else return { state: 'preparing', ...this.describe(spec) };
    }
    if (queue.length >= MAX_PENDING) throw error(503, 'ARCHIVE_HLS_QUEUE_FULL');
    const next = { key, spec, sourceProvider, state: 'queued' };
    pending.set(key, next);
    queue.push(next);
    pump();
    return { state: 'preparing', ...this.describe(spec) };
  },
  describe(spec, content) {
    return { window: spec.index, totalWindows: spec.totalWindows,
      positionSeconds: spec.positionSeconds,
      durationSeconds: content?.durationSeconds || spec.durationSeconds,
      segmentCount: content?.names?.length || 0, retryAfterSeconds: 2 };
  },
  async playlist(spec) { return (await cached(spec))?.text || null; },
  async segment(spec, filename) {
    if (!segmentName.test(String(filename || ''))) throw error(400, 'ARCHIVE_HLS_INVALID_SEGMENT');
    const ready = await cached(spec);
    if (!ready || !ready.names.includes(filename)) return null;
    return path.join(ready.folder, filename);
  },
};
