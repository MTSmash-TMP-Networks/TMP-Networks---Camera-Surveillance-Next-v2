import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { config } from '../../config.js';
import { cameraRepository } from '../cameraRepository.js';
import { streamOrchestrator } from './StreamOrchestrator.js';
import { logger } from '../../utils/logger.js';

const IMAGE_LIMIT = 1_000_000;
const FRAME_TIMEOUT_MS = 8_000;
const SEGMENT_MAX_AGE_MS = 30_000;
const RETRY_NOT_READY_MS = 15_000;
export const CAMERA_THUMBNAIL_REFRESH_MS = 60_000;

function fileName(cameraId) {
  // Camera IDs never become filesystem paths, even if an old database contains
  // unexpected characters. No camera credentials are written to this cache.
  return crypto.createHash('sha256').update(String(cameraId)).digest('hex') + '.jpg';
}

export function latestHlsSegment(directory, now = Date.now()) {
  if (!directory) return null;
  try {
    const playlist = fs.readFileSync(path.join(directory, 'index.m3u8'), 'utf8');
    const segments = [...playlist.matchAll(/^\s*(seg_[0-9]+\.ts)\s*$/gm)];
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const candidate = path.join(directory, segments[i][1]);
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile() && stat.size > 1880 && now - stat.mtimeMs <= SEGMENT_MAX_AGE_MS) return candidate;
      } catch { /* The latest segment may disappear during HLS rotation. */ }
    }
  } catch {
    // A stream can be starting or rotating segments. Never open a new camera
    // connection just because its existing local HLS ring is momentarily empty.
  }
  return null;
}

export function renderJpegFromSegment(segment, ffmpegPath = config.ffmpegPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-nostdin', '-loglevel', 'error',
      '-threads', '1', '-filter_threads', '1', '-i', segment,
      '-map', '0:v:0', '-frames:v', '1', '-an',
      '-vf', 'scale=640:-2:flags=fast_bilinear',
      '-q:v', '6', '-vcodec', 'mjpeg', '-f', 'image2pipe', 'pipe:1',
    ];
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0;
    let diagnostics = '';
    let settled = false;
    let timer;
    function finish(error, image) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(image);
    }
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Thumbnail-FFmpeg-Zeitlimit erreicht'));
    }, FRAME_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > IMAGE_LIMIT) {
        child.kill('SIGKILL');
        finish(new Error('Thumbnail ueberschreitet Groessenlimit'));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      diagnostics = (diagnostics + String(chunk)).slice(-300);
    });
    child.once('error', (error) => finish(error));
    child.once('close', (code) => {
      if (settled) return;
      const data = Buffer.concat(chunks);
      if (code !== 0 || data.length < 128 || data[0] !== 0xff || data[1] !== 0xd8 ||
          data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9) {
        finish(new Error('Kein gueltiges JPEG aus lokalem HLS-Segment: ' + (diagnostics || String(code))));
        return;
      }
      finish(null, data);
    });
  });
}

function centralHlsSource(cameraId) {
  const session = streamOrchestrator.findPermanentIngestSession(cameraId);
  if (!session || session.state !== 'ready' || !session.outputs?.hls ||
      !['local-hls-ring', 'snapshot-video'].includes(session.mode) ||
      !streamOrchestrator.localHlsReady(session)) return null;
  return latestHlsSegment(streamOrchestrator.localHlsDirectory(session));
}

// Deliberately independent of browser requests. One ffmpeg image extraction at
// a time across ALL cameras, reading ONLY already produced local HLS segments.
export class CameraThumbnailCache {
  constructor({
    directory = path.join(config.dataDir, 'thumbnails'),
    cameras = () => cameraRepository.listEnabled(),
    source = centralHlsSource,
    capture = renderJpegFromSegment,
    now = Date.now,
    refreshMs = CAMERA_THUMBNAIL_REFRESH_MS,
  } = {}) {
    this.directory = directory;
    this.cameras = cameras;
    this.source = source;
    this.capture = capture;
    this.now = now;
    this.refreshMs = refreshMs;
    this.due = new Map();
    this.inFlight = new Set();
    this.started = false;
    this.timer = null;
    this.scanning = false;
  }

  imagePath(cameraId) {
    return path.join(this.directory, fileName(cameraId));
  }

  async read(cameraId) {
    try {
      const filename = this.imagePath(cameraId);
      const [buffer, info] = await Promise.all([fsp.readFile(filename), fsp.stat(filename)]);
      return { buffer, updatedAt: info.mtime.toISOString() };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async discard(cameraId) {
    this.due.delete(String(cameraId));
    await fsp.rm(this.imagePath(cameraId), { force: true });
  }

  async refreshCamera(cameraId) {
    const camera = this.cameras().find((item) => String(item.id) === String(cameraId));
    if (!camera || camera.enabled === false) return false;
    const segment = this.source(cameraId);
    if (!segment) return false;
    const buffer = await this.capture(segment);
    if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.length > IMAGE_LIMIT ||
        buffer[0] !== 0xff || buffer[1] !== 0xd8 ||
        buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) {
      throw new Error('Ungueltiges oder zu grosses Thumbnail');
    }
    // Do not recreate the old camera preview after deletion while FFmpeg ran.
    if (!this.cameras().some((item) => String(item.id) === String(cameraId) && item.enabled !== false)) return false;
    await fsp.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const destination = this.imagePath(cameraId);
    const temporary = destination + '.' + crypto.randomUUID() + '.tmp';
    try {
      await fsp.writeFile(temporary, buffer, { mode: 0o600 });
      await fsp.rename(temporary, destination);
    } finally {
      await fsp.rm(temporary, { force: true });
    }
    return true;
  }

  async tick() {
    if (!this.started || this.scanning || this.inFlight.size) return;
    this.scanning = true;
    try {
      const cameras = this.cameras().filter((item) => item.enabled !== false);
      const now = this.now();
      const validIds = new Set(cameras.map((item) => String(item.id)));
      for (const id of this.due.keys()) {
        if (!validIds.has(id)) {
          this.due.delete(id);
          void fsp.rm(this.imagePath(id), { force: true }).catch(() => {});
        }
      }
      // Spread cold-start work over 60 seconds, rather than launching 26
      // decoders when the backend and recording scheduler are still starting.
      const spacing = this.refreshMs / Math.max(1, cameras.length);
      for (const [index, camera] of cameras.entries()) {
        const id = String(camera.id);
        if (!this.due.has(id)) {
          let firstDue = now + Math.floor(index * spacing);
          try {
            const stat = await fsp.stat(this.imagePath(id));
            firstDue = Math.max(firstDue, stat.mtimeMs + this.refreshMs);
          } catch { /* Cache is optional on the first start. */ }
          this.due.set(id, firstDue);
        }
      }
      const dueCamera = cameras.find((item) => Number(this.due.get(String(item.id))) <= now);
      if (!dueCamera) return;
      const id = String(dueCamera.id);
      this.inFlight.add(id);
      void this.refreshCamera(id)
        .then((updated) => {
          this.due.set(id, this.now() + (updated ? this.refreshMs : RETRY_NOT_READY_MS));
        })
        .catch((error) => {
          this.due.set(id, this.now() + this.refreshMs);
          logger.warn({ err: error, cameraId: id }, 'Kamera-Thumbnail konnte nicht aktualisiert werden; altes Bild bleibt erhalten');
        })
        .finally(() => { this.inFlight.delete(id); });
    } finally {
      this.scanning = false;
    }
  }

  async start() {
    if (this.started) return;
    await fsp.mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.started = true;
    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        logger.warn({ err: error }, 'Kamera-Thumbnail-Planer konnte nicht ausgefuehrt werden');
      });
    }, 1000);
    this.timer.unref?.();
    void this.tick().catch((error) => {
      logger.warn({ err: error }, 'Kamera-Thumbnail-Start fehlgeschlagen');
    });
  }

  stop() {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const cameraThumbnailCache = new CameraThumbnailCache();
