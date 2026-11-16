import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Pick the newest complete local HLS segment for one low-resolution motion
 * comparison. Never open a second network reader when the permanent HLS ring
 * already has fresh, finalized MPEG-TS media. A missing/rotating file is a
 * normal HLS race: the caller may fall back to its prior RTSP/HLS path.
 */
export function selectFreshMotionSegment(playlistUri, {
  now = Date.now(),
  maxAgeMs = 8000,
  minBytes = 1880,
} = {}) {
  try {
    if (!playlistUri) return null;
    const uri = new URL(playlistUri);
    if (uri.protocol !== 'file:') return null;
    const playlist = fileURLToPath(uri);
    if (path.basename(playlist) !== 'index.m3u8') return null;
    const content = fs.readFileSync(playlist, 'utf8');
    if (!content.startsWith('#EXTM3U')) return null;
    const names = [...content.matchAll(/^\s*(seg_[0-9]+\.ts)\s*$/gm)].map((entry) => entry[1]);
    const dir = path.dirname(playlist);
    for (let i = names.length - 1; i >= 0; i--) {
      const segment = path.join(dir, names[i]);
      let stat;
      try { stat = fs.statSync(segment); }
      catch (error) {
        if (error?.code === 'ENOENT') continue; // HLS ring rotation
        throw error;
      }
      const ageMs = Math.max(0, now - stat.mtimeMs);
      if (!stat.isFile() || stat.size < minBytes || ageMs > maxAgeMs) continue;
      return { uri: pathToFileURL(segment).href, name: names[i], ageMs };
    }
  } catch { /* invalid playlist or transient media rotation => use legacy reader */ }
  return null;
}
