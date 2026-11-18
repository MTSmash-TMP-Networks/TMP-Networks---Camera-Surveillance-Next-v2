import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CameraStartLimiter } from '../src/services/media/CameraStartLimiter.js';
import { inspectLocalHlsRing, effectiveLocalHlsListSize, withLocalHlsContinuity } from '../src/services/media/LocalHlsHealth.js';

test('HLS readiness requires fresh playlist-referenced segment files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-hls-health-'));
  try {
    const playlist = path.join(directory, 'index.m3u8');
    const segment = path.join(directory, 'seg_0000000010.ts');
    fs.writeFileSync(playlist, '#EXTM3U\n#EXTINF:1,\nseg_0000000010.ts\n');
    assert.equal(inspectLocalHlsRing(directory).ready, false);
    fs.writeFileSync(segment, Buffer.alloc(2000, 0x47));
    assert.equal(inspectLocalHlsRing(directory).ready, true);
    const old = new Date(Date.now() - 70_000);
    fs.utimesSync(segment, old, old);
    assert.equal(inspectLocalHlsRing(directory).reason, 'stale-segments');
    fs.writeFileSync(playlist, '#EXTM3U\n#EXTINF:1,\nseg_0000000011.ts\n');
    assert.equal(inspectLocalHlsRing(directory).ready, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a short manifest rotation does not flip a running HLS publisher offline', () => {
  const now = Date.now();
  const missing = { ready: false, newestSegmentAt: null, ageMs: null, reason: 'missing-playlist' };
  const opts = { now, lastReadyAt: now - 1500, graceMs: 10000, processAlive: true, wasReady: true };
  const continuous = withLocalHlsContinuity(missing, opts);
  assert.equal(continuous.ready, true);
  assert.equal(continuous.grace, true);
  assert.equal(withLocalHlsContinuity(missing, { ...opts, lastReadyAt: now - 11000 }).ready, false);
  assert.equal(withLocalHlsContinuity(missing, { ...opts, processAlive: false }).ready, false);
  assert.equal(withLocalHlsContinuity(missing, { ...opts, wasReady: false }).ready, false);
  assert.equal(withLocalHlsContinuity({ ready: true, reason: 'fresh' }, opts).grace, undefined);
  assert.equal(effectiveLocalHlsListSize(30, 60), 60);
  assert.equal(effectiveLocalHlsListSize(80, 60), 80);
  assert.equal(effectiveLocalHlsListSize(30, 0), 30);
});

test('local HLS checks newest segments without statting all 60 fragments', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-hls-many-segments-'));
  try {
    const names = Array.from({ length: 60 }, (_, i) => `seg_${String(i + 1).padStart(10, '0')}.ts`);
    fs.writeFileSync(path.join(directory, 'index.m3u8'), '#EXTM3U\n' + names.map((n) => `#EXTINF:1,\n${n}\n`).join(''));
    fs.writeFileSync(path.join(directory, names.at(-1)), Buffer.alloc(2000, 0x47));
    assert.equal(inspectLocalHlsRing(directory).ready, true);
    fs.unlinkSync(path.join(directory, names.at(-1)));
    fs.writeFileSync(path.join(directory, names.at(-2)), Buffer.alloc(2000, 0x47));
    assert.equal(inspectLocalHlsRing(directory).ready, true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('connection limiter never runs too many cameras simultaneously', async () => {
  const limiter = new CameraStartLimiter(2);
  let active = 0;
  let maximum = 0;
  const jobs = Array.from({ length: 5 }, (_, i) => limiter.run(async () => {
    maximum = Math.max(maximum, ++active);
    await new Promise((done) => setTimeout(done, 15));
    active -= 1;
    return i;
  }));
  assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4]);
  assert.equal(maximum, 2);
  assert.deepEqual(limiter.status(), { active: 0, queued: 0, limit: 2 });
});

test('updater is single-pass, graceful and local HLS is protected', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
  const updater = read('updater/src/server.js');
  const nginx = read('frontend/nginx.conf');
  const routes = read('backend/src/routes/streams.js');
  const auth = read('backend/src/routes/internal.js');
  const compose = read('docker-compose.yml');
  assert.doesNotMatch(updater, /execute\('docker', \['rm', '-f'/);
  assert.match(updater, /'--force-recreate'/);
  const install = updater.slice(updater.indexOf('async function performInstall(input)'));
  assert.doesNotMatch(install.split('async function performSystemRestart(input)')[0], /await regularApplicationRestart\(context, runningServices\)/);
  assert.match(compose, /stop_grace_period: 100s/);
  assert.match(nginx, /location \/live-hls\/ \{\s*auth_request \/internal\/local-hls-auth;/);
  assert.match(auth, /verifyMediaToken\(token, \{ path: `local-hls:/);
  assert.match(routes, /issueHlsToken/);
  assert.match(routes, /res\.cookie\('tmp_hls_media'/);
});
