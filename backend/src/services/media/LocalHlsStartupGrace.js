// Allow slow RTSP/GOP publishers extra startup time only while media advances.
export function shouldContinueHlsStartup({ elapsedMs = 0, baseTimeoutMs = 12000, maxTimeoutMs = baseTimeoutMs, progressUpdates = 0, lastProgressAgeMs = Infinity, upstreamReady = false, upstreamGraceMs = 0 } = {}) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const base = Math.max(0, Number(baseTimeoutMs) || 0);
  if (elapsed < base) return true;
  const max = Math.max(base, Number(maxTimeoutMs) || base);
  if (elapsed >= max) return false;
  const movingFrames = Number(progressUpdates) > 0 && Number.isFinite(Number(lastProgressAgeMs)) && Number(lastProgressAgeMs) <= 15000;
  // A go2rtc producer may begin delivering video after the initial 12s
  // deadline; allow at most one bounded warm-up window, never an unlimited
  // retry or a false ready state. The actual HLS segment is still mandatory.
  const warmingUp = upstreamReady && elapsed < Math.min(max, base + Math.max(0, Number(upstreamGraceMs) || 0));
  return movingFrames || warmingUp;
}
