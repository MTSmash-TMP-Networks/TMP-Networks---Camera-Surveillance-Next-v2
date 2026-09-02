import { describe, expect, it } from 'vitest';
import { buildKioskCameraStatus, summarizeKioskStatus } from './kioskStatus.js';

describe('kioskStatus', () => {
  it('keeps recently detected motion visible and marks continuous recordings', () => {
    const now = Date.parse('2026-07-24T12:00:10.000Z');
    const status = buildKioskCameraStatus({
      motion: { cameras: [{ cameraId: 'cam-1', motionActive: false, lastDetectedAt: '2026-07-24T12:00:03.000Z' }] },
      activeRecordings: [{ id: 7, cameraId: 'cam-1', triggerType: 'continuous', startedAt: '2026-07-24T11:59:00.000Z' }],
    }, now);

    expect(status['cam-1'].motionActive).toBe(true);
    expect(status['cam-1'].motionRecentlyDetected).toBe(true);
    expect(status['cam-1'].recordingActive).toBe(true);
    expect(status['cam-1'].continuousRecording).toBe(true);
    expect(status['cam-1'].recordingLabel).toBe('Daueraufnahme');
    expect(summarizeKioskStatus(status)).toEqual({ motionCount: 1, recordingCount: 1, continuousRecordingCount: 1 });
  });

  it('chooses the newest active recording per camera and expires stale motion badges', () => {
    const now = Date.parse('2026-07-24T12:01:00.000Z');
    const status = buildKioskCameraStatus({
      motion: { cameras: [{ cameraId: 'cam-2', motionActive: false, lastDetectedAt: '2026-07-24T12:00:20.000Z' }] },
      activeRecordings: [
        { id: 1, cameraId: 'cam-2', triggerType: 'event', startedAt: '2026-07-24T11:50:00.000Z' },
        { id: 2, cameraId: 'cam-2', triggerType: 'scheduled', startedAt: '2026-07-24T11:55:00.000Z' },
      ],
    }, now);

    expect(status['cam-2'].motionActive).toBe(false);
    expect(status['cam-2'].activeRecording.id).toBe(2);
    expect(status['cam-2'].recordingLabel).toBe('Planaufnahme');
  });
});
