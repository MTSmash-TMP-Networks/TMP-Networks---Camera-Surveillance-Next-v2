import { db } from '../db/database.js';
import { config } from '../config.js';
import { sanitizeLogDetails, sanitizeLogText } from './CameraEventLog.js';
import { domainEventBus } from './events/DomainEventBus.js';

function parse(value) {
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}

class AuditLogService {
  constructor() { this.writeCount = 0; }

  append({
    actorUserId = null, actorUsername = null, action, resourceType = 'system', resourceId = null,
    outcome = 'success', requestId = null, ipAddress = null, details = null,
  }) {
    if (!action) return null;
    const createdAt = new Date().toISOString();
    const safeDetails = details === null ? null : sanitizeLogDetails(details);
    const result = db.prepare(`
      INSERT INTO audit_logs(actor_user_id,actor_username,action,resource_type,resource_id,outcome,request_id,ip_address,details_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(
      actorUserId ? sanitizeLogText(actorUserId, 160) : null,
      actorUsername ? sanitizeLogText(actorUsername, 100) : null,
      sanitizeLogText(action, 180),
      sanitizeLogText(resourceType, 100),
      resourceId ? sanitizeLogText(resourceId, 200) : null,
      ['success', 'denied', 'failed'].includes(outcome) ? outcome : 'failed',
      requestId ? sanitizeLogText(requestId, 200) : null,
      ipAddress ? sanitizeLogText(ipAddress, 100) : null,
      safeDetails === null ? null : JSON.stringify(safeDetails).slice(0, 16000),
      createdAt,
    );
    const row = {
      id: Number(result.lastInsertRowid), actorUserId, actorUsername, action, resourceType, resourceId,
      outcome, requestId, ipAddress: ipAddress || null, details: safeDetails, createdAt,
    };
    this.writeCount += 1;
    if (this.writeCount % 100 === 0) this.prune();
    domainEventBus.publish('audit.log', row, { minRole: 'admin', source: 'audit' });
    return row;
  }

  list({ limit = 200, after = 0, outcome = null, action = null } = {}) {
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
    const params = { after: Math.max(0, Number(after) || 0), limit: safeLimit };
    let sql = `SELECT * FROM audit_logs WHERE id>@after`;
    if (outcome && ['success', 'denied', 'failed'].includes(outcome)) { sql += ' AND outcome=@outcome'; params.outcome = outcome; }
    if (action) { sql += ' AND action LIKE @action'; params.action = `%${String(action).slice(0, 100)}%`; }
    const incremental = params.after > 0;
    sql += incremental ? ' ORDER BY id ASC LIMIT @limit' : ' ORDER BY id DESC LIMIT @limit';
    const rows = db.prepare(sql).all(params);
    if (!incremental) rows.reverse();
    return rows.map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      actorUsername: row.actor_username,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      outcome: row.outcome,
      requestId: row.request_id,
      ipAddress: row.ip_address,
      details: parse(row.details_json),
      createdAt: row.created_at,
    }));
  }

  prune() {
    db.prepare(`DELETE FROM audit_logs WHERE julianday(created_at) < julianday('now', ?)`).run(`-${config.auditLogRetentionDays} days`);
  }
}

export const auditLogService = new AuditLogService();
