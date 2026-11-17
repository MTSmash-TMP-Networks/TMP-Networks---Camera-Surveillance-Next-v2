// Pure browser HLS-recovery decisions; never create network readers here.
export function bufferedHlsSeconds(video) {
  try {
    const current = Number(video?.currentTime || 0);
    const ranges = video?.buffered;
    for (let i = 0; i < (ranges?.length || 0); i += 1) {
      if (ranges.start(i) <= current + 0.15 && ranges.end(i) >= current) {
        return Math.max(0, ranges.end(i) - current);
      }
    }
  } catch { /* MediaSource may rotate buffered ranges. */ }
  return 0;
}

export function shouldAnnounceHlsRecovery({
  elapsedMs = 0, frameAgeMs = Infinity, bufferSeconds = 0,
  active = true, visible = true, paused = false, graceMs = 6500,
} = {}) {
  if (!active || !visible || paused || elapsedMs < graceMs) return false;
  if (frameAgeMs < 6000) return false;
  // A playable Kiosk buffer should not display a repair status for a
  // transient fragment retry. A genuine freeze is reported after 15 sec.
  return bufferSeconds < 1.5 || frameAgeMs >= 15000;
}

export function shouldEscalateHlsRecovery({
  frameAgeMs = Infinity, active = true, visible = true, paused = false,
} = {}) {
  // Hidden viewers or streams still showing fresh video must not be torn down
  // just because a WLAN HTTP retry crossed an outer timer threshold.
  return Boolean(active && visible && !paused && frameAgeMs >= 12000);
}
