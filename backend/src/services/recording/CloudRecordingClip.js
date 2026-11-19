import { spawn } from 'node:child_process';

export const CLOUD_CLIP_SECONDS = 4;
export const CLOUD_CLIP_MAX_BYTES = 3_500_000;
const MAX_CONCURRENT_CLIPS = 2;
let activeRenders = 0;

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
  if (activeRenders >= MAX_CONCURRENT_CLIPS) {
    throw Object.assign(new Error('CLOUD_CLIP_BUSY'), { status: 503 });
  }
  const segmentDuration = Math.min(CLOUD_CLIP_SECONDS, duration - offset);
  activeRenders++;
  try {
    return await new Promise((resolve, reject) => {
      const args = [
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-ss', offset.toFixed(3), '-i', filePath,
        '-t', segmentDuration.toFixed(3),
        '-map', '0:v:0', '-map', '0:a?',
        '-vf', 'scale=-2:540', '-r', '15',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
        '-pix_fmt', 'yuv420p', '-b:v', '850k', '-maxrate', '1100k', '-bufsize', '2200k',
        '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
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
  } finally {
    activeRenders--;
  }
}
