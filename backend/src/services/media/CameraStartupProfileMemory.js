import { db } from '../../db/database.js';

// Only profile token/transport/source ID are persisted, never the actual RTSP
// URL or any credentials. All choices are validated against camera profiles on
// use, so removed profiles cannot block fallback discovery.
const KEY_PREFIX = 'camera_last_good_profile_v1_';

export class CameraStartupProfileMemory {
  get(cameraId) {
    try {
      const row = db.prepare('SELECT value FROM system_settings WHERE key=?').get(KEY_PREFIX + String(cameraId));
      if (!row) return null;
      const value = JSON.parse(row.value || 'null');
      if (!value || typeof value.token !== 'string' || value.token.length > 200 ||
          !['tcp', 'udp', 'http', 'https', 'rtsp', 'rtsps'].includes(value.transport)) return null;
      return { token: value.token, transport: value.transport };
    } catch { return null; }
  }

  remember(cameraId, profile, candidate) {
    const token = String(profile?.token || '');
    const transport = String(candidate?.transport || 'tcp').toLowerCase();
    if (!token || token.length > 200 || !['tcp','udp','http','https','rtsp','rtsps'].includes(transport)) return;
    db.prepare(`INSERT INTO system_settings (key,value,updated_at) VALUES (?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .run(KEY_PREFIX + String(cameraId), JSON.stringify({ token, transport }), new Date().toISOString());
  }
}

export const cameraStartupProfileMemory = new CameraStartupProfileMemory();
