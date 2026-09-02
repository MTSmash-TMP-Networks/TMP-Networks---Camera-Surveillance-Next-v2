import test from 'node:test';
import assert from 'node:assert/strict';
import { PtzAutomationInterlock } from '../src/services/runtime/PtzAutomationInterlock.js';

function lease(interactionId, userId, clientId, sequence = 1) {
  return { interactionId, userId, clientId, sequence, action: 'move', ttlMs: 500 };
}

test('PTZ grants one exclusive camera lease and rejects a foreign controller', async () => {
  const interlock = new PtzAutomationInterlock({ disableSweep: true, settleMs: 20, tombstoneTtlMs: 1000 });
  try {
    const first = interlock.begin('cam-1', lease('interaction-a', 'user-a', 'tab-a'));
    assert.equal(first.newLease, true);
    const refresh = interlock.begin('cam-1', lease('interaction-a', 'user-a', 'tab-a', 2));
    assert.equal(refresh.newLease, false);
    assert.throws(
      () => interlock.begin('cam-1', lease('interaction-b', 'user-b', 'tab-b')),
      (error) => error.code === 'PTZ_BUSY' && error.status === 423,
    );
    assert.equal(interlock.status('cam-1').activeLeases, 1);
    interlock.end('cam-1', { ...lease('interaction-a', 'user-a', 'tab-a'), reason: 'stop' });
    assert.equal(interlock.status('cam-1').settling, true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(interlock.isBlocked('cam-1'), false);
  } finally { interlock.shutdown(); }
});

test('PTZ begins synchronously revoke an automatic recording permit', () => {
  const interlock = new PtzAutomationInterlock({ disableSweep: true, settleMs: 0 });
  try {
    const permit = interlock.acquireAutomaticPermit('cam-2', { eventId: 'event-1' });
    assert.equal(permit.assert('before-ptz'), true);
    interlock.begin('cam-2', lease('interaction-c', 'user-c', 'tab-c'));
    assert.throws(() => permit.assert('before-ffmpeg-spawn'), (error) => error.code === 'AUTOMATIC_RECORDING_SUPPRESSED_PTZ');
    permit.release();
  } finally { interlock.shutdown(); }
});

test('stale, foreign and already closed interaction messages cannot reopen PTZ', () => {
  const interlock = new PtzAutomationInterlock({ disableSweep: true, settleMs: 0 });
  try {
    interlock.begin('cam-3', lease('interaction-d', 'user-d', 'tab-d', 5));
    const stale = interlock.begin('cam-3', lease('interaction-d', 'user-d', 'tab-d', 4));
    assert.equal(stale.stale, true);
    assert.equal(interlock.status('cam-3').leases[0].sequence, 5);
    assert.throws(
      () => interlock.begin('cam-3', lease('interaction-d', 'other-user', 'other-tab', 6)),
      (error) => error.code === 'PTZ_INTERACTION_OWNER_MISMATCH',
    );
    interlock.end('cam-3', { ...lease('interaction-d', 'user-d', 'tab-d', 6), reason: 'stop' });
    assert.throws(
      () => interlock.begin('cam-3', lease('interaction-d', 'user-d', 'tab-d', 7)),
      (error) => error.code === 'PTZ_INTERACTION_CLOSED',
    );
  } finally { interlock.shutdown(); }
});

test('expired lease emits one recovery signal and enters settle state', async () => {
  const interlock = new PtzAutomationInterlock({ disableSweep: true, leaseTtlMs: 500, settleMs: 10 });
  let expired = 0;
  interlock.on('leasesExpired', () => { expired += 1; });
  try {
    interlock.begin('cam-4', { ...lease('interaction-e', 'user-e', 'tab-e'), ttlMs: 500 });
    interlock.sweep(Date.now() + 600);
    assert.equal(expired, 1);
    assert.equal(interlock.status('cam-4').active, false);
    interlock.sweep(Date.now() + 700);
    assert.equal(expired, 1);
  } finally { interlock.shutdown(); }
});


test('lease lookup never falls back to a different user or browser client', () => {
  const interlock = new PtzAutomationInterlock({ disableSweep: true, settleMs: 0 });
  try {
    interlock.begin('cam-5', lease('interaction-f', 'user-f', 'tab-f'));
    const replacement = interlock.begin('cam-5', lease('interaction-g', 'user-f', 'tab-f'));
    assert.deepEqual(replacement.supersededInteractions, ['interaction-f']);
    assert.equal(interlock.status('cam-5').activeLeases, 1);
    assert.equal(interlock.findLease('cam-5', { userId: 'user-f', clientId: 'tab-f' })?.interactionId, 'interaction-g');
    assert.equal(interlock.findLease('cam-5', { userId: 'user-f', clientId: 'tab-g' }), null);
    assert.equal(interlock.findLease('cam-5', { interactionId: 'interaction-g' })?.userId, 'user-f');
  } finally { interlock.shutdown(); }
});
