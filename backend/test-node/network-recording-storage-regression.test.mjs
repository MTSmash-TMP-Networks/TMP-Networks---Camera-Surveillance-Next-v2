import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SmbAuthGuard, SMB_AUTH_COOLDOWN_MS, SMB_AUTH_FAILED, SMB_AUTH_COOLDOWN, isSmbAuthenticationFailure } from '../src/services/recording/SmbAuthGuard.js';
import { networkUploadPolicy, selectNetworkUploadCandidates, claimNetworkUpload, runNetworkUploadBatch, NETWORK_UPLOAD_BYPASS_REASON } from '../src/services/recording/NetworkUploadPolicy.js';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = (file) => readFileSync(resolve(root, file), 'utf8');

test('network recording storage uses direct SMB and SFTP clients without a host mount', () => {
  const compose = read('docker-compose.yml');
  const dockerfile = read('backend/Dockerfile');
  const service = read('backend/src/services/NetworkRecordingStorageService.js');
  assert.doesNotMatch(compose, /RECORDINGS_EXTERNAL_HOST_PATH|\/recording-storage/);
  assert.match(dockerfile, /\bsmbclient\b/);
  assert.match(dockerfile, /\bopenssh-client\b/);
  assert.match(dockerfile, /\bsshpass\b/);
  assert.match(service, /execFile\('smbclient'/);
  assert.match(service, /execFile\('sshpass'/);
});

test('network storage credentials are encrypted and never exposed by the public profile', () => {
  const service = read('backend/src/services/NetworkRecordingStorageService.js');
  assert.match(service, /encryptSecret/);
  assert.match(service, /decryptSecret/);
  assert.match(service, /passwordConfigured: Boolean\(row\.password_enc\)/);
  const publicProfile = service.slice(service.indexOf('function publicProfile'), service.indexOf('function containsUnsafeControl'));
  assert.doesNotMatch(publicProfile, /password_enc\s*:/);
  assert.doesNotMatch(publicProfile, /password\s*:/);
});

test('finalized remote blocks retry safely and are materialized for playback/export', () => {
  const service = read('backend/src/services/NetworkRecordingStorageService.js');
  const recording = read('backend/src/services/RecordingService.js');
  const evidence = read('backend/src/services/recording/RecordingEvidenceExport.js');
  assert.match(service, /storage_state='pending'/);
  assert.match(service, /storage_state='upload_failed'/);
  assert.match(service, /storage_state='remote'/);
  assert.match(recording, /assignSegment\(/);
  assert.match(recording, /materializeSegment\(/);
  assert.match(evidence, /materializeSegment\(/);
});

test('compression does not race the network transfer worker', () => {
  const compression = read('backend/src/services/recording/RecordingCompressionService.js');
  const storage = read('backend/src/services/NetworkRecordingStorageService.js');
  assert.match(compression, /COALESCE\(s\.storage_state,'local'\) IN \('local','pending','upload_failed'\)/);
  const policy = read('backend/src/services/recording/NetworkUploadPolicy.js');
  assert.match(policy, /LEFT JOIN recording_compression_jobs c/);
  assert.match(policy, /c\.status IN \('completed','skipped','failed'\)/);
  assert.match(policy, /r\.status IN \('recording','ready','ready_with_gaps'\)/);
  assert.match(storage, /claimNetworkUpload\(db, segment\.id, policy, \(row\) =>/);
  assert.match(storage, /fs\.existsSync\(source \+ '\.compression-backup'\) \|\| fs\.existsSync\(source \+ '\.compressing'\)\) return false/);
  assert.match(storage, /stat\.isFile\(\) && isRecordingStoragePath\(fs\.realpathSync\(source\)/);
  assert.ok(compression.indexOf('const transient = this.reconcileTransientFiles()') < compression.indexOf('if (!config.recordingCompressionEnabled) return;'));
});


test('SMB compatibility path accepts NAS-style locations and distinguishes connection stages', () => {
  const service = read('backend/src/services/NetworkRecordingStorageService.js');
  const ui = read('frontend/src/components/RecordingStorageSettings.jsx');
  const parser = read('frontend/src/utils/smbLocation.js');
  assert.match(service, /function parseSmbLocation\(/);
  assert.match(service, /smb:\\\/\\\//);
  assert.match(service, /for \(const maxProtocol of \['SMB3', 'SMB2'\]\)/);
  assert.match(service, /--use-kerberos=off/);
  assert.match(service, /SMB2_02/);
  assert.match(service, /NETWORK_STORAGE_SHARE_NOT_FOUND/);
  assert.match(service, /NETWORK_STORAGE_PERMISSION_DENIED/);
  assert.match(service, /NETWORK_STORAGE_PROTOCOL_FAILED/);
  assert.match(service, /NETWORK_STORAGE_HOST_UNRESOLVED/);
  assert.match(service, /NETWORK_STORAGE_PORT_UNREACHABLE/);
  assert.match(service, /if \(profile\.protocol === 'smb'\) await runSmb\(profile, 'pwd'\)/);
  assert.match(ui, /parseSmbLocationText/);
  assert.match(parser, /export function parseSmbLocationText\(/);
  assert.match(ui, /NETWORK_STORAGE_SHARE_NOT_FOUND/);
  assert.match(ui, /NETWORK_STORAGE_PORT_UNREACHABLE/);
});


function uploadFixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec("CREATE TABLE recordings (id INTEGER PRIMARY KEY,status TEXT); INSERT INTO recordings VALUES(1,'ready');");
  db.exec("CREATE TABLE recording_segments (id INTEGER PRIMARY KEY,recording_id INTEGER,segment_index INTEGER,file_path TEXT,storage_profile_id TEXT,remote_path TEXT,storage_state TEXT,status TEXT,storage_error TEXT,finalized_at TEXT,ended_at TEXT,started_at TEXT,size_bytes INTEGER);");
  db.exec("CREATE TABLE recording_compression_jobs (recording_id INTEGER,segment_index INTEGER,status TEXT,error TEXT,updated_at TEXT,completed_at TEXT,next_attempt_at TEXT,started_at TEXT);");
  const nowMs = Date.parse('2026-11-26T10:00:00Z');
  function add(id, status, ageMinutes, storage = 'pending', segmentStatus = 'ready') {
    db.prepare('INSERT INTO recording_segments VALUES(?,1,?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, 500)').run(
      id,id,'/recordings/'+id+'.ts','profile','remote/'+id+'.ts',storage,segmentStatus,new Date(nowMs-ageMinutes*60000).toISOString());
    if (status !== null) db.prepare('INSERT INTO recording_compression_jobs VALUES(1,?,?,NULL,NULL,NULL,NULL,NULL)').run(id,status);
  }
  const policy = (options = {}) => networkUploadPolicy({env:{}, nowMs, freeBytes:10*1024**3,...options});
  return {db,add,policy};
}

test('healthy disk prefers completed compression but old blocks and missing jobs cannot starve', t => {
  const {db,add,policy}=uploadFixture(t);
  add(1,'processing',40); add(2,'queued',1); add(3,'retry',11); add(4,'completed',1);
  add(5,null,12); add(6,'queued',12,'remote'); add(7,'queued',12,'pending','recording');
  assert.deepEqual(selectNetworkUploadCandidates(db,policy()).map(s=>s.id),[3,4,5]);
  assert.equal(claimNetworkUpload(db,1,policy()),null);
  assert.equal(claimNetworkUpload(db,2,policy()),null);
  assert.equal(claimNetworkUpload(db,3,policy()).id,3);
  assert.equal(db.prepare('SELECT storage_state FROM recording_segments WHERE id=3').get().storage_state,'uploading');
  const job=db.prepare('SELECT status,error FROM recording_compression_jobs WHERE segment_index=3').get();
  assert.equal(job.status,'skipped');
  assert.equal(job.error,NETWORK_UPLOAD_BYPASS_REASON);
});

test('low disk, large backlog and disabled compression permit original upload, never processing or unsafe source', t => {
  const {db,add,policy}=uploadFixture(t);
  add(1,'processing',1); add(2,'queued',1); add(3,null,1); add(4,'retry',1);
  for (const p of [policy({freeBytes:1.3*1024**3}),policy({pendingBytes:3*1024**3}),policy({compressionEnabled:false})]) {
    assert.deepEqual(selectNetworkUploadCandidates(db,p).map(s=>s.id),[2,3,4]);
    assert.equal(claimNetworkUpload(db,1,p),null);
    assert.equal(claimNetworkUpload(db,2,p,()=>false),null);
  }
  const p=policy({freeBytes:1.3*1024**3});
  assert.equal(p.concurrency,4);
  assert.equal(policy().concurrency,2);
  // The candidate was queued when selected, but compression started during
  // another upload. The actual claim must check the new state.
  db.exec("UPDATE recording_compression_jobs SET status='processing' WHERE segment_index=2");
  assert.equal(claimNetworkUpload(db,2,p),null);
  assert.equal(claimNetworkUpload(db,3,p).id,3);
  assert.equal(claimNetworkUpload(db,4,p).id,4);
});

test('bounded upload batch completes all tasks even when one throws', async () => {
  let active=0, peak=0; const seen=[];
  await assert.rejects(runNetworkUploadBatch([1,2,3,4,5,6],2,async id=>{
    active++; peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,5));
    active--; seen.push(id);
    if (id===2) throw new Error('network failure');
  }), AggregateError);
  assert.equal(peak,2);
  assert.equal(active,0);
  assert.deepEqual(seen.sort((a,b)=>a-b),[1,2,3,4,5,6]);
});


test('SMB authentication failures include account-lock and expired credentials, not ordinary share errors', () => {
  for (const code of ['LOGON_FAILURE','WRONG_PASSWORD','NO_SUCH_USER','ACCOUNT_LOCKED_OUT','ACCOUNT_DISABLED','ACCOUNT_EXPIRED','PASSWORD_EXPIRED','PASSWORD_MUST_CHANGE','ACCOUNT_RESTRICTION','INVALID_LOGON_HOURS']) {
    assert.equal(isSmbAuthenticationFailure('session setup failed: NT_STATUS_'+code), true, code);
  }
  assert.equal(isSmbAuthenticationFailure('session setup failed: NT_STATUS_ACCESS_DENIED'), true);
  for (const code of ['ACCESS_DENIED','BAD_NETWORK_NAME','IO_TIMEOUT','NOT_SUPPORTED','OBJECT_NAME_NOT_FOUND']) {
    assert.equal(isSmbAuthenticationFailure('NT_STATUS_'+code), false, code);
  }
});

test('parallel SMB calls share a persisted server cooldown; no extra attempts after the first rejection', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(()=>db.close());
  db.exec('CREATE TABLE system_settings(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)');
  let now=Date.parse('2026-11-26T12:00:00Z'), attempts=0;
  const pauses=[];
  const guard=new SmbAuthGuard(db,{now:()=>now,onPause:s=>pauses.push(s)});
  const profile={protocol:'smb',host:'NAS.EXAMPLE.',port:445,username:'one'};
  const legacy={...profile,host:'nas.example',port:139,username:'two'};
  const other={...profile,host:'other-nas'};
  async function rejectLogin() {
    attempts++;
    await new Promise(resolve=>setTimeout(resolve,10));
    throw Object.assign(new Error('rejected'),{code:SMB_AUTH_FAILED});
  }
  const results=await Promise.allSettled([guard.run(profile,rejectLogin),guard.run(legacy,rejectLogin),
    guard.run(profile,rejectLogin),guard.run(profile,rejectLogin)]);
  assert.equal(attempts,1);
  assert.equal(results[0].reason.code,SMB_AUTH_FAILED);
  assert.ok(results.slice(1).every(r=>r.reason.code===SMB_AUTH_COOLDOWN));
  assert.equal(pauses.length,1);
  assert.equal(guard.status(legacy).remainingMs,SMB_AUTH_COOLDOWN_MS);
  assert.equal(await guard.run(other,async()=>42),42);
  const restarted=new SmbAuthGuard(db,{now:()=>now});
  now+=SMB_AUTH_COOLDOWN_MS-1;
  await assert.rejects(restarted.run(legacy,rejectLogin),{code:SMB_AUTH_COOLDOWN});
  assert.equal(attempts,1);
  now++;
  assert.equal(await restarted.run(legacy,async()=>43),43);
  assert.equal(restarted.status(profile),null);
  // A fresh failure starts another full cooldown, not a retry storm.
  await assert.rejects(restarted.run(profile,rejectLogin),{code:SMB_AUTH_FAILED});
  assert.equal(restarted.status(profile).remainingMs,SMB_AUTH_COOLDOWN_MS);
  assert.equal(attempts,2);
});

test('paused profile IDs do not starve eligible uploads to another storage target', t => {
  const {db,add,policy}=uploadFixture(t);
  for(let i=1;i<=12;i++) add(i,'completed',1);
  db.exec("UPDATE recording_segments SET storage_profile_id='blocked' WHERE id<=11");
  assert.deepEqual(selectNetworkUploadCandidates(db,policy(),['blocked']).map(s=>s.id),[12]);
});

test('all SMB commands, including manual tests and remote deletion, pass the same auth guard', () => {
  const source=read('backend/src/services/NetworkRecordingStorageService.js');
  assert.match(source,/return smbAuthGuard\.run\(profile, \(\) => smbAuthFile/);
  assert.match(source,/if \(isSmbAuthenticationFailure\(commandOutput\(error\)\)\) throw await smbCommandError/);
  assert.match(source,/if \(isSmbAuthPause\(error\)\) throw error;/);
  assert.match(source,/selectNetworkUploadCandidates\(db, policy, blockedProfileIds\)/);
  assert.match(source,/authCooldowns,/);
});
