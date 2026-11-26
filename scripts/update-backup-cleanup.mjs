// Retain only verified automatic source/database update backups.
// Explicit full TAR archives, unknown directories and recording data are never removed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const UPDATE_BACKUP_ID = /^update-\d{8}T\d{6}Z-v(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/;
const KEEP = 2;

async function statOrNull(file) {
  try { return await fs.lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function readSmallFile(file, limit = 1024 * 1024) {
  const info = await statOrNull(file);
  if (!info?.isFile() || info.size > limit || info.size === 0) throw new Error('Invalid backup metadata');
  return fs.readFile(file, 'utf8');
}

async function rootsFor(dataDir) {
  const root = await fs.realpath(dataDir);
  if (root === path.parse(root).root) throw new Error('Refusing filesystem root as data directory');
  const updates = path.join(root, 'updates');
  const updatesStat = await statOrNull(updates);
  if (updatesStat && !updatesStat.isDirectory()) throw new Error('Unsafe updates directory');
  const roots = [];
  for (const dir of [path.join(root, 'backups'), path.join(updates, 'backups')]) {
    const info = await statOrNull(dir);
    if (!info) continue;
    if (!info.isDirectory() || await fs.realpath(dir) !== dir) throw new Error('Unsafe backup directory');
    roots.push(dir);
  }
  return { root, roots };
}

async function loadStatus(root) {
  const file = path.join(root, 'updates', 'status.json');
  if (!await statOrNull(file)) return { state: 'idle' };
  const status = JSON.parse(await readSmallFile(file));
  if (!status || !['idle', 'running', 'completed', 'rolled_back', 'failed'].includes(status.state)) {
    throw new Error('Unknown update status; cleanup refused');
  }
  return status;
}

async function validatedBackup(root, name) {
  const match = UPDATE_BACKUP_ID.exec(name);
  if (!match) return null;
  const dir = path.join(root, name);
  const info = await statOrNull(dir);
  if (!info?.isDirectory() || await fs.realpath(dir) !== dir) return null;
  try {
    const metadata = JSON.parse(await readSmallFile(path.join(dir, 'backup.json'), 65536));
    if (metadata.id !== name || metadata.version !== match[1] ||
        typeof metadata.database !== 'boolean' || !Number.isFinite(Date.parse(metadata.createdAt))) return null;
    const source = path.join(dir, 'source');
    if (!(await statOrNull(source))?.isDirectory() || await fs.realpath(source) !== source) return null;
    if ((await readSmallFile(path.join(source, 'VERSION'), 256)).trim() !== metadata.version) return null;
    if (metadata.database) {
      const db = await statOrNull(path.join(dir, 'kamera_server.db'));
      if (!db?.isFile() || db.size <= 0) return null;
    }
    const env = await statOrNull(path.join(dir, 'environment.env'));
    if (env && !env.isFile()) return null;
    return { id: name, dir, root, createdAt: Date.parse(metadata.createdAt), dev: info.dev, ino: info.ino };
  } catch (error) {
    if (['EACCES', 'EPERM', 'EIO'].includes(error.code)) throw error;
    return null;
  }
}

// rm does not follow symbolic links. Nested mounts are additionally excluded,
// even when a bind mount reports the same device number as its parent.
async function mountedWithin(dir) {
  if (process.platform !== 'linux') throw new Error('Automatic cleanup requires Linux mount information');
  const info = await fs.readFile('/proc/self/mountinfo', 'utf8');
  const mounts = info.split('\n').filter(Boolean).map(line => {
    const field = line.split(' ')[4];
    if (!field) throw new Error('Invalid mount information');
    return field.replace(/\\([0-7]{3})/g, (_m, octal) => String.fromCharCode(parseInt(octal, 8)));
  });
  return mounts.some(mount => mount === dir || mount.startsWith(dir + path.sep));
}

async function freeBytes(root) {
  try { const s = await fs.statfs(root); return Number(s.bavail) * Number(s.bsize); }
  catch { return null; }
}

export async function cleanupUpdateBackups({ dataDir, mode = 'dry-run' }) {
  if (!['dry-run', 'startup', 'before-update', 'post-update', 'offline-apply'].includes(mode)) throw new Error('Invalid cleanup mode');
  const { root, roots } = await rootsFor(dataDir);
  const status = await loadStatus(root);
  const result = { mode, retained: [], candidates: [], deleted: [], skipped: [], manualArchives: 0, freedBytes: null };
  const isUpdateMode = mode === 'before-update' || mode === 'post-update';
  const expectedProgress = mode === 'post-update' ? 99 : 16;
  if (mode !== 'dry-run' && (isUpdateMode
    ? status.state !== 'running' || status.phase !== 'cleanup' || Number(status.progress) !== expectedProgress
    : status.state === 'running')) {
    return { ...result, skippedReason: 'Update/rollback status does not permit cleanup' };
  }

  const backups = [];
  for (const dir of roots) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (!UPDATE_BACKUP_ID.test(entry.name)) {
        if (entry.isFile() && /\.tar(?:\.gz|\.zst)?$|\.tgz$/i.test(entry.name)) result.manualArchives++;
        continue;
      }
      const backup = await validatedBackup(dir, entry.name);
      if (backup) backups.push(backup);
      else result.skipped.push(entry.name);
    }
  }
  backups.sort((a,b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id) || a.root.localeCompare(b.root));
  // The current transaction's rollback must survive, including an unusual
  // clock change. Duplicate IDs across roots are ambiguous and never removed.
  const protectedId = typeof status.backupId === 'string' ? status.backupId : null;
  if (mode === 'post-update' && (!protectedId || !backups.some(item => item.id === protectedId))) {
    return { ...result, skippedReason: 'Current rollback backup could not be verified' };
  }
  const ids = new Map();
  for (const item of backups) ids.set(item.id, (ids.get(item.id) || 0) + 1);
  const kept = new Set(backups.slice(0, KEEP).map(item => item.dir));
  if (protectedId) for (const item of backups) if (item.id === protectedId) kept.add(item.dir);
  for (const item of backups) if (ids.get(item.id) > 1) kept.add(item.dir);
  const candidates = backups.filter(item => !kept.has(item.dir));
  result.retained = backups.filter(item => kept.has(item.dir)).map(item => item.id);
  result.candidates = candidates.map(item => item.id);
  if (mode === 'dry-run') return result;

  const before = await freeBytes(root);
  for (const item of candidates) {
    // A changed status, renamed directory or new mount must fail closed.
    const latest = await loadStatus(root);
    if (latest.state !== status.state || latest.phase !== status.phase ||
        latest.backupId !== status.backupId || latest.startedAt !== status.startedAt ||
        (isUpdateMode && Number(latest.progress) !== expectedProgress)) {
      result.skippedReason = 'Update state changed during cleanup';
      break;
    }
    const checked = await validatedBackup(item.root, item.id);
    if (!checked || checked.dev !== item.dev || checked.ino !== item.ino || await mountedWithin(item.dir)) {
      result.skipped.push(item.id);
      continue;
    }
    await fs.rm(item.dir, { recursive: true, force: false });
    result.deleted.push(item.id);
  }
  const after = await freeBytes(root);
  if (before !== null && after !== null) result.freedBytes = Math.max(0, after - before);
  return result;
}

async function main() {
  const flag = process.argv[2] || '--dry-run';
  if (process.argv.length > 3 || !['--dry-run','--startup','--before-update','--post-update','--offline-apply'].includes(flag)) {
    throw new Error('Use --dry-run, --startup, --before-update, --post-update or --offline-apply');
  }
  const result = await cleanupUpdateBackups({
    dataDir: process.env.DATA_DIR || fileURLToPath(new URL('../data', import.meta.url)), mode: flag.slice(2),
  });
  if (flag === '--dry-run' || flag === '--offline-apply') console.log(JSON.stringify(result, null, 2));
  else console.log('Backup-Bereinigung: ' + result.deleted.length + ' alte Update-Sicherungen entfernt; ' +
    result.retained.length + ' geschuetzt; ' + result.manualArchives + ' TAR-Archive unangetastet; ' +
    (result.freedBytes === null ? '' : result.freedBytes + ' Bytes zusaetzlich frei. ') +
    (result.skippedReason || (result.skipped.length ? result.skipped.length + ' nicht verifizierbare Sicherungen uebersprungen.' : '')));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error('Backup-Bereinigung uebersprungen: ' + error.message); process.exitCode = 1; });
}
