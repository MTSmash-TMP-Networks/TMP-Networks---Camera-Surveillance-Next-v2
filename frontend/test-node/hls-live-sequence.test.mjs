import test from 'node:test';
import assert from 'node:assert/strict';
import { createHlsLiveSequenceTracker } from '../src/services/hlsLiveSequencePolicy.js';

test('new live HLS segment numbers prove freshness, not repeated playlist fetches', () => {
  const t = createHlsLiveSequenceTracker({ staleAfterMs: 30000 });
  assert.equal(t.status(1000).tracked, false);
  assert.equal(t.observe({ live: true, endSN: 100 }, 1000).advanced, true);
  assert.equal(t.observe({ live: true, endSN: 100 }, 25000).advanced, false);
  assert.equal(t.status(30999).stale, false);
  assert.equal(t.status(31000).stale, true);
  assert.equal(t.observe({ live: true, endSN: 101 }, 32000).advanced, true);
  assert.equal(t.status(32000).stale, false);
});

test('repeated decoded video does not affect source freshness; VOD is exempt', () => {
  const t = createHlsLiveSequenceTracker({ staleAfterMs: 10000 });
  assert.equal(t.observe({ live: false, endSN: 8 }, 0).tracked, false);
  assert.equal(t.observe({ live: true, endSN: 40 }, 100).advanced, true);
  assert.equal(t.observe({ live: true, endSN: 40 }, 18000).stale, true);
  assert.equal(t.observe({}, 19000).advanced, false);
  assert.equal(t.status(19000).stale, true);
});

test('source generation reset cannot disguise stale playback as recovered', () => {
  const t = createHlsLiveSequenceTracker();
  t.observe({ live: true, endSN: 200 }, 1000);
  assert.equal(t.observe({ live: true, endSN: 150 }, 32000).advanced, false);
  assert.equal(t.status(32000).stale, true);
  assert.equal(t.observe({ live: true, endSN: 150 }, 32100).advanced, false);
  assert.equal(t.observe({ live: true, endSN: 151 }, 33000).advanced, true);
  assert.equal(t.status(33000).stale, false);
});

test('broken playlist values cannot reset the stillness timer', () => {
  const t = createHlsLiveSequenceTracker();
  t.observe({ live: true, endSN: 10 }, 0);
  for (const value of [undefined, NaN, Infinity, -1, '11', 1.25]) {
    assert.equal(t.observe({ live: true, endSN: value }, 35000).advanced, false);
  }
  assert.equal(t.status(35000).stale, true);
});
