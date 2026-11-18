import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bufferedHlsSeconds, shouldAnnounceHlsRecovery, shouldEscalateHlsRecovery } from '../../frontend/src/services/hlsRecoveryPolicy.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (name) => readFileSync(resolve(root, name), 'utf8');

test('a transient WiFi retry does not interrupt a Kiosk player with buffered frames', () => {
  assert.equal(shouldAnnounceHlsRecovery({elapsedMs:6500,frameAgeMs:1200,bufferSeconds:8}),false);
  assert.equal(shouldAnnounceHlsRecovery({elapsedMs:6500,frameAgeMs:9000,bufferSeconds:6}),false);
  assert.equal(shouldEscalateHlsRecovery({frameAgeMs:2500}),false);
});

test('persistent decoder stillness does show the repair and eventually reconnect', () => {
  assert.equal(shouldAnnounceHlsRecovery({elapsedMs:6500,frameAgeMs:9000,bufferSeconds:0}),true);
  assert.equal(shouldAnnounceHlsRecovery({elapsedMs:16500,frameAgeMs:16500,bufferSeconds:6}),true);
  assert.equal(shouldEscalateHlsRecovery({frameAgeMs:20000}),true);
});

test('paused and hidden Kiosk tiles do not cause recovery storms', () => {
  for (const other of [{active:false},{visible:false},{paused:true}]) {
    assert.equal(shouldAnnounceHlsRecovery({elapsedMs:60000,frameAgeMs:60000,...other}),false);
    assert.equal(shouldEscalateHlsRecovery({frameAgeMs:60000,...other}),false);
  }
});

test('media ranges tolerate disjoint segments and rotation races', () => {
  assert.equal(bufferedHlsSeconds({currentTime:4,buffered:{length:2,start:(i)=>i?3:0,end:(i)=>i?12:2}}),8);
  assert.equal(bufferedHlsSeconds({currentTime:4,buffered:{length:1,start:()=>0,end:()=>2}}),0);
  assert.equal(bufferedHlsSeconds({currentTime:4,buffered:{length:1,start:()=>{throw Error('rotate')},end:()=>10}}),0);
});

test('the visible repair state is delayed and each HLS player has one watchdog', () => {
  const pool=source('frontend/src/services/liveStreamPool.js');
  const player=source('frontend/src/services/hlsPlayer.js');
  assert.match(pool,/if \(entry\.hlsRecoveryTimer\) return; \/\/ one pending repair per player/);
  assert.match(pool,/HLS_RECOVERY_NOTICE_GRACE_MS/);
  assert.match(pool,/this\.finishHlsRecovery\(entry, 'playback-continues'/);
  assert.match(pool,/confirmedFrameStall \? Math\.max\(30000, STALL_MS\) : HLS_RECOVERY_ESCALATION_MS/);
  assert.match(player,/SOFT_STALL_RETRY_COOLDOWN_MS = 12000/);
  assert.match(player,/RECOVERY_WATCHDOG_MS = 45000/);
  assert.match(player,/maxBufferLength: 40/);
  assert.match(player,/bufferedAhead\(video\) >= 0\.75 && video\.readyState >= 2/);
});
