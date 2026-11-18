import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CameraStartLimiter } from '../src/services/media/CameraStartLimiter.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const orchestrator = readFileSync(resolve(root, 'backend/src/services/media/StreamOrchestrator.js'), 'utf8');
const config = readFileSync(resolve(root, 'backend/src/config.js'), 'utf8');
const server = readFileSync(resolve(root, 'backend/src/server.js'), 'utf8');
const env = readFileSync(resolve(root, '.env.example'), 'utf8');

test('26-camera cold start has one short first attempt, then the existing full fallback', () => {
  assert.match(orchestrator, /const fastBootstrap = Boolean\(session\.permanent && session\.bootstrapFastPass\)/);
  assert.match(orchestrator, /session\.bootstrapFastPass = false;/);
  assert.match(orchestrator, /for \(const batch of \(fastBootstrap \? batches\.slice\(0, 1\) : batches\)\)/);
  assert.match(orchestrator, /const passes = fastBootstrap \? 1 :/);
  assert.match(orchestrator, /if \(!profiles\.length && !directStream && !fastBootstrap\)/);
  assert.match(orchestrator, /if \(fastBootstrap \|\| encoderIndex === encoders\.length - 1/);
  assert.match(orchestrator, /BOOTSTRAP_SLOW_FALLBACK_DEFERRED/);
  assert.match(orchestrator, /if \(fastBootstrap\) \{[\s\S]*?BOOTSTRAP_FALLBACK_DEFERRED/);
  assert.match(orchestrator, /this\.scheduleRestart\(session, deferred \? 1500 : null\)/);
  assert.match(orchestrator, /this\.startPermanentIngestForCamera\(camera\.id, \{ wait: true, reason: 'backend-startup', fastBootstrap: true \}\)/);
});

test('the first wave has a 20s maximum video wait, regular recovery still has 60s grace', () => {
  assert.match(config, /BACKGROUND_CAMERA_BOOTSTRAP_MAX_MEDIA_MS', 20000, \{ min: 12000, max: 60000 \}/);
  assert.match(config, /STREAM_ACTIVE_MEDIA_START_MAX_MS', 60000/);
  assert.match(env, /BACKGROUND_CAMERA_BOOTSTRAP_MAX_MEDIA_MS=20000/);
  assert.match(orchestrator, /maxActiveMediaMs: fastBootstrap[\s\S]*?config\.backgroundCameraBootstrapMaxMediaMs[\s\S]*?: Math\.max\(firstFrameTimeoutMs, config\.streamActiveMediaStartMaxMs\)/);
  assert.match(orchestrator, /this\.launch\(session, camera, sourceUri, candidate, profile, probe, policy, \{ fastBootstrap \}\)/);
  assert.match(server, /startPermanentIngestForAll\(\{ wait: false \}\)/);
});

test('background bootstrap still defers failed-camera recovery until all first starts settle', () => {
  assert.match(orchestrator, /this\.permanentBootstrapActive = true/);
  assert.match(orchestrator, /await Promise\.allSettled\(requests\)/);
  assert.match(orchestrator, /this\.permanentBootstrapActive = false/);
  assert.match(orchestrator, /this\.deferredPermanentRestartKeys\.clear\(\)/);
  assert.match(orchestrator, /AUTO_RESTART_DEFERRED_BOOTSTRAP/);
  assert.match(orchestrator, /CAMERA_START_TIMING/);
  assert.match(orchestrator, /queuedMs: Math\.max\(0, acquiredAt - queuedAt\)/);
});

test('26 cameras never use more than 4 simultaneous start slots, including full retries', async () => {
  const limiter = new CameraStartLimiter(4);
  let active = 0, peak = 0;
  const firstCompleted = new Set();
  const slow = new Set([0, 5, 9, 17, 21]);
  const run = (id, delay) => limiter.run(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, delay));
    active -= 1;
    return id;
  });
  const first = await Promise.all(Array.from({ length: 26 }, (_, id) =>
    run(id, slow.has(id) ? 12 : 2).then(result => { firstCompleted.add(result); return result; })
  ));
  assert.equal(first.length, 26);
  assert.equal(firstCompleted.size, 26);
  assert.equal(peak, 4);
  await Promise.all([...slow].map(id => run(id, 3)));
  assert.equal(peak, 4);
  assert.equal(limiter.status().active, 0);
  assert.equal(limiter.status().queued, 0);
});

test('a queued cold-start/recording task overtakes low-priority full recovery without starvation', async () => {
  const limiter = new CameraStartLimiter(1);
  let releaseFirst;
  const blocker = limiter.run(() => new Promise(resolve => { releaseFirst = resolve; }));
  // Yield to ensure the first slot is occupied.
  await new Promise(resolve => setImmediate(resolve));
  const order = [];
  const normalRecovery = limiter.run(async () => { order.push('recovery'); }, { priority: 0 });
  const foregroundRecording = limiter.run(async () => { order.push('recording'); }, { priority: 3 });
  const freshCamera = limiter.run(async () => { order.push('cold-preview'); }, { priority: 2 });
  assert.equal(limiter.status().queued, 3);
  releaseFirst();
  await Promise.all([blocker, normalRecovery, foregroundRecording, freshCamera]);
  assert.deepEqual(order, ['recording', 'cold-preview', 'recovery']);
  assert.equal(limiter.status().active, 0);
});

test('permanent preview skips the optional audio probe and deferred restart gets low priority', () => {
  assert.match(orchestrator, /if \(broker\.audioConfigured && !session\.permanent\)/);
  assert.match(orchestrator, /this\.cameraStarts\.run\(async \(\) => \{/);
  assert.match(orchestrator, /\}, \{ priority \}\)\)/);
  assert.match(orchestrator, /widthForQuality\(session\.quality\), \{ recovery: true \}/);
});
