import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraStartLimiter } from '../src/services/media/CameraStartLimiter.js';
import { availableMemoryBytes, chooseCameraStartLimit, AdaptiveCameraStartCapacity } from '../src/services/media/AdaptiveCameraStartCapacity.js';

test('adaptively uses spare cores and memory without exceeding physical capacity', () => {
  const MiB = 2 ** 20;
  assert.equal(chooseCameraStartLimit({ baseline: 4, max: 8, current: 4, cores: 4, loadRatio: 0.3, availableMemory: 850 * MiB, waiting: 20 }), 5);
  assert.equal(chooseCameraStartLimit({ baseline: 4, max: 8, current: 5, cores: 4, loadRatio: 0.3, availableMemory: 850 * MiB, waiting: 20 }), 6);
  assert.equal(chooseCameraStartLimit({ baseline: 4, max: 8, current: 6, cores: 4, loadRatio: 0.3, availableMemory: 850 * MiB, waiting: 20 }), 6);
  assert.equal(chooseCameraStartLimit({ baseline: 4, max: 8, current: 6, cores: 4, loadRatio: 0.95, availableMemory: 850 * MiB, waiting: 20 }), 4);
  assert.equal(chooseCameraStartLimit({ baseline: 4, max: 8, current: 6, cores: 4, loadRatio: 0.2, availableMemory: 200 * MiB, waiting: 20 }), 4);
  assert.equal(chooseCameraStartLimit({ baseline: 4, max: 8, current: 4, cores: 4, loadRatio: null, availableMemory: null, waiting: 20 }), 4);
});

test('available memory respects smaller Docker cgroup headroom over host resources', () => {
  const MiB = 2 ** 20;
  assert.equal(availableMemoryBytes({ freeHostBytes: 8000 * MiB, cgroupMax: 1536 * MiB, cgroupUsed: 1300 * MiB }), 236 * MiB);
  assert.equal(availableMemoryBytes({ freeHostBytes: 8000 * MiB, cgroupMax: null, cgroupUsed: null }), 8000 * MiB);
});

test('limit grows with waiting jobs without exceeding capacity and can shrink safely', async () => {
  const limiter = new CameraStartLimiter(1);
  let unblock;
  const first = limiter.run(() => new Promise((resolve) => { unblock = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  const order = [];
  const next = [0, 1, 2].map((id) => limiter.run(async () => { order.push(id); }));
  assert.equal(limiter.status().queued, 3);
  const adaptive = new AdaptiveCameraStartCapacity({
    limiter, baseline: 1, max: 3, cores: () => 4, loadAverage: () => 0.2,
    freeHostBytes: () => 2 ** 30, cgroupMax: () => 1.5 * 2 ** 30, cgroupUsed: () => 0.2 * 2 ** 30,
  });
  assert.equal(adaptive.sample(), 2);
  limiter.setLimit(1);
  assert.equal(limiter.status().limit, 1);
  unblock();
  await Promise.all([first, ...next]);
  assert.deepEqual([...order].sort(), [0, 1, 2]);
  assert.equal(limiter.status().active, 0);
});

test('adaptive observer keeps a stable 3-field status for legacy clients', () => {
  const limiter = new CameraStartLimiter(4);
  assert.deepEqual(limiter.status(), { active: 0, queued: 0, limit: 4 });
});
