import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// The production config defaults to /data; isolated CI tests use a writable
// temporary data root before importing the backend's database module.
const fixtureDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tmp-thumbnail-backend-'));
process.env.APP_DATA_DIR = fixtureDataDir;
process.env.DB_PATH = path.join(fixtureDataDir, 'thumbnail-test.sqlite');
const { CameraThumbnailCache, latestHlsSegment, CAMERA_THUMBNAIL_REFRESH_MS } =
  await import('../src/services/media/CameraThumbnailCache.js');


const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(150, 40), Buffer.from([0xff, 0xd9])]);

test('the newest available non-stale segment survives HLS playlist rotation', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tmp-thumbnail-ring-'));
  try {
    await fsp.writeFile(path.join(root, 'index.m3u8'), '#EXTM3U\nseg_0000001.ts\nseg_0000002.ts\n');
    await fsp.writeFile(path.join(root, 'seg_0000001.ts'), Buffer.alloc(3000, 1));
    assert.equal(latestHlsSegment(root), path.join(root, 'seg_0000001.ts'));
    const expired = new Date(Date.now() - 60_000);
    await fsp.utimes(path.join(root, 'seg_0000001.ts'), expired, expired);
    assert.equal(latestHlsSegment(root), null);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('cache persists JPEGs and preserves the last good image after a decoder failure', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tmp-thumbnail-cache-'));
  let fail = false;
  const cache = new CameraThumbnailCache({
    directory: root,
    cameras: () => [{ id: 'camera-1', enabled: true }],
    source: () => '/local/hls/seg_000001.ts',
    capture: async () => {
      if (fail) throw new Error('decoder unavailable');
      return jpeg;
    },
  });
  try {
    assert.equal(CAMERA_THUMBNAIL_REFRESH_MS, 60_000);
    assert.equal(await cache.read('camera-1'), null);
    assert.equal(await cache.refreshCamera('camera-1'), true);
    const cached = await cache.read('camera-1');
    assert.deepEqual(cached.buffer, jpeg);
    assert.ok(cached.updatedAt);
    fail = true;
    await assert.rejects(cache.refreshCamera('camera-1'), /decoder unavailable/);
    assert.deepEqual((await cache.read('camera-1')).buffer, jpeg);
    await cache.discard('camera-1');
    assert.equal(await cache.read('camera-1'), null);
  } finally {
    cache.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('no thumbnail page read is wired to live camera capture', () => {
  const overview = fs.readFileSync(new URL('../../frontend/src/components/SnapshotBackdrop.jsx', import.meta.url), 'utf8');
  const kiosk = fs.readFileSync(new URL('../../frontend/src/pages/KioskPage.jsx', import.meta.url), 'utf8');
  const routes = fs.readFileSync(new URL('../src/routes/cameras.js', import.meta.url), 'utf8');
  const cache = fs.readFileSync(new URL('../src/services/media/CameraThumbnailCache.js', import.meta.url), 'utf8');
  assert.match(overview, /api\.thumbnail\(cameraId\)/);
  assert.match(kiosk, /api\.thumbnail\(cameraId/);
  assert.match(routes, /cameraThumbnailCache\.read\(camera\.id\)/);
  assert.doesNotMatch(cache, /snapshotService\.capture|\.ensure\(|startPermanentIngest/);
  assert.match(cache, /findPermanentIngestSession/);
  assert.match(cache, /const spacing = this\.refreshMs \/ Math\.max\(1, cameras\.length\)/);
});
