import { once } from 'node:events';

/**
 * Feeds a continuously running FFmpeg image2pipe input. A newly fetched JPEG
 * replaces the current frame, while the last valid image is repeated at a
 * small fixed frame rate. This avoids browser-side image swaps and therefore
 * removes the visible flash between snapshot requests.
 */
export function startSnapshotFramePump({
  child,
  initialBuffer,
  capture,
  fps = 5,
  refreshMs = 1000,
  maxFrameAgeMs = 15_000,
  onFrame = null,
  onFetchError = null,
}) {
  let stopped = false;
  let latest = initialBuffer;
  let lastFetchedAt = Date.now();
  let fetching = false;
  let writing = false;
  let consecutiveFetchErrors = 0;
  const frameIntervalMs = Math.max(80, Math.round(1000 / Math.max(1, Number(fps) || 5)));

  async function fetchNext() {
    if (stopped || fetching) return;
    fetching = true;
    try {
      const result = await capture();
      if (result?.buffer?.length) {
        latest = result.buffer;
        lastFetchedAt = Date.now();
        consecutiveFetchErrors = 0;
        onFrame?.({ bytes: latest.length, contentType: result.contentType || 'image/jpeg' });
      }
    } catch (error) {
      consecutiveFetchErrors += 1;
      onFetchError?.(error, consecutiveFetchErrors);
    } finally {
      fetching = false;
    }
  }

  async function writeFrame() {
    if (stopped || writing || !latest?.length || child.stdin.destroyed || !child.stdin.writable) return;
    // Re-encoding a single old JPEG indefinitely creates apparently fresh
    // HLS segments that replay a frozen camera. Let the ring become stale so
    // its normal watchdog detects the failed snapshot source and recovers it.
    if (Date.now() - lastFetchedAt > maxFrameAgeMs) return;
    writing = true;
    try {
      if (!child.stdin.write(latest)) await once(child.stdin, 'drain');
    } catch (error) {
      if (!stopped) onFetchError?.(error, consecutiveFetchErrors);
    } finally {
      writing = false;
    }
  }

  // Start FFmpeg immediately with the verified first frame.
  writeFrame();
  const frameTimer = setInterval(() => { writeFrame(); }, frameIntervalMs);
  const refreshTimer = setInterval(() => { fetchNext(); }, Math.max(400, Number(refreshMs) || 1000));
  frameTimer.unref?.();
  refreshTimer.unref?.();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(frameTimer);
      clearInterval(refreshTimer);
      if (!child.stdin.destroyed) child.stdin.end();
    },
    get status() {
      return { stopped, bytes: latest?.length || 0, consecutiveFetchErrors, lastFrameAgeMs: Date.now() - lastFetchedAt, fps: Math.round(1000 / frameIntervalMs) };
    },
  };
}
