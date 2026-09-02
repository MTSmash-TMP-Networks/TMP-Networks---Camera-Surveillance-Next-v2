const PERSISTENT_TRIGGER_TYPES = new Set(['manual', 'continuous', 'scheduled']);
const NON_RETRYABLE_CODES = new Set([
  'CAMERA_NOT_FOUND',
  'SNAPSHOT_MODE_NOT_RECORDABLE',
]);

export function isPersistentRecordingTrigger(triggerType) {
  return PERSISTENT_TRIGGER_TYPES.has(String(triggerType || '').trim().toLowerCase());
}

export function isPtzDeferredRecovery({ errorCode, automatic = false, hasProducedMedia = false } = {}) {
  return Boolean(
    automatic
    && !hasProducedMedia
    && String(errorCode || '') === 'AUTOMATIC_RECORDING_SUPPRESSED_PTZ'
  );
}

export function isRecoverableInitialRecordingFailure(error) {
  const code = String(error?.code || '');
  return code !== 'AUTOMATIC_RECORDING_SUPPRESSED_PTZ' && !NON_RETRYABLE_CODES.has(code);
}

export function recordingRecoveryDecision({
  triggerType,
  automatic = false,
  hasProducedMedia = false,
  errorCode = '',
  outageSeconds = 0,
  reconnectAttempts = 0,
  maxOutageSeconds = 180,
  maxReconnectAttempts = 30,
} = {}) {
  if (isPtzDeferredRecovery({ errorCode, automatic, hasProducedMedia })) {
    return { terminal: false, deferredByPtz: true, reason: 'ptz-interlock' };
  }

  if (NON_RETRYABLE_CODES.has(String(errorCode || ''))) {
    return { terminal: true, deferredByPtz: false, reason: 'non-retryable-error' };
  }

  if (isPersistentRecordingTrigger(triggerType)) {
    return { terminal: false, deferredByPtz: false, reason: 'persistent-recording' };
  }

  if (Number(outageSeconds || 0) >= Number(maxOutageSeconds || 0)) {
    return { terminal: true, deferredByPtz: false, reason: 'max-outage' };
  }
  if (Number(reconnectAttempts || 0) >= Number(maxReconnectAttempts || 0)) {
    return { terminal: true, deferredByPtz: false, reason: 'max-reconnect-attempts' };
  }
  return { terminal: false, deferredByPtz: false, reason: 'retryable' };
}

export function ptzDeferredRetryDelay(blockDetails, {
  now = Date.now(),
  fallbackMs = 1000,
  minimumMs = 500,
  maximumMs = 15_000,
} = {}) {
  const settleUntil = Date.parse(blockDetails?.settleUntil || '');
  const requested = Number.isFinite(settleUntil)
    ? settleUntil - Number(now) + 250
    : Number(fallbackMs || 1000);
  return Math.max(Number(minimumMs), Math.min(Number(maximumMs), requested));
}
