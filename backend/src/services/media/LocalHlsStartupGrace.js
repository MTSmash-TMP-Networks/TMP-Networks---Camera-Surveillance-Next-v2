// Allow slow RTSP/GOP publishers extra startup time only while media advances.
export function shouldContinueHlsStartup({ elapsedMs = 0, baseTimeoutMs = 12000, maxTimeoutMs = baseTimeoutMs, progressUpdates = 0, lastProgressAgeMs = Infinity } = {}) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const base = Math.max(0, Number(baseTimeoutMs) || 0);
  if (elapsed < base) return true;
  const max = Math.max(base, Number(maxTimeoutMs) || base);
  return elapsed < max && Number(progressUpdates) > 0 && Number.isFinite(Number(lastProgressAgeMs)) && Number(lastProgressAgeMs) <= 15000;
}
