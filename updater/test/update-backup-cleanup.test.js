import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanupUpdateBackups } from '../../scripts/update-backup-cleanup.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-camera-backup-retention-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const primary = path.join(root,'backups'), fallback = path.join(root,'updates','backups');
  await fs.mkdir(primary,{recursive:true});
  await fs.mkdir(fallback,{recursive:true});
  const setStatus = (value) => fs.writeFile(path.join(root,'updates','status.json'), JSON.stringify(value));
  await setStatus({state:'completed'});
  const make = async (day, dir = primary, options = {}) => {
    const stamp = String(day).padStart(2,'0');
    const id = 'update-202611'+stamp+'T090000Z-v2.20.'+day;
    const location = path.join(dir,id);
    await fs.mkdir(path.join(location,'source'),{recursive:true});
    await fs.writeFile(path.join(location,'source','VERSION'),'2.20.'+day+'\n');
    await fs.writeFile(path.join(location,'kamera_server.db'),'fixture');
    await fs.writeFile(path.join(location,'backup.json'),JSON.stringify({
      id,version:'2.20.'+day,createdAt:'2026-11-'+stamp+'T09:00:00Z',database:true,
      ...options,
    }));
    return {id,location};
  };
  return {root,primary,fallback,make,setStatus};
}
const exists = async (p) => Boolean(await fs.lstat(p).catch(()=>null));

test('retains two newest verified update backups across both roots; manual TAR, recordings and unrelated data stay untouched', async t => {
  const f = await fixture(t);
  const a = await f.make(20), b = await f.make(21,f.fallback), c = await f.make(22), d = await f.make(23,f.fallback);
  const invalid = await f.make(19, f.primary, { database: true });
  await fs.unlink(path.join(invalid.location,'kamera_server.db'));
  const tar = path.join(f.primary,'tmp-camera-20261119_090000.tar.gz');
  await fs.writeFile(tar,'manual archive');
  const recordings = path.join(f.root,'recordings');
  await fs.mkdir(recordings);
  await fs.writeFile(path.join(recordings,'recording.ts'),'unchanged');
  await fs.symlink(recordings,path.join(a.location,'source','do-not-follow'));
  await fs.symlink(recordings,path.join(f.primary,'update-20261118T090000Z-v2.20.18'));
  const preview = await cleanupUpdateBackups({dataDir:f.root});
  assert.deepEqual(preview.candidates,[b.id,a.id]);
  assert.ok(await exists(a.location));
  const result = await cleanupUpdateBackups({dataDir:f.root,mode:'startup'});
  assert.deepEqual(result.deleted,[b.id,a.id]);
  assert.deepEqual(result.retained,[d.id,c.id]);
  assert.equal(result.manualArchives,1);
  for (const item of [c,d,invalid]) assert.ok(await exists(item.location));
  assert.equal(await fs.readFile(tar,'utf8'),'manual archive');
  assert.equal(await fs.readFile(path.join(recordings,'recording.ts'),'utf8'),'unchanged');
  assert.equal(await exists(a.location),false);
  assert.deepEqual((await cleanupUpdateBackups({dataDir:f.root,mode:'startup'})).deleted,[]);
});

test('refuses active rollback and unverified current transaction; protects its rollback even if clocks moved backwards', async t => {
  const f = await fixture(t);
  const a = await f.make(20), b = await f.make(21), c = await f.make(22), d = await f.make(23);
  await f.setStatus({state:'running',phase:'rollback',progress:82,backupId:a.id});
  assert.ok((await cleanupUpdateBackups({dataDir:f.root,mode:'startup'})).skippedReason);
  assert.ok((await cleanupUpdateBackups({dataDir:f.root,mode:'post-update'})).skippedReason);
  await f.setStatus({state:'running',phase:'cleanup',progress:99,backupId:'update-missing'});
  assert.ok((await cleanupUpdateBackups({dataDir:f.root,mode:'post-update'})).skippedReason);
  await f.setStatus({state:'running',phase:'cleanup',progress:99,backupId:a.id});
  const result = await cleanupUpdateBackups({dataDir:f.root,mode:'post-update'});
  assert.deepEqual(result.deleted,[b.id]);
  assert.deepEqual(result.retained,[d.id,c.id,a.id]);
  assert.ok(await exists(a.location));
});

test('refuses symlinked backup roots, corrupt status and ambiguous duplicate IDs', async t => {
  const f = await fixture(t);
  const a = await f.make(20), duplicate = await f.make(20,f.fallback);
  await f.make(21); await f.make(22);
  const result = await cleanupUpdateBackups({dataDir:f.root,mode:'startup'});
  assert.deepEqual(result.deleted,[]);
  assert.ok(await exists(a.location) && await exists(duplicate.location));
  await fs.writeFile(path.join(f.root,'updates','status.json'),'{broken');
  await assert.rejects(cleanupUpdateBackups({dataDir:f.root,mode:'startup'}));
  await f.setStatus({state:'completed'});
  await fs.rename(f.primary,path.join(f.root,'saved'));
  await fs.symlink(path.join(f.root,'saved'),f.primary);
  await assert.rejects(cleanupUpdateBackups({dataDir:f.root,mode:'startup'}),/Unsafe backup directory/);
});

test('legacy post-update script and current updater call the same retention policy; script parses', async () => {
  const root = new URL('../../',import.meta.url);
  const server=await fs.readFile(new URL('updater/src/server.js',root),'utf8');
  const hook=await fs.readFile(new URL('scripts/docker-cache-cleanup.sh',root),'utf8');
  assert.match(server,/await runBackupRetention\('startup'\)/);
  assert.match(server,/await runBackupRetention\('before-update'\)/);
  assert.match(server,/await runBackupRetention\('post-update'\)/);
  assert.match(hook,/node \.\/scripts\/update-backup-cleanup\.mjs --post-update/);
  assert.equal(spawnSync('sh',['-n',new URL('scripts/docker-cache-cleanup.sh',root).pathname]).status,0);
});
