import { randomUUID } from 'node:crypto';
import { AppError } from '../../utils/errors.js';

export const ORPHAN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const PREVIEW_LIMIT = 200;
const SNAPSHOT_TTL_MS = 30 * 60 * 1000;
const SCAN_LIMIT = 200000;
const fail = (code = 'SMB_INVENTORY_INVALID') => new AppError(422, code, 'SMB-Archivbestand konnte nicht sicher verarbeitet werden.');
const key = value => String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').normalize('NFC').toLowerCase();
const allowedPath = value => typeof value === 'string' && !!value && value.split('/').every(part => part && part !== '.' && part !== '..' && !/[\x00-\x1f\x7f\\:*?"<>|;]/.test(part));
export function archiveRoot(value) {
  const root = String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!allowedPath(root)) throw fail('SMB_INVENTORY_UNSAFE_ROOT');
  return root;
}
const smbPath = value => {
  if (!allowedPath(value)) throw fail('SMB_INVENTORY_UNSAFE_ROOT');
  return '\\' + value.replace(/\//g, '\\');
};

const listingLine = /^\s+(.+?)\s+([A-Z]{0,7})\s+(\d+)\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s*$/;
const capacityLine = /^\s*(\d+) blocks of size (\d+)\.\s+(\d+) blocks available\s*$/;
export function parseSmbArchiveListing(stdout, root) {
  root = archiveRoot(root);
  let directory = root, capacity = null;
  const entries = [], seen = new Set(), directories = new Set([key(root)]), visited = new Set([key(root)]);
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line.trim() || /^recur(?:se|sion)(?: is)?(?: now)? on\.?$/i.test(line.trim())) continue;
    const cap = line.match(capacityLine);
    if (cap) {
      if (capacity) throw fail();
      const [blocks, size, free] = cap.slice(1).map(Number);
      const totalBytes = blocks * size, freeBytes = free * size;
      if (![blocks,size,free,totalBytes,freeBytes].every(Number.isSafeInteger) || size <= 0 || freeBytes > totalBytes) throw fail();
      capacity = { totalBytes, freeBytes, usedBytes: totalBytes - freeBytes };
      continue;
    }
    if (capacity) throw fail();
    if (line.startsWith('\\')) {
      const next = line.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if (!allowedPath(next) || !key(next).startsWith(key(root) + '/') || !directories.has(key(next)) || visited.has(key(next))) throw fail();
      directory = next; visited.add(key(next)); continue;
    }
    const row = line.match(listingLine);
    if (!row) throw fail();
    const [, name, attributes, bytesText, modified] = row;
    if (name === '.' || name === '..') continue;
    // Unknown or unrepresentable names make this scan incomplete; do not
    // silently produce a destructive preview from a partial listing.
    if (!allowedPath(name) || name.includes('/')) throw fail();
    const bytes = Number(bytesText), mtime = Date.parse(modified);
    if (!Number.isSafeInteger(bytes) || !Number.isFinite(mtime)) throw fail();
    const path = directory + '/' + name, normalized = key(path);
    if (seen.has(normalized)) throw fail();
    seen.add(normalized);
    const isDirectory = attributes.includes('D');
    if (isDirectory) directories.add(normalized);
    entries.push({ path, name, attributes, bytes, modified, mtime, isDirectory });
    if (entries.length > SCAN_LIMIT) throw fail('SMB_INVENTORY_LIMIT');
  }
  if (!capacity) throw fail();
  return { entries, capacity, directories: directories.size - 1 };
}

function generatedFile(entry, root) {
  const prefix = root + '/';
  if (!entry.path.startsWith(prefix) || entry.isDirectory || !/^[AN]*$/.test(entry.attributes)) return null;
  const relative = entry.path.slice(prefix.length);
  const match = relative.match(/^recording-([1-9]\d*)\/(\d{6,}-[0-9a-f]{10}\.(?:ts|mp4|mkv|m4v|avi|webm))(?:\.uploading-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?$/);
  if (!match || !Number.isSafeInteger(Number(match[1]))) return null;
  return { recordingId: Number(match[1]), temporary: Boolean(match[3]), finalPath: prefix + 'recording-' + match[1] + '/' + match[2] };
}
function dbState(db) {
  const recordings = new Set(db.prepare('SELECT id FROM recordings').all().map(row => Number(row.id)));
  const refs = new Set(db.prepare('SELECT remote_path FROM recording_segments WHERE remote_path IS NOT NULL').all().map(row => key(row.remote_path)));
  const sequence = Number(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='recordings'").get()?.seq || 0);
  return { recordings, refs, sequence };
}
function eligible(entry, root, state, now) {
  const generated = generatedFile(entry, root);
  if (!generated || generated.recordingId > state.sequence || state.recordings.has(generated.recordingId) ||
      state.refs.has(key(entry.path)) || state.refs.has(key(generated.finalPath)) ||
      entry.mtime > now - ORPHAN_AGE_MS) return null;
  return generated;
}
export function classifyArchiveListing(listing, root, state, now = Date.now()) {
  const buckets = Object.fromEntries(['referenced','orphan','protected','other'].map(name => [name, { count: 0, bytes: 0 }]));
  const folders = new Map(), candidates = [];
  let count = 0, bytes = 0;
  const ordinaryDirs = new Set(listing.entries.filter(entry => entry.isDirectory && /^[DA]+$/.test(entry.attributes)).map(entry => entry.path));
  for (const entry of listing.entries) {
    if (entry.isDirectory) continue;
    count++; bytes += entry.bytes;
    if (!Number.isSafeInteger(bytes)) throw fail();
    const parent = entry.path.slice(0,entry.path.lastIndexOf('/'));
    const folder = folders.get(parent) || { path: parent, count: 0, bytes: 0 };
    folder.count++; folder.bytes += entry.bytes; folders.set(parent, folder);
    const generated = generatedFile(entry, root);
    const orphan = ordinaryDirs.has(parent) && eligible(entry, root, state, now);
    const category = state.refs.has(key(entry.path)) ? 'referenced' : orphan ? 'orphan' : generated ? 'protected' : 'other';
    buckets[category].count++; buckets[category].bytes += entry.bytes;
    if (category === 'orphan') candidates.push({ ...entry, ...orphan });
  }
  // Show and delete exactly the same bounded set, oldest first. A new scan
  // is required before another batch can be approved.
  candidates.sort((a,b) => a.mtime - b.mtime || a.path.localeCompare(b.path));
  const preview = candidates.slice(0, PREVIEW_LIMIT);
  return { capacity: listing.capacity, count, bytes, directories: listing.directories, buckets,
    topFolders: [...folders.values()].sort((a,b) => b.bytes-a.bytes).slice(0,20),
    preview, previewBytes: preview.reduce((sum,entry) => sum+entry.bytes,0), previewLimit: PREVIEW_LIMIT };
}

export class SmbArchiveInventory {
  constructor({ db, activeProfile, runSmb, now = Date.now, onFinish = () => {} }) {
    Object.assign(this, { db, activeProfile, runSmb, now, onFinish });
    this.job = null;
  }
  busy() { return ['scanning','cleaning'].includes(this.job?.phase); }
  status() {
    if (!this.job) return { phase: 'idle' };
    const { actor, stop, canMutate, ...publicJob } = this.job;
    return publicJob;
  }
  current(profileId) {
    const profile = this.activeProfile();
    if (!profile || profile.protocol !== 'smb' || (profileId && profile.id !== profileId)) throw fail('SMB_INVENTORY_TARGET_CHANGED');
    archiveRoot(profile.base_path);
    return profile;
  }
  startScan(actor) {
    if (this.busy()) return this.status();
    const profile = this.current();
    const root = archiveRoot(profile.base_path);
    const job = { id: randomUUID(), actor, profileId: profile.id, root, phase: 'scanning', startedAt: new Date(this.now()).toISOString(), result: null };
    this.job = job;
    void this.scan(job, profile);
    return this.status();
  }
  async scan(job, profile) {
    try {
      // One authenticated session for the entire listing. No per-file allinfo
      // requests and no download of recording contents.
      const output = await this.runSmb(profile, 'recurse; ls "' + smbPath(job.root) + '\\*"', { timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
      this.current(job.profileId);
      const listing = parseSmbArchiveListing(output.stdout, job.root);
      job.result = classifyArchiveListing(listing, job.root, dbState(this.db), this.now());
      job.completedAt = new Date(this.now()).toISOString();
      job.expiresAt = new Date(this.now() + SNAPSHOT_TTL_MS).toISOString();
      job.phase = 'ready';
    } catch (error) { job.phase = 'failed'; job.error = error?.code || 'SMB_INVENTORY_INVALID'; }
  }
  startCleanup(id, actor, canMutate) {
    const job = this.job;
    if (!job || job.phase !== 'ready' || job.id !== id || job.actor !== actor ||
        this.now() >= Date.parse(job.expiresAt) || !job.result?.preview?.length || !canMutate()) throw fail('SMB_INVENTORY_STALE');
    const profile = this.current(job.profileId);
    job.phase = 'cleaning';
    job.progress = { total: job.result.preview.length, deleted: 0, deletedBytes: 0, skipped: 0, failed: 0 };
    job.canMutate = canMutate;
    void this.clean(job, profile);
    return this.status();
  }
  stopCleanup(id) {
    if (this.job?.id !== id || this.job.phase !== 'cleaning') throw fail('SMB_INVENTORY_STALE');
    this.job.stop = true;
    return this.status();
  }
  verifyCandidate(job, entry) {
    this.current(job.profileId);
    if (job.stop || !job.canMutate()) throw fail('SMB_INVENTORY_STOPPED');
    const generated = generatedFile(entry, job.root);
    if (!generated || entry.mtime > this.now() - ORPHAN_AGE_MS ||
        this.db.prepare('SELECT 1 FROM recordings WHERE id=?').get(generated.recordingId) ||
        Number(this.db.prepare("SELECT seq FROM sqlite_sequence WHERE name='recordings'").get()?.seq || 0) < generated.recordingId ||
        this.db.prepare("SELECT 1 FROM recording_segments WHERE lower(replace(remote_path,char(92),'/')) IN (?,?) LIMIT 1").get(key(entry.path),key(generated.finalPath))) {
      throw fail('SMB_INVENTORY_CHANGED');
    }
  }
  async clean(job, profile) {
    try {
      for (const entry of job.result.preview) {
        if (job.stop || !job.canMutate()) break;
        try {
          this.verifyCandidate(job, entry);
          const parent = entry.path.slice(0,entry.path.lastIndexOf('/'));
          const check = await this.runSmb(profile, 'ls "' + smbPath(entry.path) + '"');
          const listed = parseSmbArchiveListing(check.stdout, parent).entries;
          if (listed.length !== 1 || listed[0].path !== entry.path || listed[0].attributes !== entry.attributes ||
              listed[0].bytes !== entry.bytes || listed[0].mtime !== entry.mtime) { job.progress.skipped++; continue; }
          // Recheck the live DB and active profile inside the paced SMB slot
          // immediately before the exact, non-wildcard deletion command.
          const deleted = await this.runSmb(profile, 'del "' + smbPath(entry.path) + '"',
            { beforeExec: () => this.verifyCandidate(job, entry) });
          if (/NT_STATUS_|ERRDOS|ERRSRV|ERRHRD|failed|access denied/i.test(String(deleted.stdout || '') + '\n' + String(deleted.stderr || ''))) throw fail('SMB_INVENTORY_DELETE_FAILED');
          job.progress.deleted++; job.progress.deletedBytes += entry.bytes;
        } catch (error) {
          if (['SMB_INVENTORY_CHANGED','NETWORK_STORAGE_REMOTE_NOT_FOUND'].includes(error?.code)) { job.progress.skipped++; continue; }
          if (error?.code === 'SMB_INVENTORY_STOPPED') { job.stop = true; break; }
          job.progress.failed++; job.error = error?.code || 'SMB_INVENTORY_DELETE_FAILED'; break;
        }
      }
      job.phase = job.error ? 'failed' : job.stop || !job.canMutate() ? 'stopped' : 'finished';
    } catch (error) { job.phase = 'failed'; job.error = error?.code || 'SMB_INVENTORY_DELETE_FAILED'; }
    finally {
      job.completedAt = new Date(this.now()).toISOString();
      // A completed/failed batch is never reusable.
      try { this.onFinish({ id: job.id, actor: job.actor, profileId: job.profileId, phase: job.phase, ...job.progress }); } catch {}
      delete job.canMutate;
    }
  }
}
