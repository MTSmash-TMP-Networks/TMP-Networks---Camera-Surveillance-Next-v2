import { db } from '../db/database.js';
import { domainEventBus } from './events/DomainEventBus.js';

const SECRET_KEY = /(password|pass|authorization|credential|secret|token|uri|url|xaddr)/i;
const URL_PATTERN = /\b(?:rtsp|rtsps|https?|rtmp|srt):\/\/[^\s"']+/gi;
const AUTH_PATTERN = /(Authorization:|password=|pass=|token=)[^\s&]+/gi;
const MAX_DETAILS_LENGTH = 12000;

function cleanText(value, maxLength = 4000) {
  return String(value ?? '')
    .replace(URL_PATTERN, '[Medienadresse]')
    .replace(AUTH_PATTERN, '$1[REDACTED]')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .slice(0, maxLength);
}

function sanitizeValue(value, depth = 0) {
  if (depth > 5) return '[gekürzt]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return cleanText(value, 3000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 80).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? '[REDACTED]' : sanitizeValue(item, depth + 1),
    ]));
  }
  return cleanText(value);
}

function parseDetails(value) {
  try { return value ? JSON.parse(value) : null; } catch { return value || null; }
}

class CameraEventLog {
  constructor() {
    this.writeCount = 0;
  }

  append(cameraId, {
    level = 'info', component = 'system', code = null, message, details = null, sessionKey = null,
  }) {
    if (!cameraId || !message) return null;
    const createdAt = new Date().toISOString();
    const safeDetails = details === null ? null : sanitizeValue(details);
    const serialized = safeDetails === null ? null : JSON.stringify(safeDetails).slice(0, MAX_DETAILS_LENGTH);
    const result = db.prepare(`
      INSERT INTO camera_event_logs(camera_id,level,component,code,message,details_json,session_key,created_at)
      VALUES(?,?,?,?,?,?,?,?)
    `).run(
      cameraId,
      ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info',
      cleanText(component, 80),
      code ? cleanText(code, 100) : null,
      cleanText(message, 1000),
      serialized,
      sessionKey ? cleanText(sessionKey, 300) : null,
      createdAt,
    );
    const id = Number(result.lastInsertRowid);
    this.writeCount += 1;
    if (this.writeCount % 50 === 0) this.prune(cameraId);
    domainEventBus.publish('camera.log', {
      id, cameraId: String(cameraId), level, component: cleanText(component, 80),
      code: code ? cleanText(code, 100) : null, message: cleanText(message, 1000),
      details: safeDetails, sessionKey: sessionKey ? cleanText(sessionKey, 300) : null, createdAt,
    }, { minRole: 'viewer', source: 'camera-event-log' });
    return id;
  }

  list(cameraId, { limit = 200, after = 0, level = null } = {}) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
    const params = { cameraId, after: Math.max(0, Number(after) || 0), limit: safeLimit };
    let sql = `SELECT id,camera_id,level,component,code,message,details_json,session_key,created_at
      FROM camera_event_logs WHERE camera_id=@cameraId AND id>@after`;
    if (level && ['debug', 'info', 'warn', 'error'].includes(level)) {
      sql += ' AND level=@level';
      params.level = level;
    }
    const incremental = params.after > 0;
    sql += incremental ? ' ORDER BY id ASC LIMIT @limit' : ' ORDER BY id DESC LIMIT @limit';
    const rows = db.prepare(sql).all(params);
    if (!incremental) rows.reverse();
    return rows.map((row) => ({
      id: row.id,
      cameraId: row.camera_id,
      level: row.level,
      component: row.component,
      code: row.code,
      message: row.message,
      details: parseDetails(row.details_json),
      sessionKey: row.session_key,
      createdAt: row.created_at,
    }));
  }

  clear(cameraId) {
    return db.prepare('DELETE FROM camera_event_logs WHERE camera_id=?').run(cameraId).changes;
  }

  prune(cameraId, keep = 1000) {
    db.prepare(`DELETE FROM camera_event_logs WHERE camera_id=? AND id NOT IN (
      SELECT id FROM camera_event_logs WHERE camera_id=? ORDER BY id DESC LIMIT ?
    )`).run(cameraId, cameraId, keep);
    db.prepare("DELETE FROM camera_event_logs WHERE julianday(created_at) < julianday('now','-30 days')").run();
  }
}

export const cameraEventLog = new CameraEventLog();
export { cleanText as sanitizeLogText, sanitizeValue as sanitizeLogDetails };
