// A browser can continue decoding cached HLS frames while its live playlist
// is frozen. Playback time and decoded-frame counters are NOT proof of fresh
// camera media; only a newly published live segment number is.
export const DEFAULT_HLS_SOURCE_STALE_MS = 30_000;

export function createHlsLiveSequenceTracker({ staleAfterMs = DEFAULT_HLS_SOURCE_STALE_MS } = {}) {
  const limit = Math.max(10_000, Number(staleAfterMs) || DEFAULT_HLS_SOURCE_STALE_MS);
  let lastSequence = null;
  let lastAdvanceAt = 0;
  let rollbackSeen = false;

  function status(now = Date.now()) {
    const tracked = lastSequence !== null;
    const ageMs = tracked ? Math.max(0, now - lastAdvanceAt) : 0;
    return { tracked, stale: tracked && ageMs >= limit, ageMs, lastSequence };
  }

  function observe(details, now = Date.now()) {
    // hls.js LEVEL_UPDATED: only live playlists with a numeric endSN qualify.
    if (details?.live === false || !Number.isSafeInteger(details?.endSN) || details.endSN < 0) {
      return { advanced: false, ...status(now) };
    }
    const sequence = details.endSN;
    if (lastSequence === null) {
      lastSequence = sequence;
      lastAdvanceAt = now;
      return { advanced: true, first: true, ...status(now) };
    }
    if (sequence < lastSequence) {
      // After an FFmpeg restart, the numbering may begin lower. Do not
      // consider that first backwards jump a proof of fresh media: wait for
      // a subsequent segment from the new generation.
      lastSequence = sequence;
      rollbackSeen = true;
      return { advanced: false, rollback: true, ...status(now) };
    }
    if (sequence > lastSequence) {
      lastSequence = sequence;
      lastAdvanceAt = now;
      rollbackSeen = false;
      return { advanced: true, first: false, ...status(now) };
    }
    return { advanced: false, rollback: rollbackSeen, ...status(now) };
  }

  return { observe, status };
}
