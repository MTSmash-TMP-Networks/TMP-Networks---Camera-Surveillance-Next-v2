import crypto from 'node:crypto';
import { config } from '../../config.js';
import { OnvifClient } from '../onvif/OnvifClient.js';

function fingerprint(camera) {
  const serialized = [
    camera?.id,
    camera?.onvif?.ip,
    camera?.onvif?.port,
    camera?.username,
    camera?.password,
  ].map((value) => String(value ?? '')).join('|');
  // Do not retain a second plaintext copy of camera credentials merely to
  // detect configuration changes. The client itself already owns the camera
  // object for the lifetime of the pooled connection.
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

/** Reuses authenticated ONVIF sessions for low-latency PTZ commands. */
export class PtzClientPool {
  constructor({ idleMs = config.ptzClientIdleMs, disableSweep = false } = {}) {
    this.idleMs = Math.max(10_000, Number(idleMs) || 300_000);
    this.clients = new Map();
    this.timer = disableSweep ? null : setInterval(() => this.sweep(), Math.min(60_000, Math.max(10_000, Math.round(this.idleMs / 3))));
    this.timer?.unref?.();
  }

  get(camera, channel = 'move') {
    const cameraId = String(camera?.id || '');
    const safeChannel = ['move', 'stop', 'discrete'].includes(String(channel)) ? String(channel) : 'move';
    const key = `${cameraId}:${safeChannel}`;
    const currentFingerprint = fingerprint(camera);
    const existing = this.clients.get(key);
    if (existing?.fingerprint === currentFingerprint) {
      existing.lastUsedAt = Date.now();
      return existing.client;
    }
    const client = new OnvifClient(camera, { timeoutMs: config.ptzCommandTimeoutMs });
    this.clients.set(key, { cameraId, channel: safeChannel, client, fingerprint: currentFingerprint, lastUsedAt: Date.now() });
    return client;
  }

  invalidate(cameraId, channel = null) {
    const id = String(cameraId);
    for (const [key, entry] of this.clients) {
      if (entry.cameraId !== id) continue;
      if (channel && entry.channel !== String(channel)) continue;
      this.clients.delete(key);
    }
  }

  sweep(now = Date.now()) {
    for (const [key, entry] of this.clients) {
      if (now - entry.lastUsedAt >= this.idleMs) this.clients.delete(key);
    }
  }

  status() {
    return [...this.clients.values()].map((entry) => ({ cameraId: entry.cameraId, channel: entry.channel, lastUsedAt: new Date(entry.lastUsedAt).toISOString() }));
  }

  shutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.clients.clear();
  }
}

export const ptzClientPool = new PtzClientPool();
