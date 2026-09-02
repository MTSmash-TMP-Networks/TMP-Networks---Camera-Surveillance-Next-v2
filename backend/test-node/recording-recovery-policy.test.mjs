import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRecoverableInitialRecordingFailure,
  ptzDeferredRetryDelay,
  recordingRecoveryDecision,
} from '../src/services/recording/RecordingRecoveryPolicy.js';

test('initial FFmpeg media failures remain recoverable instead of releasing the recording session', () => {
  assert.equal(isRecoverableInitialRecordingFailure(new Error('FFmpeg hat keine Mediendaten geschrieben')), true);
  assert.equal(isRecoverableInitialRecordingFailure({ code: 'CAMERA_NOT_FOUND' }), false);
  assert.equal(isRecoverableInitialRecordingFailure({ code: 'AUTOMATIC_RECORDING_SUPPRESSED_PTZ' }), false);
});

test('manual, continuous and scheduled recordings retry beyond normal outage limits', () => {
  for (const triggerType of ['manual', 'continuous', 'scheduled']) {
    const decision = recordingRecoveryDecision({
      triggerType,
      outageSeconds: 3600,
      reconnectAttempts: 500,
      maxOutageSeconds: 180,
      maxReconnectAttempts: 30,
    });
    assert.equal(decision.terminal, false);
    assert.equal(decision.reason, 'persistent-recording');
  }
});

test('event recordings still obey bounded recovery limits', () => {
  const decision = recordingRecoveryDecision({
    triggerType: 'event',
    outageSeconds: 181,
    reconnectAttempts: 5,
    maxOutageSeconds: 180,
    maxReconnectAttempts: 30,
  });
  assert.equal(decision.terminal, true);
  assert.equal(decision.reason, 'max-outage');
});

test('an automatic recording with no media waits for PTZ instead of consuming retry limits', () => {
  const decision = recordingRecoveryDecision({
    triggerType: 'continuous',
    automatic: true,
    hasProducedMedia: false,
    errorCode: 'AUTOMATIC_RECORDING_SUPPRESSED_PTZ',
    outageSeconds: 900,
    reconnectAttempts: 30,
    maxOutageSeconds: 180,
    maxReconnectAttempts: 30,
  });
  assert.equal(decision.terminal, false);
  assert.equal(decision.deferredByPtz, true);
  assert.equal(decision.reason, 'ptz-interlock');
});

test('PTZ retry delay follows settle time and stays bounded', () => {
  const now = Date.parse('2026-07-25T00:00:00.000Z');
  assert.equal(ptzDeferredRetryDelay({ settleUntil: '2026-07-25T00:00:02.000Z' }, { now }), 2250);
  assert.equal(ptzDeferredRetryDelay(null, { now, fallbackMs: 100 }), 500);
  assert.equal(ptzDeferredRetryDelay({ settleUntil: '2026-07-25T00:01:00.000Z' }, { now }), 15000);
});
