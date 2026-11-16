import fs from 'node:fs';
import path from 'node:path';

// A playlist containing stale TS data is not a healthy video publisher.
export function inspectLocalHlsRing(directory, { now = Date.now(), maxAgeMs = 30_000, minBytes = 1880 } = {}) {
  try {
    const manifest = fs.readFileSync(path.join(directory, 'index.m3u8'), 'utf8');
    if (!manifest.startsWith('#EXTM3U')) return { ready: false, newestSegmentAt: null, ageMs: null, reason: 'invalid-playlist' };
    const names = [...manifest.matchAll(/^\s*(seg_[0-9]+\.ts)\s*$/gm)].map((match) => match[1]);
    let newestSegmentAt = 0;
    for (const name of names) {
      try {
        const stat = fs.statSync(path.join(directory, name));
        if (stat.isFile() && stat.size > minBytes) newestSegmentAt = Math.max(newestSegmentAt, stat.mtimeMs);
      } catch { /* FFmpeg may rotate a segment during inspection. */ }
    }
    if (!newestSegmentAt) return { ready: false, newestSegmentAt: null, ageMs: null, reason: 'missing-segments' };
    const ageMs = Math.max(0, now - newestSegmentAt);
    return { ready: ageMs <= maxAgeMs, newestSegmentAt, ageMs, reason: ageMs <= maxAgeMs ? 'fresh' : 'stale-segments' };
  } catch {
    return { ready: false, newestSegmentAt: null, ageMs: null, reason: 'missing-playlist' };
  }
}
