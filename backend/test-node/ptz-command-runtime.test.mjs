import test from 'node:test';
import assert from 'node:assert/strict';
import { PtzCommandRuntime } from '../src/services/ptz/PtzCommandRuntime.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

test('continuous moves use latest-wins coalescing instead of an unbounded queue', async () => {
  const runtime = new PtzCommandRuntime();
  const first = deferred();
  const executed = [];
  try {
    runtime.submitMove('cam-a', { interactionId: 'i', sequence: 1 }, async () => { executed.push(1); await first.promise; });
    runtime.submitMove('cam-a', { interactionId: 'i', sequence: 2 }, async () => { executed.push(2); });
    runtime.submitMove('cam-a', { interactionId: 'i', sequence: 3 }, async () => { executed.push(3); });
    assert.equal(runtime.status('cam-a')[0].pendingMove.sequence, 3);
    first.resolve();
    await settle();
    assert.deepEqual(executed, [1, 3]);
    assert.equal(runtime.status('cam-a')[0].coalescedMoves, 1);
  } finally { runtime.shutdown(); }
});

test('stop is immediate and a stale completion is followed by one corrective stop', async () => {
  const runtime = new PtzCommandRuntime();
  const first = deferred();
  let stopCalls = 0;
  try {
    runtime.submitMove('cam-b', { interactionId: 'old', sequence: 1 }, () => first.promise, { isInteractionActive: () => false });
    await runtime.stop('cam-b', async () => { stopCalls += 1; }, { interactionId: 'old' });
    assert.equal(stopCalls, 1);
    first.resolve();
    await settle();
    assert.equal(stopCalls, 2);
    assert.equal(runtime.status('cam-b')[0].correctiveStops, 1);
  } finally { runtime.shutdown(); }
});

test('a newer pending move supersedes a stale move without being stopped afterward', async () => {
  const runtime = new PtzCommandRuntime();
  const first = deferred();
  const executed = [];
  let stopCalls = 0;
  try {
    runtime.submitMove('cam-c', { interactionId: 'old', sequence: 1 }, async () => { executed.push('old'); await first.promise; }, { isInteractionActive: () => false });
    await runtime.stop('cam-c', async () => { stopCalls += 1; }, { interactionId: 'old' });
    runtime.submitMove('cam-c', { interactionId: 'new', sequence: 1 }, async () => { executed.push('new'); }, { isInteractionActive: () => true });
    first.resolve();
    await settle();
    assert.deepEqual(executed, ['old', 'new']);
    assert.equal(stopCalls, 1);
  } finally { runtime.shutdown(); }
});


test('a move accepted during a physical stop waits until the stop has completed', async () => {
  const runtime = new PtzCommandRuntime();
  const stopGate = deferred();
  const executed = [];
  try {
    const stopping = runtime.stop('cam-d', async () => { executed.push('stop-start'); await stopGate.promise; executed.push('stop-end'); });
    await Promise.resolve();
    const accepted = runtime.submitMove('cam-d', { interactionId: 'new', sequence: 1 }, async () => { executed.push('move'); });
    assert.equal(accepted.queued, true);
    assert.deepEqual(executed, ['stop-start']);
    stopGate.resolve();
    await stopping;
    await settle();
    assert.deepEqual(executed, ['stop-start', 'stop-end', 'move']);
  } finally { runtime.shutdown(); }
});

test('ending an interaction removes its pending coalesced move', async () => {
  const runtime = new PtzCommandRuntime();
  const first = deferred();
  const executed = [];
  try {
    runtime.submitMove('cam-e', { interactionId: 'other', sequence: 1 }, async () => { executed.push('other'); await first.promise; });
    runtime.submitMove('cam-e', { interactionId: 'ending', sequence: 1 }, async () => { executed.push('ending'); });
    assert.equal(runtime.cancelInteraction('cam-e', 'ending').cancelled, true);
    first.resolve();
    await settle();
    assert.deepEqual(executed, ['other']);
    assert.equal(runtime.status('cam-e')[0].cancelledMoves, 1);
  } finally { runtime.shutdown(); }
});
