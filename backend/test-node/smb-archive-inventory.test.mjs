import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SmbArchiveInventory, parseSmbArchiveListing, classifyArchiveListing, archiveRoot } from '../src/services/recording/SmbArchiveInventory.js';

const root = 'TMP-Camera';
const old = 'Sun Nov  1 12:00:00 2026';
const recent = 'Wed Nov 25 12:00:00 2026';
const now = Date.parse('2026-11-26T14:00:00Z');
const file = '000001-0123456789.ts';
const temp = file + '.uploading-12345678-1234-1234-1234-123456789abc';
const row = (name, attributes, bytes, modified=old) => '  ' + name.padEnd(30) + attributes.padStart(7) + ' ' + String(bytes).padStart(8) + ' ' + modified;
const footer = '    1000 blocks of size 4096. 250 blocks available';
const list = (...lines) => [...lines,footer,''].join('\n');
const listing = list(
  'recurse is now on', row('.','D',0),row('..','D',0),row('recording-1','D',0),row('recording-2','D',0),
  row('recording-3','D',0),row('recording-99','D',0),row('notes.txt','A',19),row('recording-4','D',0),
  '\\TMP-Camera\\recording-1',row(file,'A',10),
  '\\TMP-Camera\\recording-2',row(file,'A',20),row(temp,'A',30),row('private.mp4','A',99),
  '\\TMP-Camera\\recording-3',row(file,'A',40,recent),
  '\\TMP-Camera\\recording-99',row(file,'A',50),
  '\\TMP-Camera\\recording-4',row(file,'A',60),row('000002-0123456789.ts','A',70)
);
const fixtureState = () => ({ recordings: new Set([1,4]), refs: new Set(['tmp-camera/recording-1/'+file,'tmp-camera/recording-4/'+file]), sequence: 4 });
function fixtureDb(t) {
  const db=new DatabaseSync(':memory:'); t.after(()=>db.close());
  db.exec("CREATE TABLE recordings(id INTEGER PRIMARY KEY AUTOINCREMENT); CREATE TABLE recording_segments(recording_id INTEGER, remote_path TEXT); INSERT INTO recordings(id) VALUES (1),(4);");
  const insert = db.prepare('INSERT INTO recording_segments VALUES(?,?)');
  insert.run(1,root+'/recording-1/'+file); insert.run(4,root+'/recording-4/'+file);
  return db;
}
async function untilPhase(inventory, phases) {
  for (let i=0; i<100; i++) {
    if (phases.includes(inventory.status().phase)) return inventory.status();
    await new Promise(resolve=>setImmediate(resolve));
  }
  assert.fail('Job did not complete: '+JSON.stringify(inventory.status()));
}
test('recursive SMB listing reports logical bytes and server capacity, and protects live/unknown paths', () => {
  const data=parseSmbArchiveListing(listing,root);
  const result=classifyArchiveListing(data,root,fixtureState(),now);
  assert.deepEqual(result.capacity,{totalBytes:4096000,freeBytes:1024000,usedBytes:3072000});
  assert.equal(result.directories,5);
  assert.equal(result.count,9);
  assert.equal(result.bytes,398);
  assert.deepEqual(result.buckets.referenced,{count:2,bytes:70});
  assert.deepEqual(result.buckets.orphan,{count:2,bytes:50});
  assert.deepEqual(result.buckets.protected,{count:3,bytes:160});
  assert.deepEqual(result.buckets.other,{count:2,bytes:118});
  assert.deepEqual(result.preview.map(e=>e.path).sort(),[root+'/recording-2/'+file,root+'/recording-2/'+temp].sort());
});
test('refuse malformed, partial, duplicate, or out-of-scope listings and unsafe roots', () => {
  for(const unsafe of ['', '/', 'foo/../bar', 'foo/*', 'foo/?.ts', 'foo;bar']) assert.throws(()=>archiveRoot(unsafe));
  for(const bad of [
    list(row('recording-1','D',0)),
    list(row('recording-1','D',0),'\\Elsewhere\\recording-1',row(file,'A',1)),
    list(row('recording-1','D',0),'\\TMP-Camera\\recording-1','NT_STATUS_ACCESS_DENIED listing x'),
    list(row('recording-1','D',0),'\\TMP-Camera\\recording-1',row(file,'A',1),row(file.toUpperCase(),'A',2)),
    row(file,'A',1),
  ]) assert.throws(()=>parseSmbArchiveListing(bad,root));
});
test('cleanup is limited to its confirmed immutable preview and rechecks age, size, current DB and profile', async t => {
  const db=fixtureDb(t);
  let profile={id:'active',protocol:'smb',base_path:root};
  const commands=[];
  const inventory=new SmbArchiveInventory({db,activeProfile:()=>profile,now:()=>now,runSmb:async(_profile,command,options={})=>{
    commands.push(command);
    if(command.startsWith('recurse;')) return {stdout:listing};
    if(command.startsWith('ls ')) {
      const name=command.includes('.uploading-')?temp:file;
      return {stdout:list(row(name,'A',name===temp?31:20))};
    }
    options.beforeExec?.();
    assert.equal(command,'del "\\TMP-Camera\\recording-2\\'+file+'"');
    return {stdout:'',stderr:''};
  }});
  const started=inventory.startScan('admin');
  await untilPhase(inventory,['ready']);
  assert.equal(inventory.status().actor,undefined);
  assert.throws(()=>inventory.startCleanup(started.id,'someone-else',()=>true));
  assert.throws(()=>inventory.startCleanup(started.id,'admin',()=>false));
  inventory.startCleanup(started.id,'admin',()=>true);
  const finished=await untilPhase(inventory,['finished','failed']);
  assert.equal(finished.phase,'finished');
  assert.deepEqual(finished.progress,{total:2,deleted:1,deletedBytes:20,skipped:1,failed:0});
  assert.equal(commands.filter(c=>c.startsWith('del ')).length,1);
  assert.throws(()=>inventory.startCleanup(started.id,'admin',()=>true));
  const next=inventory.startScan('admin');
  await untilPhase(inventory,['ready']);
  profile={...profile,id:'changed'};
  assert.throws(()=>inventory.startCleanup(next.id,'admin',()=>true));
});
test('a new DB reference appearing while the deletion waits for its paced slot prevents deletion', async t => {
  const db=fixtureDb(t);
  const profile={id:'active',protocol:'smb',base_path:root};
  let deletions=0;
  const inventory=new SmbArchiveInventory({db,activeProfile:()=>profile,now:()=>now,runSmb:async(_profile,command,options={})=>{
    if(command.startsWith('recurse;'))return {stdout:listing};
    if(command.startsWith('ls '))return {stdout:list(row(command.includes('.uploading-')?temp:file,'A',command.includes('.uploading-')?30:20))};
    db.prepare('INSERT OR IGNORE INTO recordings(id) VALUES(2)').run();
    options.beforeExec?.(); deletions++; return {stdout:''};
  }});
  const job=inventory.startScan('admin');
  await untilPhase(inventory,['ready']);
  inventory.startCleanup(job.id,'admin',()=>true);
  const result=await untilPhase(inventory,['finished','failed']);
  assert.equal(deletions,0);
  assert.equal(result.progress.skipped,2);
});
test('a failed or expired scan never permits deletion',async t=>{
  const db=fixtureDb(t);
  let clock=now, broken=true;
  const inventory=new SmbArchiveInventory({db,activeProfile:()=>({id:'active',protocol:'smb',base_path:root}),now:()=>clock,runSmb:async()=>({stdout:broken?'NT_STATUS_ACCESS_DENIED':listing})});
  let job=inventory.startScan('admin');
  await untilPhase(inventory,['failed']);
  assert.throws(()=>inventory.startCleanup(job.id,'admin',()=>true));
  broken=false;job=inventory.startScan('admin');
  await untilPhase(inventory,['ready']);
  clock+=31*60*1000;
  assert.throws(()=>inventory.startCleanup(job.id,'admin',()=>true));
});
test('real Samba guest share: enumerate and remove only the confirmed test orphan', {skip:!process.env.SMB_INVENTORY_TEST_PORT}, async t=>{
  const db=fixtureDb(t);
  const profile={id:'integration',protocol:'smb',base_path:root};
  const exec=promisify(execFile);
  const runSmb=async(_profile,command,options={})=>{
    options.beforeExec?.();
    return exec('smbclient',['//127.0.0.1/archive','-p',process.env.SMB_INVENTORY_TEST_PORT,'-N','-m','SMB3','--option=client min protocol=SMB2_02','-c',command],{timeout:15000,env:{...process.env,LC_ALL:'C.UTF-8'}});
  };
  const inventory=new SmbArchiveInventory({db,activeProfile:()=>profile,runSmb,now:()=>Date.now()});
  const started=inventory.startScan('admin');
  const scanned=await new Promise((resolve,reject)=>{
    const start=Date.now(); const timer=setInterval(()=>{const s=inventory.status();if(['ready','failed'].includes(s.phase)){clearInterval(timer);resolve(s);}else if(Date.now()-start>20000){clearInterval(timer);reject(new Error('scan timeout'));}},50);
  });
  assert.equal(scanned.phase,'ready',JSON.stringify(scanned));
  assert.equal(scanned.result.buckets.orphan.count,1);
  assert.equal(scanned.result.buckets.referenced.count,1);
  inventory.startCleanup(started.id,'admin',()=>true);
  const finished=await new Promise((resolve,reject)=>{
    const start=Date.now();const timer=setInterval(()=>{const s=inventory.status();if(['finished','failed'].includes(s.phase)){clearInterval(timer);resolve(s);}else if(Date.now()-start>20000){clearInterval(timer);reject(new Error('cleanup timeout'));}},50);
  });
  assert.equal(finished.phase,'finished',JSON.stringify(finished));
  assert.equal(finished.progress.deleted,1);
  const after=await runSmb(profile,'recurse; ls "\\TMP-Camera\\*"');
  const entries=parseSmbArchiveListing(after.stdout,root).entries;
  assert.ok(entries.some(e=>e.path===root+'/recording-1/'+file));
  assert.ok(entries.some(e=>e.path===root+'/notes.txt'));
  assert.ok(!entries.some(e=>e.path===root+'/recording-2/'+file));
});


test('full cleanup handles more than the 200-file preview without exposing or expanding the approved snapshot', async t => {
  const db=fixtureDb(t);
  const profile={id:'active',protocol:'smb',base_path:root};
  const names=Array.from({length:235},(_,i)=>String(i+1).padStart(6,'0')+'-0123456789.ts');
  const full=list(row('recording-2','D',0),'\\TMP-Camera\\recording-2',...names.map(n=>row(n,'A',20)));
  let deleted=[], pauses=0;
  const inventory=new SmbArchiveInventory({db,activeProfile:()=>profile,now:()=>now,pauseBetweenBatches:async()=>{pauses++;},runSmb:async(_profile,command,options={})=>{
    if(command.startsWith('recurse;')) return {stdout:full};
    const name=command.match(/\\([^\\"]+)"$/)[1];
    assert.ok(names.includes(name));
    options.beforeExec?.();
    if(command.startsWith('ls ')) return {stdout:list(row(name,'A',20))};
    deleted.push(name);
    return {stdout:'',stderr:''};
  }});
  let job=inventory.startScan('admin');
  const ready=await untilPhase(inventory,['ready','failed']);
  assert.equal(ready.phase,'ready');
  assert.equal(ready.result.preview.length,200);
  assert.equal(ready.result.buckets.orphan.count,235);
  assert.equal(ready.candidates,undefined);
  assert.equal(ready.selected,undefined);
  assert.throws(()=>inventory.startCleanup(job.id,'admin',()=>true,'unexpected'));
  inventory.startCleanup(job.id,'admin',()=>true,'preview');
  let finished=await untilPhase(inventory,['finished','failed']);
  assert.equal(finished.phase,'finished');
  assert.equal(deleted.length,200);
  assert.equal(pauses,3);
  deleted=[]; pauses=0;
  job=inventory.startScan('admin');
  await untilPhase(inventory,['ready']);
  const accepted=inventory.startCleanup(job.id,'admin',()=>true,'all');
  assert.equal(accepted.progress.total,235);
  assert.equal(accepted.cleanupBytes,4700);
  assert.equal(accepted.candidates,undefined);
  assert.equal(accepted.selected,undefined);
  finished=await untilPhase(inventory,['finished','failed']);
  assert.equal(finished.phase,'finished');
  assert.equal(finished.progress.deleted,235);
  assert.equal(finished.progress.deletedBytes,4700);
  assert.equal(new Set(deleted).size,235);
  assert.equal(pauses,4);
  assert.equal(inventory.job.candidates,undefined);
  assert.equal(inventory.job.selected,undefined);
  assert.throws(()=>inventory.startCleanup(job.id,'admin',()=>true,'all'));
});

test('stopping bulk cleanup at a batch boundary prevents further deletion', async t => {
  const db=fixtureDb(t);
  const profile={id:'active',protocol:'smb',base_path:root};
  const names=Array.from({length:60},(_,i)=>String(i+1).padStart(6,'0')+'-0123456789.ts');
  const full=list(row('recording-2','D',0),'\\TMP-Camera\\recording-2',...names.map(n=>row(n,'A',20)));
  let deleted=0;
  const inventory=new SmbArchiveInventory({db,activeProfile:()=>profile,now:()=>now,pauseBetweenBatches:async()=>inventory.stopCleanup(inventory.status().id),runSmb:async(_profile,command,options={})=>{
    if(command.startsWith('recurse;')) return {stdout:full};
    options.beforeExec?.();
    if(command.startsWith('ls ')) return {stdout:list(row(command.match(/\\([^\\"]+)"$/)[1],'A',20))};
    deleted++;return {stdout:''};
  }});
  const job=inventory.startScan('admin');
  await untilPhase(inventory,['ready']);
  inventory.startCleanup(job.id,'admin',()=>true,'all');
  const finished=await untilPhase(inventory,['finished','stopped','failed']);
  assert.equal(finished.phase,'stopped');
  assert.equal(deleted,50);
  assert.equal(finished.progress.total,60);
});
