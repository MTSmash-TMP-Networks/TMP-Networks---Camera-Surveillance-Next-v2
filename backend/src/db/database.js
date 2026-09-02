import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { encryptSecret } from '../services/credentialVault.js';
import { logger } from '../utils/logger.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(config.recordingsDir, { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

function columns(table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function addColumn(table, name, declaration) {
  if (!columns(table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${declaration}`);
}

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cameras (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      created_at TEXT NOT NULL,
      updated_at TEXT,
      onvif_ip TEXT NOT NULL,
      onvif_port INTEGER NOT NULL DEFAULT 80,
      onvif_xaddr TEXT,
      stream_profile TEXT,
      username_enc TEXT,
      password_enc TEXT,
      capabilities TEXT,
      default_preset_token TEXT,
      default_preset_name TEXT,
      rotation INTEGER DEFAULT 0,
      mac_address TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      profile_policy TEXT NOT NULL DEFAULT 'auto',
      codec_preference TEXT NOT NULL DEFAULT 'auto',
      source_policy TEXT NOT NULL DEFAULT 'auto',
      last_seen_at TEXT,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS camera_profiles (
      camera_id TEXT NOT NULL,
      token TEXT NOT NULL,
      name TEXT NOT NULL,
      video_codec TEXT,
      video_profile TEXT,
      media_service TEXT NOT NULL DEFAULT 'auto',
      audio_codec TEXT,
      width INTEGER,
      height INTEGER,
      fps REAL,
      bitrate INTEGER,
      has_ptz INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL DEFAULT 'alternative',
      rank INTEGER NOT NULL DEFAULT 999,
      last_verified_at TEXT,
      PRIMARY KEY (camera_id, token),
      FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS camera_media_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      camera_id TEXT NOT NULL,
      label TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'auto',
      url TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100,
      enabled INTEGER NOT NULL DEFAULT 1,
      origin TEXT NOT NULL DEFAULT 'manual',
      last_status TEXT NOT NULL DEFAULT 'unknown',
      last_error TEXT,
      last_verified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','operator','viewer')),
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS camera_event_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      camera_id TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      component TEXT NOT NULL,
      code TEXT,
      message TEXT NOT NULL,
      details_json TEXT,
      session_key TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      camera_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_seconds INTEGER,
      status TEXT NOT NULL DEFAULT 'recording',
      file_size_bytes INTEGER,
      created_at TEXT NOT NULL,
      recording_group_id TEXT,
      segment_index INTEGER DEFAULT 0,
      segment_seconds INTEGER DEFAULT 300,
      FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_profiles_camera_role ON camera_profiles(camera_id, role, rank);
    CREATE INDEX IF NOT EXISTS idx_media_sources_camera_priority ON camera_media_sources(camera_id, enabled, priority, id);
    CREATE INDEX IF NOT EXISTS idx_camera_event_logs_camera_id ON camera_event_logs(camera_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_camera_event_logs_created_at ON camera_event_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_recordings_camera_time ON recordings(camera_id, started_at DESC);
  `);

  const cameraColumns = {
    updated_at: 'TEXT', username_enc: 'TEXT', password_enc: 'TEXT', enabled: 'INTEGER NOT NULL DEFAULT 1',
    profile_policy: "TEXT NOT NULL DEFAULT 'auto'", codec_preference: "TEXT NOT NULL DEFAULT 'auto'", source_policy: "TEXT NOT NULL DEFAULT 'auto'", last_seen_at: 'TEXT', last_error: 'TEXT',
    device_uid: 'TEXT', serial_number: 'TEXT', motion_zone: 'TEXT',
  };
  for (const [name, declaration] of Object.entries(cameraColumns)) addColumn('cameras', name, declaration);
  addColumn('camera_profiles', 'video_profile', 'TEXT');
  addColumn('camera_profiles', 'media_service', "TEXT NOT NULL DEFAULT 'auto'");
  addColumn('users', 'auth_version', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('users', 'last_login_at', 'TEXT');

  const recordingColumns = {
    trigger_type: "TEXT NOT NULL DEFAULT 'manual'",
    plan_id: 'TEXT', event_id: 'TEXT', interruption_count: 'INTEGER NOT NULL DEFAULT 0',
    gap_seconds: 'REAL NOT NULL DEFAULT 0', metadata_json: 'TEXT', protected_until: 'TEXT',
    retention_class: "TEXT NOT NULL DEFAULT 'standard'",
  };
  for (const [name, declaration] of Object.entries(recordingColumns)) addColumn('recordings', name, declaration);

  db.exec(`
    CREATE TABLE IF NOT EXISTS discovery_runs (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      request_json TEXT,
      diagnostics_json TEXT,
      result_count INTEGER NOT NULL DEFAULT 0,
      filtered_count INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      origin TEXT NOT NULL DEFAULT 'manual',
      results_json TEXT
    );

    CREATE TABLE IF NOT EXISTS recording_plans (
      id TEXT PRIMARY KEY,
      camera_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('continuous','event','scheduled')),
      enabled INTEGER NOT NULL DEFAULT 1,
      timezone TEXT NOT NULL DEFAULT 'Europe/Berlin',
      weekdays_json TEXT NOT NULL DEFAULT '[1,2,3,4,5,6,0]',
      start_time TEXT NOT NULL DEFAULT '00:00',
      end_time TEXT NOT NULL DEFAULT '23:59',
      valid_from TEXT,
      valid_until TEXT,
      include_dates_json TEXT NOT NULL DEFAULT '[]',
      exclude_dates_json TEXT NOT NULL DEFAULT '[]',
      holiday_policy TEXT NOT NULL DEFAULT 'include' CHECK(holiday_policy IN ('include','exclude','only')),
      holiday_dates_json TEXT NOT NULL DEFAULT '[]',
      event_types_json TEXT NOT NULL DEFAULT '["motion","sensor"]',
      prebuffer_seconds INTEGER NOT NULL DEFAULT 0,
      postbuffer_seconds INTEGER NOT NULL DEFAULT 10,
      priority INTEGER NOT NULL DEFAULT 100,
      quality TEXT NOT NULL DEFAULT 'balanced',
      profile_token TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS camera_retention_policies (
      camera_id TEXT PRIMARY KEY,
      strategy TEXT NOT NULL DEFAULT 'hybrid' CHECK(strategy IN ('none','age','quota','hybrid')),
      cleanup_enabled INTEGER NOT NULL DEFAULT 1,
      max_age_days INTEGER NOT NULL DEFAULT 30,
      event_max_age_days INTEGER NOT NULL DEFAULT 30,
      max_storage_bytes INTEGER NOT NULL DEFAULT 0,
      min_free_bytes INTEGER NOT NULL DEFAULT 2147483648,
      max_recordings INTEGER NOT NULL DEFAULT 0,
      protect_event_recordings INTEGER NOT NULL DEFAULT 1,
      block_seconds INTEGER NOT NULL DEFAULT 300,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recording_events (
      id TEXT PRIMARY KEY,
      camera_id TEXT NOT NULL,
      type TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'api',
      state TEXT NOT NULL CHECK(state IN ('start','pulse','stop')),
      started_at TEXT NOT NULL,
      ended_at TEXT,
      expires_at TEXT,
      severity TEXT NOT NULL DEFAULT 'info',
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id TEXT,
      actor_username TEXT,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL DEFAULT 'system',
      resource_id TEXT,
      outcome TEXT NOT NULL DEFAULT 'success' CHECK(outcome IN ('success','denied','failed')),
      request_id TEXT,
      ip_address TEXT,
      details_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL DEFAULT 'email',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
      event_kind TEXT NOT NULL,
      event_code TEXT,
      camera_id TEXT,
      recipient_count INTEGER NOT NULL DEFAULT 0,
      subject TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT,
      FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notification_deliveries_created ON notification_deliveries(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notification_deliveries_camera ON notification_deliveries(camera_id, id DESC);

    CREATE TABLE IF NOT EXISTS recording_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recording_id INTEGER NOT NULL,
      segment_index INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      size_bytes INTEGER,
      status TEXT NOT NULL DEFAULT 'ready',
      error TEXT,
      gap_seconds REAL NOT NULL DEFAULT 0,
      UNIQUE(recording_id, segment_index),
      FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cameras_mac ON cameras(mac_address);
    CREATE INDEX IF NOT EXISTS idx_cameras_device_uid ON cameras(device_uid);
    CREATE INDEX IF NOT EXISTS idx_cameras_serial ON cameras(serial_number);
    CREATE INDEX IF NOT EXISTS idx_discovery_runs_started ON discovery_runs(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_recording_plans_camera ON recording_plans(camera_id, enabled, priority);
    CREATE INDEX IF NOT EXISTS idx_recording_events_camera_time ON recording_events(camera_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS recording_storage_profiles (
      id TEXT PRIMARY KEY,
      protocol TEXT NOT NULL CHECK(protocol IN ('smb','sftp')),
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      share_name TEXT,
      base_path TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL DEFAULT '',
      password_enc TEXT,
      domain_name TEXT NOT NULL DEFAULT '',
      host_key_policy TEXT NOT NULL DEFAULT 'accept-new',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_recording_storage_profiles_active ON recording_storage_profiles(active, updated_at DESC);

    CREATE TABLE IF NOT EXISTS recording_compression_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recording_id INTEGER NOT NULL,
      segment_index INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      original_bytes INTEGER NOT NULL DEFAULT 0,
      compressed_bytes INTEGER NOT NULL DEFAULT 0,
      saved_bytes INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      next_attempt_at TEXT,
      UNIQUE(recording_id, segment_index),
      FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_recording_segments_recording ON recording_segments(recording_id, segment_index);
    CREATE INDEX IF NOT EXISTS idx_recordings_retention ON recordings(camera_id, status, started_at);
    CREATE INDEX IF NOT EXISTS idx_recording_compression_queue ON recording_compression_jobs(status, next_attempt_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id, id DESC);
  `);


  addColumn('discovery_runs', 'origin', "TEXT NOT NULL DEFAULT 'manual'");
  addColumn('discovery_runs', 'results_json', 'TEXT');
  addColumn('recording_plans', 'quality', "TEXT NOT NULL DEFAULT 'balanced'");
  addColumn('recording_plans', 'profile_token', 'TEXT');
  addColumn('recording_segments', 'duration_seconds', 'REAL NOT NULL DEFAULT 0');
  addColumn('recording_segments', 'media_format', "TEXT NOT NULL DEFAULT 'mpegts'");
  addColumn('recording_segments', 'finalized_at', 'TEXT');
  addColumn('recording_segments', 'is_discontinuity', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('recording_segments', 'storage_profile_id', 'TEXT');
  addColumn('recording_segments', 'remote_path', 'TEXT');
  addColumn('recording_segments', 'remote_uploaded_at', 'TEXT');
  addColumn('recording_segments', 'storage_state', "TEXT NOT NULL DEFAULT 'local'");
  addColumn('recording_segments', 'storage_error', 'TEXT');
  addColumn('camera_retention_policies', 'block_seconds', `INTEGER NOT NULL DEFAULT ${config.recordingBlockSeconds}`);

  // A process restart must not destroy the recording state. The recovery service
  // reconciles committed blocks and the final partial block after startup.
  db.prepare("UPDATE recordings SET status='interrupted', ended_at=COALESCE(ended_at, ?) WHERE status='recording'").run(new Date().toISOString());
  migrateLegacyCredentials();
  removeLegacyColumns();
  ensureAdmin();
}

function migrateLegacyCredentials() {
  const cols = columns('cameras');
  if (!cols.has('username') || !cols.has('password')) return;
  const rows = db.prepare(`SELECT id, username, password, username_enc, password_enc FROM cameras`).all();
  const update = db.prepare(`UPDATE cameras SET username_enc=?, password_enc=?, username=NULL, password=NULL WHERE id=?`);
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      if ((!row.username && !row.password) || (row.username_enc && row.password_enc)) continue;
      update.run(row.username_enc || encryptSecret(row.username), row.password_enc || encryptSecret(row.password), row.id);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}


function removeLegacyColumns() {
  const obsolete = [
    'username', 'password', 'rtsp_url',
    'stream_uri_cache', 'stream_uri_scheme', 'stream_uri_updated_at',
    'snapshot_uri_cache', 'snapshot_uri_updated_at',
  ];
  for (const name of obsolete) {
    if (!columns('cameras').has(name)) continue;
    try {
      db.exec(`ALTER TABLE cameras DROP COLUMN ${name}`);
      logger.info({ column: name }, 'Veraltete Kameraspalte wurde entfernt');
    } catch (error) {
      if (['username', 'password', 'rtsp_url', 'stream_uri_cache', 'snapshot_uri_cache'].includes(name)) {
        try { db.exec(`UPDATE cameras SET ${name}=NULL`); } catch { /* best effort fuer alte SQLite-Versionen */ }
      }
      logger.warn({ column: name, error: error.message }, 'Veraltete Kameraspalte konnte nicht entfernt werden und wurde soweit moeglich geleert');
    }
  }
}

function ensureAdmin() {
  const existing = db.prepare('SELECT id FROM users WHERE username=?').get(config.adminUser);
  if (existing) return;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO users(id,username,password_hash,role,enabled,created_at,updated_at) VALUES(?,?,?,?,1,?,?)`)
    .run(crypto.randomUUID(), config.adminUser, bcrypt.hashSync(config.adminPassword, 12), 'admin', now, now);
  logger.warn({ username: config.adminUser }, 'Initialer Administrator wurde angelegt');
}
