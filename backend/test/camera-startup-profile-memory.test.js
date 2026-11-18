import { beforeAll, describe, expect, it } from 'vitest';
import { migrate, db } from '../src/db/database.js';
import { cameraStartupProfileMemory } from '../src/services/media/CameraStartupProfileMemory.js';

beforeAll(() => migrate());

describe('Persisted verified camera startup profiles', () => {
  it('persists only profile and transport; no camera credentials or RTSP URLs', () => {
    const cameraId = 'test-profile-' + Date.now() + Math.random();
    try {
      expect(cameraStartupProfileMemory.get(cameraId)).toBeNull();
      cameraStartupProfileMemory.remember(cameraId, { token: 'SecondStreamProfile' }, { transport: 'tcp', uri: 'rtsp://admin:password@192.0.2.12:554/live' });
      expect(cameraStartupProfileMemory.get(cameraId)).toEqual({ token: 'SecondStreamProfile', transport: 'tcp' });
      const saved = db.prepare('SELECT value FROM system_settings WHERE key=?').get('camera_last_good_profile_v1_' + cameraId).value;
      expect(saved).not.toContain('password');
      expect(saved).not.toContain('192.0.2');
      expect(saved).not.toContain('admin');
    } finally {
      db.prepare('DELETE FROM system_settings WHERE key=?').run('camera_last_good_profile_v1_' + cameraId);
    }
  });
});
