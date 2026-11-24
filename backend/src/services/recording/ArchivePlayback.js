import crypto from 'node:crypto';
import { AppError } from '../../utils/errors.js';
import { buildVodPlaylist } from './BlockArchive.js';

const MAX_BLOCKS = 10000;
const MAX_SESSIONS = 128;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN;

/**
 * A VOD snapshot concatenates finalized, available TS blocks in chronological
 * order. The wall-clock timeline is distinct from the concatenated media
 * timeline: gaps remain visible and midnight/overlapping blocks are clipped
 * in the mapping, not by altering the source files.
 */
export function buildArchivePlayback(blocks, { scope = 'recording', timezone, startIso, endIso, fallbackStart, uriForBlock } = {}) {
  let cursor = validTime(fallbackStart);
  const normalized = [];
  for (const block of blocks) {
    if (!['ready', 'recovered'].includes(block.status) || !(Number(block.sizeBytes) > 0)) continue;
    let start = validTime(block.startedAt);
    let end = validTime(block.endedAt);
    const storedDuration = Number(block.durationSeconds);
    if (!Number.isFinite(start)) start = cursor;
    if (!Number.isFinite(start) && Number.isFinite(end) && storedDuration > 0) start = end - storedDuration * 1000;
    if (!Number.isFinite(start)) continue;
    if (!(end > start)) end = start + Math.max(1, Number.isFinite(storedDuration) ? storedDuration * 1000 : 1);
    cursor = end;
    const duration = Math.max(0.001, Math.round((Number.isFinite(storedDuration) && storedDuration > 0 ? storedDuration : (end - start) / 1000) * 1000) / 1000);
    normalized.push({ ...block, start, end, duration_seconds: duration, size_bytes: Number(block.sizeBytes) });
  }
  normalized.sort((a,b) => a.start - b.start || a.end - b.end || Number(a.recordingId) - Number(b.recordingId) || Number(a.segmentIndex) - Number(b.segmentIndex));
  if (!normalized.length) throw new AppError(404, 'EXPORT_NO_RECORDINGS', 'Keine abspielbaren Aufnahmebloecke vorhanden.');
  if (normalized.length > MAX_BLOCKS) throw new AppError(422, 'EXPORT_RANGE_TOO_LARGE', 'Zu viele Aufnahmebloecke im Zeitraum.');
  const start = Number.isFinite(validTime(startIso)) ? validTime(startIso) : normalized[0].start;
  const end = Number.isFinite(validTime(endIso)) ? validTime(endIso) : Math.max(...normalized.map(b => b.end));
  let coveredUntil = start;
  let mediaCursor = 0;
  const spans = [];
  const playlistBlocks = [];
  for (const block of normalized) {
    const from = Math.max(start, coveredUntil, block.start);
    const to = Math.min(end, block.end);
    if (to <= from) continue;
    const duration = block.duration_seconds;
    const fraction = (ms) => (ms - block.start) / (block.end - block.start);
    spans.push({
      recordingId: block.recordingId, segmentIndex: block.segmentIndex,
      startIso: new Date(from).toISOString(), endIso: new Date(to).toISOString(),
      mediaStartSeconds: mediaCursor + fraction(from) * duration,
      mediaEndSeconds: mediaCursor + fraction(to) * duration,
    });
    playlistBlocks.push(block);
    coveredUntil = to;
    mediaCursor += duration;
  }
  if (!spans.length) throw new AppError(404, 'EXPORT_NO_RECORDINGS', 'Keine abspielbaren Aufnahmebloecke im Zeitraum.');
  const playlist = buildVodPlaylist(playlistBlocks, uriForBlock, { timestampResetPerSegment: true });
  return { playlist, timeline: { scope, timezone, startIso: new Date(start).toISOString(),
    endIso: new Date(end).toISOString(), mediaDurationSeconds: mediaCursor, spans } };
}

/** Small, bounded in-memory VOD manifest snapshots, never staged video files.
 * Each snapshot is owner-bound and expires at the media token deadline.
 */
export class ArchivePlaybackSessions {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.sessions = new Map();
  }
  cleanup() {
    for (const [id, item] of this.sessions) if (item.expiresAt <= this.now()) this.sessions.delete(id);
  }
  create({ playlist, user, scope, expiresIn }) {
    this.cleanup();
    const bytes = Buffer.byteLength(playlist);
    const used = [...this.sessions.values()].reduce((sum, item) => sum + item.bytes, 0);
    if (this.sessions.size >= MAX_SESSIONS || used + bytes > MAX_MANIFEST_BYTES) {
      throw new AppError(429, 'EXPORT_STREAM_BUSY', 'Zu viele geoeffnete Aufnahmeplayer. Bitte einen Player schliessen.');
    }
    const id = crypto.randomUUID();
    this.sessions.set(id, { playlist, bytes, scope, userId: user.sub, version: user.ver, expiresAt: this.now() + expiresIn * 1000 });
    return id;
  }
  get(id, userId) {
    this.cleanup();
    const item = this.sessions.get(id);
    if (!item || String(item.userId) !== String(userId)) throw new AppError(404, 'EXPORT_TICKET_EXPIRED', 'Aufnahmeplayer-Freigabe abgelaufen.');
    return item;
  }
  release(id, userId) {
    const item = this.sessions.get(id);
    if (item && String(item.userId) === String(userId)) this.sessions.delete(id);
  }
}
export const archivePlaybackSessions = new ArchivePlaybackSessions();
const cleanupTimer = setInterval(() => archivePlaybackSessions.cleanup(), 60_000);
cleanupTimer.unref();
