import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { sanitizeLogText } from './CameraEventLog.js';
import { emailNotificationService } from './notifications/EmailNotificationService.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };
const SENSITIVE_KEY = /(password|passwd|token|secret|authorization|cookie|credential|url|uri|path)/i;

function safeObject(value, depth = 0) {
  if (depth > 3 || value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return sanitizeLogText(value, 600);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeObject(item, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? '[REDACTED]' : safeObject(item, depth + 1)]));
}

class AdminAlertService {
  constructor() {
    this.lastSent = new Map();
  }

  enabled(level = 'error') {
    return Boolean(config.alertWebhookUrl) && (LEVELS[level] || 0) >= (LEVELS[config.alertMinLevel] || LEVELS.error);
  }

  async notify({ level = 'error', code = 'SYSTEM_ALERT', message, cameraId = null, details = null } = {}) {
    const emailPromise = emailNotificationService.notifySystemAlert({ level, code, message, cameraId, details }).catch(() => ({ sent: false, reason: 'delivery_failed' }));
    let webhook = { sent: false, reason: 'disabled' };
    if (this.enabled(level)) {
      const key = `${cameraId || 'system'}:${code}`;
      const now = Date.now();
      if (now - (this.lastSent.get(key) || 0) < config.alertCooldownMs) webhook = { sent: false, reason: 'cooldown' };
      else {
        this.lastSent.set(key, now);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetch(config.alertWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': `TMP-Camera-Surveillance/${config.appVersion}` },
            body: JSON.stringify({ service: 'tmp-camera-backend', version: config.appVersion, level, code, message: sanitizeLogText(message || code, 600), cameraId, time: new Date().toISOString(), details: safeObject(details) }),
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          logger.info({ code, cameraId }, 'Admin-Alarm wurde an den konfigurierten Webhook gesendet');
          webhook = { sent: true };
        } catch (error) {
          logger.warn({ code, cameraId, error: sanitizeLogText(error.message, 300) }, 'Admin-Alarm konnte nicht an den Webhook zugestellt werden');
          webhook = { sent: false, reason: 'delivery_failed' };
        } finally { clearTimeout(timer); }
      }
    }
    const email = await emailPromise;
    return { sent: Boolean(webhook.sent || email.sent), webhook, email };
  }
}

export const adminAlertService = new AdminAlertService();
