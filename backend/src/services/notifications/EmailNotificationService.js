import { db } from '../../db/database.js';
import { logger } from '../../utils/logger.js';
import { cameraRepository } from '../cameraRepository.js';
import { domainEventBus } from '../events/DomainEventBus.js';
import { notificationSettingsService } from './NotificationSettingsService.js';
import { renderNotificationMail, mailText } from './NotificationTemplates.js';
import { sendSmtpMail } from './SmtpClient.js';
import { aiEventAnalysisService } from '../ai/AiEventAnalysisService.js';
import { aiEventAnalysisSettingsService } from '../ai/AiEventAnalysisSettingsService.js';

const STREAM_FAILURE = new Set(['STREAM_START_FAILED','STREAM_STALLED','AUTO_RESTART_FAILED','PERMANENT_INGEST_START_FAILED','STREAM_RETAIN_REUSE_FAILED','PTZ_LIVE_RESYNC_FAILED_RESTART']);
const STREAM_RECOVERY = new Set(['STREAM_READY','GO2RTC_BROKER_RESTORED']);
const RECORDING_FAILURE = new Set(['RECORDING_BLOCK_DAMAGED','RECORDING_FINALIZE_FAILED','RECORDING_NO_PLAYABLE_BLOCKS','RECORDING_RECOVERY_LIMIT','RECORDING_SOURCE_START_FAILED','RECORDING_STALLED','RECORDING_RECOVERY_FAILED','RECORDING_SCHEDULER_ERROR']);
const RECORDING_RECOVERY = new Set(['RECORDING_RESUMED','RECORDING_RECOVERED_AFTER_RESTART']);
const MOTION = new Set(['MOTION_DETECTED','MOTION_RETRIGGERED']);
const CAMERA_EVENT_ALERTS = new Set([...STREAM_FAILURE, ...RECORDING_FAILURE, ...MOTION, 'CAMERA_OFFLINE', 'CAMERA_ONLINE']);

function safeDetails(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 1200);
  try {
    const copy = JSON.parse(JSON.stringify(value));
    const redact = (node, depth=0) => {
      if (depth > 3 || node === null || node === undefined) return node;
      if (Array.isArray(node)) return node.slice(0, 10).map((item)=>redact(item,depth+1));
      if (typeof node === 'object') return Object.fromEntries(Object.entries(node).slice(0, 20).map(([key,item]) => [key, /pass|secret|token|auth|url|uri|path/i.test(key) ? '[REDACTED]' : redact(item, depth + 1)]));
      return typeof node === 'string' ? node.slice(0, 300) : node;
    };
    return JSON.stringify(redact(copy)).slice(0, 1200);
  } catch { return ''; }
}

class EmailNotificationService {
  constructor() { this.started = false; this.cooldowns = new Map(); this.failedStreams = new Set(); this.failedRecordings = new Set(); this.queue = Promise.resolve(); this.pendingEvents = 0; this.maxPendingEvents = 100; this.deliveryWrites = 0; this.onEvent = (event) => { if (this.pendingEvents >= this.maxPendingEvents) { logger.warn({ type: event?.type }, 'E-Mail-Benachrichtigungswarteschlange ist voll; Ereignis wird verworfen'); return; } this.pendingEvents += 1; this.queue = this.queue.then(()=>this.handleEvent(event)).catch((error)=>logger.warn({ err:error }, 'E-Mail-Benachrichtigungsereignis fehlgeschlagen')).finally(()=>{ this.pendingEvents = Math.max(0, this.pendingEvents - 1); }); }; }
  start() { if (this.started) return; this.started = true; domainEventBus.on('event', this.onEvent); }
  shutdown() { if (!this.started) return; domainEventBus.off('event', this.onEvent); this.started = false; }
  status() { const settings=notificationSettingsService.get(); const last=db.prepare('SELECT status,error,created_at,sent_at FROM notification_deliveries ORDER BY id DESC LIMIT 1').get() || null; return { enabled:settings.enabled, configured:Boolean(settings.host&&settings.fromAddress&&settings.recipients.length&&(!settings.username||settings.passwordConfigured)), recipients:settings.recipients.length, queued:this.pendingEvents, lastDelivery:last }; }
  deliveries(limit=50) { return db.prepare(`SELECT d.id,d.status,d.event_kind AS eventKind,d.event_code AS eventCode,d.camera_id AS cameraId,c.name AS cameraName,c.location AS cameraLocation,d.recipient_count AS recipientCount,d.subject,d.error,d.created_at AS createdAt,d.sent_at AS sentAt FROM notification_deliveries d LEFT JOIN cameras c ON c.id=d.camera_id ORDER BY d.id DESC LIMIT ?`).all(Math.max(1,Math.min(200,Number(limit)||50))); }
  pruneDeliveries() {
    db.prepare("DELETE FROM notification_deliveries WHERE julianday(created_at) < julianday('now','-90 days')").run();
    db.prepare(`DELETE FROM notification_deliveries WHERE id NOT IN (SELECT id FROM notification_deliveries ORDER BY id DESC LIMIT 5000)`).run();
  }
  shouldCooldown(key, seconds) { const now=Date.now(); const last=this.cooldowns.get(key)||0; if (now-last < Math.max(0,Number(seconds)||0)*1000) return true; this.cooldowns.set(key,now); return false; }
  async deliver({ kind, code, level='info', cameraId=null, createdAt=new Date().toISOString(), details='', analysis=null, force=false, recipientOverride=null }) {
    const settings=notificationSettingsService.transport();
    if (!force && !settings.enabled) return { sent:false, reason:'disabled' };
    const recipients = recipientOverride ? [recipientOverride] : settings.recipients;
    if (!settings.host || !settings.fromAddress || !recipients.length || (settings.username && !settings.password)) return { sent:false, reason:'not_configured' };
    if (!force && this.shouldCooldown(`${kind}:${cameraId||'system'}`, settings.cooldownSeconds)) return { sent:false, reason:'cooldown' };
    const camera = cameraId ? cameraRepository.get(cameraId) : null;
    const mail = kind === 'test'
      ? (()=>{const t=mailText(settings.language); return { subject:`[TMP Camera] ${t.test}`, text:`${t.testBody}\n\n${t.footer}`, html:`<div style="font-family:Arial,sans-serif"><h2>${t.test}</h2><p>${t.testBody}</p><p style="color:#667085;font-size:12px">${t.footer}</p></div>`};})()
      : renderNotificationMail({ language:settings.language, kind, camera, code, level, createdAt, details, analysis });
    const created = new Date().toISOString(); const result=db.prepare(`INSERT INTO notification_deliveries(channel,status,event_kind,event_code,camera_id,recipient_count,subject,error,created_at,sent_at) VALUES('email','pending',?,?,?,?,?,?,?,NULL)`).run(kind,code||null,cameraId||null,recipients.length,mail.subject,null,created); const id=Number(result.lastInsertRowid); this.deliveryWrites += 1; if (this.deliveryWrites % 25 === 0) this.pruneDeliveries();
    try {
      await sendSmtpMail({ host:settings.host,port:settings.port,security:settings.security,username:settings.username,password:settings.password,rejectUnauthorized:settings.rejectUnauthorized,fromAddress:settings.fromAddress,fromName:settings.fromName,recipients,subject:mail.subject,text:mail.text,html:mail.html });
      const sentAt=new Date().toISOString(); db.prepare(`UPDATE notification_deliveries SET status='sent',sent_at=?,error=NULL WHERE id=?`).run(sentAt,id); logger.info({ notificationId:id, kind, code, cameraId, recipients:recipients.length }, 'E-Mail-Benachrichtigung versendet'); return { sent:true,id,sentAt };
    } catch (error) { const message=String(error?.message||error).slice(0,800); db.prepare(`UPDATE notification_deliveries SET status='failed',error=? WHERE id=?`).run(message,id); logger.warn({ notificationId:id,kind,code,cameraId,error:message }, 'E-Mail-Benachrichtigung fehlgeschlagen'); return { sent:false,id,reason:'delivery_failed',error:message }; }
  }
  async test(recipient=null) { return this.deliver({ kind:'test',code:'EMAIL_TEST',level:'info',force:true,recipientOverride:recipient }); }
  async notifySystemAlert({ level='error', code='SYSTEM_ALERT', message='', cameraId=null, details=null }={}) { const settings=notificationSettingsService.get(); if (!settings.rules.systemErrors) return {sent:false,reason:'rule_disabled'}; if (cameraId && CAMERA_EVENT_ALERTS.has(String(code || ''))) return {sent:false,reason:'handled_by_camera_event'}; return this.deliver({kind:'systemError',code,level,cameraId,details: safeDetails(details)||String(message||'').slice(0,800)}); }
  async handleEvent(event) {
    if (!this.started) return;
    const settings=notificationSettingsService.get(); if (!settings.enabled) return;
    if (event?.type === 'audit.log') {
      if (!settings.rules.updateOperations) return;
      const payload = event.payload || {};
      const path = String(payload.details?.path || '');
      if (!path.startsWith('/api/system/update/')) return;
      const level = payload.outcome === 'failed' ? 'error' : payload.outcome === 'denied' ? 'warn' : 'info';
      await this.deliver({ kind: 'update', code: String(payload.action || 'UPDATE_OPERATION'), level, createdAt: payload.created_at || event.createdAt, details: `${payload.outcome || 'success'} · ${path}` });
      return;
    }
    if (event?.type !== 'camera.log') return;
    const payload=event.payload||{}; const code=String(payload.code||''); const cameraId=payload.cameraId||null; const level=payload.level||'info'; const details=safeDetails(payload.details);
    if (MOTION.has(code)) {
      if (settings.rules.motion) {
        const aiSettings = aiEventAnalysisSettingsService.get();
        const aiResult = await aiEventAnalysisService.analyzeMotionPayload(payload, { language: settings.language });
        if (aiResult.analyzed && aiSettings.onlyRelevantNotifications && aiResult.analysis?.notificationRecommended === false) {
          logger.info({ cameraId, code, eventId: payload.details?.eventId || null }, 'Bewegungs-E-Mail durch KI-Relevanzfilter unterdrueckt');
          return;
        }
        await this.deliver({ kind:'motion', code, level, cameraId, createdAt:payload.createdAt||event.createdAt, details, analysis: aiResult.analyzed && aiSettings.includeInEmail ? aiResult.analysis : null });
      }
      return;
    }
    if (code==='CAMERA_OFFLINE') { if (settings.rules.cameraStatus) await this.deliver({kind:'cameraOffline',code,level:'warn',cameraId,createdAt:payload.createdAt||event.createdAt,details}); return; }
    if (code==='CAMERA_ONLINE') { if (settings.rules.cameraStatus) await this.deliver({kind:'cameraOnline',code,level:'info',cameraId,createdAt:payload.createdAt||event.createdAt}); return; }
    if (STREAM_FAILURE.has(code)) { this.failedStreams.add(String(cameraId)); if (settings.rules.streamFailures) await this.deliver({kind:'streamFailure',code,level,cameraId,createdAt:payload.createdAt||event.createdAt,details}); return; }
    if (STREAM_RECOVERY.has(code) && this.failedStreams.delete(String(cameraId))) { if (settings.rules.streamFailures) await this.deliver({kind:'streamRecovered',code,level:'info',cameraId,createdAt:payload.createdAt||event.createdAt}); return; }
    if (RECORDING_FAILURE.has(code)) { this.failedRecordings.add(String(cameraId)); if (settings.rules.recordingFailures) await this.deliver({kind:'recordingFailure',code,level,cameraId,createdAt:payload.createdAt||event.createdAt,details}); return; }
    if (RECORDING_RECOVERY.has(code) && this.failedRecordings.delete(String(cameraId))) { if (settings.rules.recordingFailures) await this.deliver({kind:'recordingRecovered',code,level:'info',cameraId,createdAt:payload.createdAt||event.createdAt}); }
  }
}
export const emailNotificationService = new EmailNotificationService();
