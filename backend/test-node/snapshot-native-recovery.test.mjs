import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { shouldReprobeSnapshotNative, nextSnapshotNativeRecheckAt } from '../src/services/media/SnapshotNativeRecoveryPolicy.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source=(p)=>readFileSync(resolve(root,p),'utf8');

test('permanent snapshot fallback is retried after a bounded interval, not permanently pinned',()=>{
  const s={permanent:true,state:'ready',mode:'snapshot-video',recordingRefs:0,snapshotNativeRecheckAt:1000};
  assert.equal(shouldReprobeSnapshotNative(s,999),false);
  assert.equal(shouldReprobeSnapshotNative(s,1000),true);
  assert.equal(shouldReprobeSnapshotNative(s,1001,{closed:true}),false);
});

test('never interrupt a recording, a starting session, or a native live stream',()=>{
  const s={permanent:true,state:'ready',mode:'snapshot-video',recordingRefs:0,snapshotNativeRecheckAt:0};
  for(const patch of [
    {recordingRefs:1},{mode:'local-hls-ring'},{state:'starting'},
    {permanent:false},{restartTimer:{}},{recoveryPromise:Promise.resolve()},
  ]) assert.equal(shouldReprobeSnapshotNative({...s,...patch}),false);
});

test('all-camera recovery probes have a staggered schedule',()=>{
  const now=100000;
  const a=nextSnapshotNativeRecheckAt('camera-A',now,90);
  const b=nextSnapshotNativeRecheckAt('camera-B',now,90);
  assert.ok(a>=now+90000&&a<now+120000);
  assert.ok(b>=now+90000&&b<now+120000);
  assert.notEqual(a,b);
});

test('original video is verified before the working snapshot ring is stopped',()=>{
  const o=source('backend/src/services/media/StreamOrchestrator.js');
  const section=o.slice(o.indexOf('async restoreNativeFromSnapshot('),o.indexOf('async reconcilePermanentIngestSessions('));
  assert.ok(section.includes('await go2RtcClient.info()'));
  assert.ok(section.indexOf('await probeMedia(')>=0);
  assert.ok(section.indexOf('if (!verified || !stillSnapshot()) return false;') < section.indexOf('await this.kill(session)'));
  assert.ok(section.includes('SNAPSHOT_NATIVE_STREAM_RESTORED'));
  assert.ok(o.includes('this.snapshotNativeProbeRunning = true'));
});

test('the Kiosk reloads only its browser decoder after backend emergency mode changes',()=>{
  const pool=source('frontend/src/services/liveStreamPool.js');
  const compose=source('docker-compose.yml');
  assert.match(pool,/session\.mode !== entry\.backendSessionMode/);
  assert.match(pool,/SNAPSHOT_NATIVE_MODE_CHANGED/);
  assert.match(compose,/BACKEND_MEMORY_LIMIT:-1536m/);
  assert.match(compose,/GO2RTC_MEMORY_LIMIT:-1536m/);
});
