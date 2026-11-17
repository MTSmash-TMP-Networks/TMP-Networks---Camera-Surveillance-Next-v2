// Pure scheduling policy for returning from CPU-based emergency snapshot HLS
// to the original native camera source. No camera/network access here.
export function shouldReprobeSnapshotNative(session, now = Date.now(), { closed = false } = {}) {
  return !closed && Boolean(session?.permanent)
    && session?.state === 'ready' && session?.mode === 'snapshot-video'
    && Number(session?.recordingRefs || 0) === 0
    && !session?.recoveryPromise && !session?.restartTimer
    && Number(session?.snapshotNativeRecheckAt || 0) <= now;
}

export function nextSnapshotNativeRecheckAt(cameraId, now = Date.now(), seconds = 90) {
  const id = String(cameraId || '');
  let sum = 0;
  for (const codepoint of id) sum = (sum * 31 + codepoint.codePointAt(0)) % 1543;
  // Stagger cameras which lost the same common go2rtc process. Avoid
  // synchronized RTSP probes and video encoder reconnection bursts.
  return now + Math.max(30, Number(seconds) || 90) * 1000 + (sum % 30) * 1000;
}
