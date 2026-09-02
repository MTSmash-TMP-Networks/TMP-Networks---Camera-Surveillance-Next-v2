import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

let app;
let adminToken;
let viewerToken;

beforeAll(async () => {
  process.env.UPDATER_TOKEN = 'test-updater-token-abcdefghijklmnopqrstuvwxyz';
  const [{ createApp }, { migrate }] = await Promise.all([
    import('../src/app.js'),
    import('../src/db/database.js'),
  ]);
  migrate();
  app = createApp();
  adminToken = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'integration-password' }).expect(200)).body.token;
  await request(app).post('/api/auth/users').set('Authorization', `Bearer ${adminToken}`).send({ username: 'update-viewer', password: 'viewer-password-123', role: 'viewer' }).expect(201);
  viewerToken = (await request(app).post('/api/auth/login').send({ username: 'update-viewer', password: 'viewer-password-123' }).expect(200)).body.token;
});

afterEach(() => vi.unstubAllGlobals());

describe('Update-Center API', () => {
  it('ist ausschließlich für Administratoren erreichbar', async () => {
    await request(app).get('/api/system/update').set('Authorization', `Bearer ${viewerToken}`).expect(403);
  });

  it('liefert Version und Updaterstatus für Administratoren', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ service: 'tmp-camera-updater', status: 'ok', installReady: true, version: '2.8.3', busy: false }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const response = await request(app).get('/api/system/update').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(response.body.currentVersion).toBe('2.8.3');
    expect(response.body.updater.status).toBe('ok');
    expect(response.body.updater.url).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('http://updater:3010');
    expect(Array.isArray(response.body.packages)).toBe(true);
  });

  it('weist Dateien ohne ZIP-Signatur vor der Updaterübergabe ab', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await request(app)
      .post('/api/system/update/upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/zip')
      .set('X-File-Name', 'fake.zip')
      .send(Buffer.from('keine zip-datei'))
      .expect(400);
    expect(response.body.error).toBe('UPDATE_NOT_ZIP');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('verlangt eine ausdrückliche Installationsbestätigung', async () => {
    await request(app)
      .post('/api/system/update/install')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ packageId: '11111111-1111-4111-8111-111111111111', confirmation: 'JA' })
      .expect(400);
  });
});
