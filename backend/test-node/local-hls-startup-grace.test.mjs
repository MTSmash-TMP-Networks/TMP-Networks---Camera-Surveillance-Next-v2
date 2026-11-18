import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldContinueHlsStartup } from '../src/services/media/LocalHlsStartupGrace.js';

test('offline camera times out at the configured first-frame limit', () => {
  assert.equal(shouldContinueHlsStartup({ elapsedMs: 11999, baseTimeoutMs: 12000, maxTimeoutMs: 60000 }), true);
  assert.equal(shouldContinueHlsStartup({ elapsedMs: 12000, baseTimeoutMs: 12000, maxTimeoutMs: 60000 }), false);
});
test('active WiFi GOP segments receive bounded additional startup time', () => {
  assert.equal(shouldContinueHlsStartup({ elapsedMs: 27000, baseTimeoutMs: 12000, maxTimeoutMs: 60000, progressUpdates: 12, lastProgressAgeMs: 250 }), true);
});
test('stale media progress and hard maximum never keep a zombie session alive', () => {
  assert.equal(shouldContinueHlsStartup({ elapsedMs: 28000, baseTimeoutMs: 12000, maxTimeoutMs: 60000, progressUpdates: 1, lastProgressAgeMs: 16000 }), false);
  assert.equal(shouldContinueHlsStartup({ elapsedMs: 60000, baseTimeoutMs: 12000, maxTimeoutMs: 60000, progressUpdates: 999, lastProgressAgeMs: 0 }), false);
});

test('a live upstream gets one bounded grace period but cannot become ready without a segment', () => {
  assert.equal(shouldContinueHlsStartup({ elapsedMs: 12500, baseTimeoutMs: 12000, maxTimeoutMs: 20000, upstreamReady: true, upstreamGraceMs: 8000 }), true);
  assert.equal(shouldContinueHlsStartup({ elapsedMs: 19999, baseTimeoutMs: 12000, maxTimeoutMs: 20000, upstreamReady: true, upstreamGraceMs: 8000 }), true);
  assert.equal(shouldContinueHlsStartup({ elapsedMs: 20000, baseTimeoutMs: 12000, maxTimeoutMs: 20000, upstreamReady: true, upstreamGraceMs: 8000 }), false);
  assert.equal(shouldContinueHlsStartup({ elapsedMs: 12500, baseTimeoutMs: 12000, maxTimeoutMs: 20000, upstreamReady: false, upstreamGraceMs: 8000 }), false);
});
test('stale FFmpeg progress does not prolong an inactive broker', () => {
  assert.equal(shouldContinueHlsStartup({ elapsedMs: 14000, baseTimeoutMs: 12000, maxTimeoutMs: 20000, progressUpdates: 1, lastProgressAgeMs: 16000 }), false);
});
