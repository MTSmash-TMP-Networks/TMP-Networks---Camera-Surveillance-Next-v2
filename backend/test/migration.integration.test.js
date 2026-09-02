import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('Migration einer bestehenden Installation', () => {
  it('uebernimmt Zugangsdaten verschluesselt und entfernt alte URI-/Klartextspalten', () => {
    const dbPath = `/tmp/tmp-camera-legacy-${process.pid}-${Date.now()}.db`;
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`CREATE TABLE cameras (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, location TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL,
      onvif_ip TEXT, onvif_port INTEGER, onvif_xaddr TEXT, stream_profile TEXT,
      username TEXT, password TEXT, capabilities TEXT, rotation INTEGER DEFAULT 0,
      rtsp_url TEXT, stream_uri_cache TEXT, snapshot_uri_cache TEXT
    )`);
    legacy.prepare(`INSERT INTO cameras(id,name,status,created_at,onvif_ip,onvif_port,username,password,rtsp_url) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run('legacy-camera', 'Alt', 'offline', new Date().toISOString(), '192.0.2.40', 80, 'legacy-user', 'legacy-pass', 'rtsp://legacy-user:legacy-pass@192.0.2.40/live');
    legacy.close();

    const script = `
      const { migrate, db } = await import('./src/db/database.js');
      const { cameraRepository } = await import('./src/services/cameraRepository.js');
      migrate();
      const columns = db.prepare('PRAGMA table_info(cameras)').all().map((column) => column.name);
      const camera = cameraRepository.getWithCredentials('legacy-camera');
      const profileColumns = db.prepare('PRAGMA table_info(camera_profiles)').all().map((column) => column.name);
      const sourceColumns = db.prepare('PRAGMA table_info(camera_media_sources)').all().map((column) => column.name);
      console.log(JSON.stringify({ columns, profileColumns, sourceColumns, username: camera.username, password: camera.password, codecPreference: camera.codecPreference, sourcePolicy: camera.sourcePolicy }));
      db.close();
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        DB_PATH: dbPath,
        APP_DATA_DIR: '/tmp',
        ADMIN_USER: 'migration-admin',
        ADMIN_PASSWORD: 'migration-password',
        JWT_SECRET: 'migration-jwt-secret-abcdefghijklmnopqrstuvwxyz',
        MEDIA_TOKEN_SECRET: 'migration-media-secret-abcdefghijklmnopqrstuvwxyz',
        CAMERA_CREDENTIAL_KEY: 'migration-camera-key-abcdefghijklmnopqrstuvwxyz',
        LOG_LEVEL: 'silent',
      },
    });
    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout.trim().split('\n').at(-1));
    expect(payload.username).toBe('legacy-user');
    expect(payload.password).toBe('legacy-pass');
    expect(payload.codecPreference).toBe('auto');
    expect(payload.sourcePolicy).toBe('auto');
    expect(payload.columns).toContain('codec_preference');
    expect(payload.columns).toContain('source_policy');
    expect(payload.sourceColumns).toContain('url');
    expect(payload.profileColumns).toContain('video_profile');
    expect(payload.profileColumns).toContain('media_service');
    for (const obsolete of ['username', 'password', 'rtsp_url', 'stream_uri_cache', 'snapshot_uri_cache']) {
      expect(payload.columns).not.toContain(obsolete);
    }
    fs.rmSync(dbPath, { force: true });
  });
});
