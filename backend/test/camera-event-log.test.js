import { beforeAll, describe, expect, it } from 'vitest';
import { migrate, db } from '../src/db/database.js';
import { cameraEventLog } from '../src/services/CameraEventLog.js';

const cameraId = 'camera-log-test';

beforeAll(() => {
  migrate();
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO cameras(
    id,name,location,status,created_at,updated_at,onvif_ip,onvif_port,enabled
  ) VALUES(?,?,?,?,?,?,?,?,1)`).run(cameraId, 'Log Test', '', 'offline', now, now, '192.0.2.10', 80);
});

describe('Kamera-Diagnoseprotokoll', () => {
  it('speichert Ereignisse pro Kamera und entfernt Geheimnisse', () => {
    cameraEventLog.clear(cameraId);
    cameraEventLog.append(cameraId, {
      level: 'warn', component: 'ffmpeg', code: 'TEST', message: 'Fehler bei rtsp://user:pass@192.0.2.10/live',
      details: { password: 'secret', uri: 'rtsp://user:pass@192.0.2.10/live', line: 'token=abc' },
    });
    const [entry] = cameraEventLog.list(cameraId, { limit: 10 });
    expect(entry.level).toBe('warn');
    expect(entry.message).not.toContain('user:pass');
    expect(entry.details.password).toBe('[REDACTED]');
    expect(entry.details.uri).toBe('[REDACTED]');
    expect(entry.details.line).not.toContain('abc');
  });

  it('unterstützt inkrementelles Nachladen und Leeren', () => {
    cameraEventLog.clear(cameraId);
    const first = cameraEventLog.append(cameraId, { message: 'eins' });
    cameraEventLog.append(cameraId, { message: 'zwei' });
    const incremental = cameraEventLog.list(cameraId, { after: first, limit: 10 });
    expect(incremental.map((item) => item.message)).toEqual(['zwei']);
    expect(cameraEventLog.clear(cameraId)).toBe(2);
  });
});
