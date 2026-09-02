import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { config } from '../../config.js';

const SECRET_KEY = /(password|pass|authorization|credential|secret|token|uri|url|xaddr)/i;

function sanitize(value, depth = 0) {
  if (depth > 5) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.replace(/[\u0000-\u001F]/g, '').slice(0, 4000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? '[REDACTED]' : sanitize(item, depth + 1),
    ]));
  }
  return String(value).slice(0, 1000);
}

export class DomainEventBus extends EventEmitter {
  constructor({ limit = config.domainEventQueueLimit } = {}) {
    super();
    this.limit = Math.max(100, Number(limit) || 2000);
    this.sequence = 0;
    this.events = [];
    this.closed = false;
  }

  publish(type, payload = {}, { minRole = 'viewer', source = 'backend' } = {}) {
    if (this.closed) return null;
    const event = Object.freeze({
      id: crypto.randomUUID(),
      sequence: ++this.sequence,
      type: String(type || 'system.event').slice(0, 160),
      source: String(source || 'backend').slice(0, 120),
      minRole: ['viewer', 'operator', 'admin'].includes(minRole) ? minRole : 'admin',
      createdAt: new Date().toISOString(),
      payload: sanitize(payload),
    });
    this.events.push(event);
    if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit);
    this.emit('event', event);
    return event;
  }

  recent({ after = 0, limit = 200 } = {}) {
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
    return this.events.filter((event) => event.sequence > Number(after || 0)).slice(-safeLimit);
  }

  status() {
    return { sequence: this.sequence, retained: this.events.length, limit: this.limit, subscribers: this.listenerCount('event') };
  }

  shutdown() {
    this.closed = true;
    this.events = [];
    this.removeAllListeners();
  }
}

export const domainEventBus = new DomainEventBus();
