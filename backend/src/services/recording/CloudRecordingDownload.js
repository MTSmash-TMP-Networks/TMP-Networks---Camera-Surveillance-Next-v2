import { spawn } from 'node:child_process';
import { CLOUD_CLIP_MAX_BYTES } from './CloudRecordingClip.js';

export const CLOUD_MP4_SECONDS = 15;
const MAX_ACTIVE = 2;
const MAX_PENDING = 6;
let active = 0;
const waiting = [];

async function acquire() {
  if (active < MAX_ACTIVE) { active++; return; }
  if (waiting.length >= MAX_PENDING) throw Object.assign(new Error('CLOUD_MP4_BUSY'), { status: 503 });
  await new Promise((resolve, reject) => {
    const entry = { resolve, reject };
    entry.timer = setTimeout(() => {
      const idx = waiting.indexOf(entry);
      if (idx >= 0) { waiting.splice(idx, 1); reject(Object.assign(new Error('CLOUD_MP4_QUEUE_TIMEOUT'), { status: 503 })); }
    }, 5000);
    entry.timer.unref?.();
    waiting.push(entry);
  });
  active++;
}
function release() {
  active = Math.max(0, active - 1);
  const next = waiting.shift();
  if (next) { clearTimeout(next.timer); next.resolve(); }
}

export async function renderCloudMp4Download({ filePath, offsetSeconds, durationSeconds, ffmpegPath = 'ffmpeg', timeoutMs = 18_000 }) {
  if (typeof filePath !== 'string' || !filePath || !Number.isFinite(offsetSeconds) || offsetSeconds < 0 ||
      !Number.isFinite(durationSeconds) || durationSeconds <= 0 || offsetSeconds >= durationSeconds) {
    throw Object.assign(new Error('CLOUD_MP4_INVALID_RANGE'), { status: 400 });
  }
  await acquire();
  try {
    return await new Promise((resolve, reject) => {
      const duration = Math.min(CLOUD_MP4_SECONDS, durationSeconds - offsetSeconds);
      const args = [
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-ss', offsetSeconds.toFixed(3), '-i', filePath, '-t', duration.toFixed(3),
        '-map', '0:v:0', '-map', '0:a?',
        '-vf', 'scale=-2:360', '-r', '12', '-c:v', 'libx264',
        '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-b:v', '480k', '-maxrate', '600k', '-bufsize', '1200k',
        '-c:a', 'aac', '-b:a', '48k', '-ar', '32000',
        '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
        '-f', 'mp4', 'pipe:1',
      ];
      const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let total = 0, settled = false;
      const chunks = [];
      const done = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        done(Object.assign(new Error('CLOUD_MP4_TIMEOUT'), { status: 504 }));
      }, timeoutMs);
      timer.unref?.();
      child.stdout.on('data', (chunk) => {
        total += chunk.length;
        if (total > CLOUD_CLIP_MAX_BYTES) {
          child.kill('SIGKILL');
          done(Object.assign(new Error('CLOUD_MP4_TOO_LARGE'), { status: 413 }));
        } else chunks.push(chunk);
      });
      child.stderr.resume();
      child.on('error', () => done(Object.assign(new Error('CLOUD_MP4_ENCODER_UNAVAILABLE'), { status: 503 })));
      child.on('close', (code) => {
        if (settled) return;
        if (code !== 0 || total < 128) {
          done(Object.assign(new Error('CLOUD_MP4_NOT_PLAYABLE'), { status: 422 }));
          return;
        }
        const result = Buffer.concat(chunks, total);
        // MP4 file signature: size (4 bytes), followed by ftyp (4 bytes).
        if (result.toString('ascii', 4, 8) !== 'ftyp') {
          done(Object.assign(new Error('CLOUD_MP4_INVALID_HEADER'), { status: 422 }));
          return;
        }
        done(null, result);
      });
    });
  } finally { release(); }
}
