import fs from 'node:fs';
import path from 'node:path';

// A playlist containing stale TS data is not a healthy video publisher.
// Check the newest completed referenced segment first. The former full scan
// made every health/heartbeat request stat() every entry of every HLS ring.
export function inspectLocalHlsRing(directory, { now = Date.now(), maxAgeMs = 30_000, minBytes = 1880 } = {}) {
  try {
    const manifest = fs.readFileSync(path.join(directory, 'index.m3u8'), 'utf8');
    if (!manifest.startsWith('#EXTM3U')) return { ready: false, newestSegmentAt: null, ageMs: null, reason: 'invalid-playlist' };
    const names = [...manifest.matchAll(/^\s*(seg_[0-9]+\.ts)\s*$/gm)].map((match) => match[1]);
    let newestSegmentAt = 0;
    // Segment filenames are monotonically increasing. FFmpeg publishes the
    // playlist atomically; a just-rotated TS can briefly disappear.
    for (let i = names.length - 1; i >= 0; i -= 1) {
      try {
        const stat = fs.statSync(path.join(directory, names[i]));
        if (stat.isFile() && stat.size > minBytes) {
          newestSegmentAt = stat.mtimeMs;
          break;
        }
      } catch { /* FFmpeg may rotate a segment during inspection. */ }
    }
    if (!newestSegmentAt) return { ready: false, newestSegmentAt: null, ageMs: null, reason: 'missing-segments' };
    const ageMs = Math.max(0, now - newestSegmentAt);
    return { ready: ageMs <= maxAgeMs, newestSegmentAt, ageMs, reason: ageMs <= maxAgeMs ? 'fresh' : 'stale-segments' };
  } catch {
    return { ready: false, newestSegmentAt: null, ageMs: null, reason: 'missing-playlist' };
  }
}

// Preserve a running publisher across brief HLS playlist/segment rotation.
// This is never used to declare a stream ready for the FIRST time, and it
// cannot hide a dead FFmpeg process or an indefinitely stalled producer.
export function withLocalHlsContinuity(health, {
  now = Date.now(), lastReadyAt = 0, graceMs = 10_000,
  processAlive = false, wasReady = false,
} = {}) {
  if (health?.ready) return health;
  if (!wasReady || !processAlive || !Number.isFinite(lastReadyAt) || lastReadyAt <= 0
      || now - lastReadyAt > Math.max(0, Number(graceMs) || 0)) return health;
  if (!['invalid-playlist', 'missing-playlist', 'missing-segments', 'stale-segments'].includes(health?.reason)) return health;
  return { ...health, ready: true, grace: true, reason: 'temporary-ring-gap' };
}

// Old installations retain LOCAL_HLS_LIST_SIZE=30 in .env after in-app updates.
// A separately configurable minimum makes fleet-scale playback resilient
// without silently overwriting the administrator's existing .env file.
export function effectiveLocalHlsListSize(configured = 30, stableMinimum = 60) {
  const selected = Math.max(8, Math.min(120, Math.round(Number(configured) || 30)));
  const minimum = Math.max(0, Math.min(120, Math.round(Number(stableMinimum) || 0)));
  return Math.max(selected, minimum);
}
