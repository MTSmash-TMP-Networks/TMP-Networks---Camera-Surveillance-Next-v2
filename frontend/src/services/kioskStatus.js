const MOTION_VISIBLE_HOLD_MS = 15_000;

function timestampMs(value) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestTimestamp(...values) {
  return values.reduce((latest, value) => Math.max(latest, timestampMs(value)), 0);
}

function normalizedTriggerType(recording) {
  return String(recording?.triggerType || recording?.trigger_type || 'manual').trim().toLowerCase();
}

function recordingLabel(recording) {
  const trigger = normalizedTriggerType(recording);
  if (trigger === 'continuous') return 'Daueraufnahme';
  if (trigger === 'scheduled') return 'Planaufnahme';
  if (trigger === 'event') return 'Ereignisaufnahme';
  if (trigger === 'manual') return 'Manuelle Aufnahme';
  return 'Aufnahme läuft';
}

function formatShortTime(timestamp) {
  if (!timestamp) return '';
  try {
    return new Date(timestamp).toLocaleTimeString(globalThis.document?.documentElement?.lang || 'en', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

export function buildKioskCameraStatus(payload = {}, now = Date.now()) {
  const motionStatus = payload.motion || payload.motionStatus || {};
  const motionByCamera = new Map((motionStatus.cameras || []).map((entry) => [entry.cameraId, entry]));
  const activeRecordings = payload.activeRecordings || payload.active || [];
  const activeByCamera = new Map();

  for (const recording of activeRecordings) {
    if (!recording?.cameraId) continue;
    const current = activeByCamera.get(recording.cameraId);
    const currentStarted = timestampMs(current?.startedAt);
    const nextStarted = timestampMs(recording.startedAt);
    if (!current || nextStarted >= currentStarted) activeByCamera.set(recording.cameraId, recording);
  }

  const result = {};
  const cameraIds = new Set([...motionByCamera.keys(), ...activeByCamera.keys(), ...(payload.cameras || []).map((camera) => camera.id).filter(Boolean)]);
  for (const cameraId of cameraIds) {
    const motion = motionByCamera.get(cameraId) || null;
    const activeRecording = activeByCamera.get(cameraId) || null;
    const lastMotionMs = latestTimestamp(motion?.lastDetectedAt, motion?.lastEventAt, motion?.lastMotionAt);
    const motionRecentlyDetected = Boolean(lastMotionMs && now - lastMotionMs <= MOTION_VISIBLE_HOLD_MS);
    const motionActive = Boolean(motion?.motionActive || motionRecentlyDetected);
    const triggerType = normalizedTriggerType(activeRecording);
    const continuousRecording = Boolean(activeRecording && triggerType === 'continuous');

    result[cameraId] = {
      motion,
      activeRecording,
      motionActive,
      motionRecentlyDetected,
      motionLastAt: lastMotionMs ? new Date(lastMotionMs).toISOString() : null,
      motionLabel: motionActive ? 'Bewegung erkannt' : 'Keine Bewegung',
      motionTimeLabel: formatShortTime(lastMotionMs),
      recordingActive: Boolean(activeRecording),
      continuousRecording,
      recordingLabel: activeRecording ? recordingLabel(activeRecording) : 'Keine Aufnahme',
      recordingTimeLabel: formatShortTime(activeRecording?.startedAt),
      recovering: Boolean(activeRecording?.recovering),
      triggerType,
    };
  }
  return result;
}

export function summarizeKioskStatus(statusByCamera = {}) {
  const entries = Object.values(statusByCamera);
  return {
    motionCount: entries.filter((entry) => entry.motionActive).length,
    recordingCount: entries.filter((entry) => entry.recordingActive).length,
    continuousRecordingCount: entries.filter((entry) => entry.continuousRecording).length,
  };
}

export { MOTION_VISIBLE_HOLD_MS };
