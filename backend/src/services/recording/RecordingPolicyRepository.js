import crypto from 'node:crypto';
import { db } from '../../db/database.js';
import { config } from '../../config.js';
import { normalizeRecordingPlan } from './RecordingSchedule.js';

function parseJson(value, fallback = []) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function publicPlan(row) {
  if (!row) return null;
  return normalizeRecordingPlan({
    id: row.id,
    cameraId: row.camera_id,
    name: row.name,
    mode: row.mode,
    enabled: Boolean(row.enabled),
    timezone: row.timezone,
    weekdays: parseJson(row.weekdays_json),
    startTime: row.start_time,
    endTime: row.end_time,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    includeDates: parseJson(row.include_dates_json),
    excludeDates: parseJson(row.exclude_dates_json),
    holidayPolicy: row.holiday_policy,
    holidayDates: parseJson(row.holiday_dates_json),
    eventTypes: parseJson(row.event_types_json),
    prebufferSeconds: row.prebuffer_seconds,
    postbufferSeconds: row.postbuffer_seconds,
    priority: row.priority,
    quality: row.quality || 'balanced',
    profileToken: row.profile_token || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function defaultRetention(cameraId) {
  return {
    cameraId,
    strategy: 'hybrid',
    cleanupEnabled: true,
    maxAgeDays: config.retentionDefaultMaxAgeDays,
    eventMaxAgeDays: config.retentionDefaultMaxAgeDays,
    maxStorageBytes: 0,
    minFreeBytes: 2 * 1024 * 1024 * 1024,
    maxRecordings: 0,
    protectEventRecordings: true,
    blockSeconds: config.recordingBlockSeconds,
  };
}

function publicRetention(row, cameraId = row?.camera_id) {
  if (!row) return defaultRetention(cameraId);
  return {
    cameraId: row.camera_id,
    strategy: row.strategy,
    cleanupEnabled: Boolean(row.cleanup_enabled),
    maxAgeDays: Number(row.max_age_days || 0),
    eventMaxAgeDays: Number(row.event_max_age_days || 0),
    maxStorageBytes: Number(row.max_storage_bytes || 0),
    minFreeBytes: Number(row.min_free_bytes || 0),
    maxRecordings: Number(row.max_recordings || 0),
    protectEventRecordings: Boolean(row.protect_event_recordings),
    blockSeconds: Math.max(30, Math.min(3600, Number(row.block_seconds || config.recordingBlockSeconds))),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    cameraId: row.camera_id,
    type: row.type,
    source: row.source,
    state: row.state,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    expiresAt: row.expires_at,
    severity: row.severity,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}

export const recordingPolicyRepository = {
  listPlans(cameraId) {
    return db.prepare('SELECT * FROM recording_plans WHERE camera_id=? ORDER BY priority ASC, created_at ASC').all(cameraId).map(publicPlan);
  },

  replacePlans(cameraId, plans = []) {
    const now = new Date().toISOString();
    const existing = new Map(db.prepare('SELECT id,created_at FROM recording_plans WHERE camera_id=?').all(cameraId).map((row) => [row.id, row]));
    const normalized = plans.map((plan, index) => normalizeRecordingPlan({ ...plan, priority: plan.priority ?? (index + 1) * 100 }));
    const remove = db.prepare('DELETE FROM recording_plans WHERE camera_id=?');
    const insert = db.prepare(`INSERT INTO recording_plans(
      id,camera_id,name,mode,enabled,timezone,weekdays_json,start_time,end_time,valid_from,valid_until,
      include_dates_json,exclude_dates_json,holiday_policy,holiday_dates_json,event_types_json,
      prebuffer_seconds,postbuffer_seconds,priority,quality,profile_token,created_at,updated_at
    ) VALUES(@id,@cameraId,@name,@mode,@enabled,@timezone,@weekdaysJson,@startTime,@endTime,@validFrom,@validUntil,
      @includeDatesJson,@excludeDatesJson,@holidayPolicy,@holidayDatesJson,@eventTypesJson,
      @prebufferSeconds,@postbufferSeconds,@priority,@quality,@profileToken,@createdAt,@updatedAt)`);
    db.exec('BEGIN');
    try {
      remove.run(cameraId);
      normalized.forEach((plan) => {
        const id = plan.id || crypto.randomUUID();
        insert.run({
          id, cameraId, name: plan.name, mode: plan.mode, enabled: Number(plan.enabled), timezone: plan.timezone,
          weekdaysJson: JSON.stringify(plan.weekdays), startTime: plan.startTime, endTime: plan.endTime,
          validFrom: plan.validFrom, validUntil: plan.validUntil,
          includeDatesJson: JSON.stringify(plan.includeDates), excludeDatesJson: JSON.stringify(plan.excludeDates),
          holidayPolicy: plan.holidayPolicy, holidayDatesJson: JSON.stringify(plan.holidayDates),
          eventTypesJson: JSON.stringify(plan.eventTypes), prebufferSeconds: plan.prebufferSeconds,
          postbufferSeconds: plan.postbufferSeconds, priority: plan.priority, quality: plan.quality, profileToken: plan.profileToken,
          createdAt: existing.get(id)?.created_at || now, updatedAt: now,
        });
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return this.listPlans(cameraId);
  },

  getRetention(cameraId) {
    return publicRetention(db.prepare('SELECT * FROM camera_retention_policies WHERE camera_id=?').get(cameraId), cameraId);
  },

  saveRetention(cameraId, input = {}) {
    const current = this.getRetention(cameraId);
    const now = new Date().toISOString();
    const value = {
      ...current,
      ...input,
      cameraId,
      strategy: ['none', 'age', 'quota', 'hybrid'].includes(input.strategy) ? input.strategy : current.strategy,
      cleanupEnabled: input.cleanupEnabled === undefined ? current.cleanupEnabled : Boolean(input.cleanupEnabled),
      maxAgeDays: Math.max(0, Math.min(3650, Number(input.maxAgeDays ?? current.maxAgeDays))),
      eventMaxAgeDays: Math.max(0, Math.min(3650, Number(input.eventMaxAgeDays ?? current.eventMaxAgeDays))),
      maxStorageBytes: Math.max(0, Math.round(Number(input.maxStorageBytes ?? current.maxStorageBytes))),
      minFreeBytes: Math.max(0, Math.round(Number(input.minFreeBytes ?? current.minFreeBytes))),
      maxRecordings: Math.max(0, Math.round(Number(input.maxRecordings ?? current.maxRecordings))),
      protectEventRecordings: input.protectEventRecordings === undefined ? current.protectEventRecordings : Boolean(input.protectEventRecordings),
      blockSeconds: Math.max(30, Math.min(3600, Math.round(Number(input.blockSeconds ?? current.blockSeconds ?? config.recordingBlockSeconds)))),
    };
    db.prepare(`INSERT INTO camera_retention_policies(
      camera_id,strategy,cleanup_enabled,max_age_days,event_max_age_days,max_storage_bytes,min_free_bytes,max_recordings,protect_event_recordings,block_seconds,created_at,updated_at
    ) VALUES(@cameraId,@strategy,@cleanupEnabled,@maxAgeDays,@eventMaxAgeDays,@maxStorageBytes,@minFreeBytes,@maxRecordings,@protectEventRecordings,@blockSeconds,@createdAt,@updatedAt)
    ON CONFLICT(camera_id) DO UPDATE SET strategy=excluded.strategy,cleanup_enabled=excluded.cleanup_enabled,max_age_days=excluded.max_age_days,
      event_max_age_days=excluded.event_max_age_days,max_storage_bytes=excluded.max_storage_bytes,min_free_bytes=excluded.min_free_bytes,
      max_recordings=excluded.max_recordings,protect_event_recordings=excluded.protect_event_recordings,block_seconds=excluded.block_seconds,updated_at=excluded.updated_at`)
      .run({ ...value, cleanupEnabled: Number(value.cleanupEnabled), protectEventRecordings: Number(value.protectEventRecordings), createdAt: current.createdAt || now, updatedAt: now });
    return this.getRetention(cameraId);
  },

  addEvent(cameraId, input = {}) {
    const now = new Date();
    const state = ['start', 'pulse', 'stop'].includes(input.state) ? input.state : 'pulse';
    const id = input.id || crypto.randomUUID();
    const startedAt = input.startedAt ? new Date(input.startedAt) : now;
    const durationSeconds = Math.max(0, Math.min(86_400, Number(input.durationSeconds || 0)));
    const endedAt = state === 'stop' ? (input.endedAt ? new Date(input.endedAt) : now) : (input.endedAt ? new Date(input.endedAt) : null);
    const expiresAt = input.expiresAt ? new Date(input.expiresAt)
      : state === 'pulse' ? new Date(startedAt.getTime() + Math.max(1, durationSeconds || 10) * 1000)
        : endedAt;
    const event = {
      id, cameraId,
      type: String(input.type || 'motion').trim().toLowerCase().slice(0, 80),
      source: String(input.source || 'api').trim().slice(0, 120),
      state,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt?.toISOString() || null,
      expiresAt: expiresAt?.toISOString() || null,
      severity: String(input.severity || 'info').slice(0, 20),
      metadataJson: JSON.stringify(input.metadata || {}).slice(0, 16_000),
      createdAt: now.toISOString(),
    };
    db.prepare(`INSERT INTO recording_events(id,camera_id,type,source,state,started_at,ended_at,expires_at,severity,metadata_json,created_at)
      VALUES(@id,@cameraId,@type,@source,@state,@startedAt,@endedAt,@expiresAt,@severity,@metadataJson,@createdAt)`).run(event);
    if (state === 'stop') {
      db.prepare(`UPDATE recording_events SET ended_at=COALESCE(ended_at,@endedAt),expires_at=COALESCE(expires_at,@endedAt)
        WHERE camera_id=@cameraId AND type=@type AND source=@source AND state='start' AND ended_at IS NULL`).run(event);
    }
    return publicEvent(db.prepare('SELECT * FROM recording_events WHERE id=?').get(id));
  },

  getEvent(eventId) {
    return publicEvent(db.prepare('SELECT * FROM recording_events WHERE id=?').get(eventId));
  },

  mergeEventMetadata(eventId, patch = {}) {
    const row = db.prepare('SELECT metadata_json FROM recording_events WHERE id=?').get(eventId);
    if (!row) return null;
    let current = {};
    try { current = row.metadata_json ? JSON.parse(row.metadata_json) : {}; } catch { current = {}; }
    const metadata = { ...current, ...(patch || {}) };
    db.prepare('UPDATE recording_events SET metadata_json=? WHERE id=?').run(JSON.stringify(metadata).slice(0, 16000), eventId);
    return publicEvent(db.prepare('SELECT * FROM recording_events WHERE id=?').get(eventId));
  },

  recentEvents(cameraId, { sinceHours = 24, limit = 500 } = {}) {
    const since = new Date(Date.now() - Math.max(1, sinceHours) * 3600_000).toISOString();
    return db.prepare(`SELECT * FROM recording_events
      WHERE camera_id=? AND (started_at>=? OR expires_at>=? OR (state='start' AND ended_at IS NULL))
      ORDER BY started_at DESC LIMIT ?`)
      .all(cameraId, since, new Date().toISOString(), limit).map(publicEvent);
  },

  listEvents(cameraId, limit = 200) {
    return db.prepare('SELECT * FROM recording_events WHERE camera_id=? ORDER BY started_at DESC LIMIT ?').all(cameraId, limit).map(publicEvent);
  },
};
