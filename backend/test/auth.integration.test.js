import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
let app;
let adminToken;

beforeAll(async () => {
  const { migrate } = await import('../src/db/database.js');
  migrate();
  ({ createApp: app } = await import('../src/app.js'));
  app = app();
  const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'integration-password' }).expect(200);
  adminToken = login.body.token;
});

describe('Authentifizierte API', () => {
  it('weist nicht angemeldete Kameraabfragen ab', async () => {
    await request(app).get('/api/cameras').expect(401);
  });

  it('meldet den initialen Administrator an und liefert Kameras', async () => {
    await request(app).get('/api/cameras').set('Authorization', `Bearer ${adminToken}`).expect(200).expect(({ body }) => expect(body.items).toEqual([]));
  });

  it('speichert im neuen Schema keine Klartext-Kamerakennwoerter', async () => {
    const { db } = await import('../src/db/database.js');
    const names = db.prepare('PRAGMA table_info(cameras)').all().map((column) => column.name);
    expect(names).not.toContain('username');
    expect(names).not.toContain('password');
    expect(names).toContain('username_enc');
    expect(names).toContain('password_enc');
  });

  it('erzwingt Rollen fuer PTZ und Stream-Neustarts', async () => {
    await request(app).post('/api/auth/users').set('Authorization', `Bearer ${adminToken}`).send({ username: 'viewer-test', password: 'viewer-password-123', role: 'viewer' }).expect(201);
    const viewer = await request(app).post('/api/auth/login').send({ username: 'viewer-test', password: 'viewer-password-123' }).expect(200);
    await request(app).post('/api/streams/missing/restart').set('Authorization', `Bearer ${viewer.body.token}`).expect(403);
    await request(app).post('/api/ptz/missing/stop').set('Authorization', `Bearer ${viewer.body.token}`).send({}).expect(403);
  });

  it('weist fremde ONVIF-Profil-Tokens serverseitig ab', async () => {
    const { cameraRepository } = await import('../src/services/cameraRepository.js');
    const camera = cameraRepository.create({ name: 'Testkamera', ip: '192.0.2.20', port: 80, username: 'u', password: 'p', capabilities: {} });
    cameraRepository.replaceProfiles(camera.id, [{ token: 'main', name: 'Main', videoCodec: 'H264', audioCodec: 'AAC', width: 1920, height: 1080, fps: 25, bitrate: 4096, hasPtz: false, role: 'high', rank: 0 }]);
    const response = await request(app).post(`/api/streams/${camera.id}/session`).set('Authorization', `Bearer ${adminToken}`).send({ profileToken: 'foreign-token', quality: 'high', viewportWidth: 1920 }).expect(400);
    expect(response.body.error).toBe('INVALID_PROFILE');
  });
  it('aendert das eigene Kennwort nur mit korrektem aktuellen Kennwort', async () => {
    await request(app).post('/api/auth/users').set('Authorization', `Bearer ${adminToken}`).send({ username: 'password-test', password: 'initial-password-123', role: 'viewer' }).expect(201);
    const login = await request(app).post('/api/auth/login').send({ username: 'password-test', password: 'initial-password-123' }).expect(200);
    await request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${login.body.token}`).send({ currentPassword: 'falsch', newPassword: 'new-secure-password-456' }).expect(401);
    await request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${login.body.token}`).send({ currentPassword: 'initial-password-123', newPassword: 'new-secure-password-456' }).expect(200);
    await request(app).post('/api/auth/login').send({ username: 'password-test', password: 'new-secure-password-456' }).expect(200);
  });

  it('bindet Medientokens an Pfad und Aktion', async () => {
    const { authService } = await import('../src/services/authService.js');
    const token = authService.signMediaToken({ userId: 'test-user', path: 'camera_test_webrtc', action: 'read' });
    await request(app).post('/internal/go2rtc-auth').send({ token, path: 'camera_test_webrtc', action: 'read' }).expect(204);
    await request(app).post('/internal/go2rtc-auth').send({ token, path: 'camera_other_webrtc', action: 'read' }).expect(401);
    await request(app).post('/internal/go2rtc-auth').send({ token, path: 'camera_test_webrtc', action: 'publish' }).expect(401);
  });

  it('gibt interne Stream-Broker-Pfade nicht ueber die Status-API aus', async () => {
    const { streamOrchestrator } = await import('../src/services/media/StreamOrchestrator.js');
    const key = 'public-status-test';
    streamOrchestrator.sessions.set(key, {
      cameraId: 'camera-public-test', quality: 'balanced', requestedProfileToken: null,
      paths: { webrtc: 'internal_webrtc', hls: 'internal_hls' }, state: 'ready',
      profile: { token: 'main', name: 'Main' }, probe: null, policy: null, transport: 'tcp',
      connectedAt: Date.now(), lastProgressAt: Date.now(), lastError: null, restartCount: 0,
      process: null, lastRequestedAt: Date.now(), stopRequested: false,
    });
    try {
      const response = await request(app).get('/api/streams/camera-public-test/status').set('Authorization', `Bearer ${adminToken}`).expect(200);
      expect(response.body.items[0]).not.toHaveProperty('paths');
    } finally {
      streamOrchestrator.sessions.delete(key);
    }
  });

  it('weist fremde Profile auch bei Kameraaenderung, Snapshot und PTZ ab', async () => {
    const { cameraRepository } = await import('../src/services/cameraRepository.js');
    const camera = cameraRepository.create({ name: 'Profilpruefung', ip: '192.0.2.30', port: 80, username: 'u', password: 'p', capabilities: {} });
    cameraRepository.replaceProfiles(camera.id, [{ token: 'valid', name: 'Valid', videoCodec: 'H264', audioCodec: 'AAC', width: 1280, height: 720, fps: 25, bitrate: 2048, hasPtz: true, role: 'balanced', rank: 0 }]);
    await request(app).patch(`/api/cameras/${camera.id}`).set('Authorization', `Bearer ${adminToken}`).send({ preferredProfile: 'foreign' }).expect(400);
    await request(app).get(`/api/cameras/${camera.id}/snapshot?profile=foreign`).set('Authorization', `Bearer ${adminToken}`).expect(400);
    await request(app).post(`/api/ptz/${camera.id}/move`).set('Authorization', `Bearer ${adminToken}`).send({ x: 0.1, y: 0, zoom: 0, profileToken: 'foreign' }).expect(400);
  });

  it('liefert und leert das Diagnoseprotokoll einer Kamera', async () => {
    const { cameraRepository } = await import('../src/services/cameraRepository.js');
    const { cameraEventLog } = await import('../src/services/CameraEventLog.js');
    const camera = cameraRepository.create({ name: 'Diagnosekamera', ip: '192.0.2.44', port: 80, username: 'u', password: 'p', capabilities: {} });
    cameraEventLog.append(camera.id, { level: 'warn', component: 'ffmpeg', code: 'TEST_DIAG', message: 'Testmeldung' });
    const list = await request(app).get(`/api/cameras/${camera.id}/logs?limit=10`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].code).toBe('TEST_DIAG');
    const cleared = await request(app).delete(`/api/cameras/${camera.id}/logs`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(cleared.body.deleted).toBe(1);
  });

  it('aendert Name und Standort ohne einen laufenden Stream neu zu starten', async () => {
    const { cameraRepository } = await import('../src/services/cameraRepository.js');
    const { streamOrchestrator } = await import('../src/services/media/StreamOrchestrator.js');
    const camera = cameraRepository.create({ name: 'Alter Name', location: 'Alt', ip: '192.0.2.88', port: 80, username: 'u', password: 'p', capabilities: {} });
    const restart = vi.spyOn(streamOrchestrator, 'restart').mockResolvedValue({ restarted: 0 });
    try {
      const response = await request(app).patch(`/api/cameras/${camera.id}`).set('Authorization', `Bearer ${adminToken}`).send({ name: 'Neuer Name', location: 'Eingang' }).expect(200);
      expect(response.body.camera.name).toBe('Neuer Name');
      expect(response.body.camera.location).toBe('Eingang');
      expect(restart).not.toHaveBeenCalled();
    } finally { restart.mockRestore(); }
  });

  it('kann ein bevorzugtes Profil wieder auf Automatik zuruecksetzen', async () => {
    const { cameraRepository } = await import('../src/services/cameraRepository.js');
    const { streamOrchestrator } = await import('../src/services/media/StreamOrchestrator.js');
    const camera = cameraRepository.create({ name: 'Auto Profil', ip: '192.0.2.89', port: 80, username: 'u', password: 'p', preferredProfile: 'main', capabilities: {} });
    cameraRepository.replaceProfiles(camera.id, [{ token: 'main', name: 'Main', videoCodec: 'H264', audioCodec: null, width: 1280, height: 720, fps: 25, bitrate: 2048, hasPtz: false, role: 'balanced', rank: 0 }]);
    const restart = vi.spyOn(streamOrchestrator, 'restart').mockResolvedValue({ restarted: 0 });
    try {
      const response = await request(app).patch(`/api/cameras/${camera.id}`).set('Authorization', `Bearer ${adminToken}`).send({ preferredProfile: null }).expect(200);
      expect(response.body.camera.preferredProfile).toBeNull();
      expect(restart).toHaveBeenCalledWith(camera.id);
    } finally { restart.mockRestore(); }
  });

  it('startet eine Live-Sitzung nicht blockierend und liefert sofort den Fortschritt', async () => {
    const { cameraRepository } = await import('../src/services/cameraRepository.js');
    const { streamOrchestrator } = await import('../src/services/media/StreamOrchestrator.js');
    const camera = cameraRepository.create({ name: 'Asynckamera', ip: '192.0.2.55', port: 80, username: 'u', password: 'p', capabilities: {} });
    cameraRepository.replaceProfiles(camera.id, [{ token: 'main', name: 'Main', videoCodec: 'H264', audioCodec: null, width: 1280, height: 720, fps: 25, bitrate: 2048, hasPtz: false, role: 'balanced', rank: 0 }]);
    const response = await request(app).post(`/api/streams/${camera.id}/session`).set('Authorization', `Bearer ${adminToken}`).send({ quality: 'balanced', viewportWidth: 1280, profileToken: 'main', wait: false }).expect(202);
    expect(response.body.state).toBe('starting');
    expect(response.body.webrtcUrl).toBeNull();
    expect(response.body.phase).toBeTruthy();
    await streamOrchestrator.stopCamera(camera.id);
  });


  it('schuetzt den Systemstatus und liefert nur normalisierte Metriken', async () => {
    await request(app).get('/api/system/status').expect(401);
    const response = await request(app).get('/api/system/status').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(response.body.cpu.usagePercent).toBeGreaterThanOrEqual(0);
    expect(response.body.memory.totalBytes).toBeGreaterThan(0);
    expect(response.body).not.toHaveProperty('procRoot');
    expect(JSON.stringify(response.body)).not.toContain('/host/proc');
  });

});
