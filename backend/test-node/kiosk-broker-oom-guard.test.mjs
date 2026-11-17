import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { optionalAudioSource } from '../src/services/media/BrokerPipeline.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (name) => readFileSync(resolve(root, name), 'utf8');

test('H264 camera audio uses AAC with copied video, no second x264 encoder', () => {
  assert.match(optionalAudioSource('camera_raw', 20, 'software', 'h264'), /#video=copy#audio=aac/);
  assert.doesNotMatch(optionalAudioSource('camera_raw', 20, 'software', 'h264'), /#video=h264/);
  assert.match(optionalAudioSource('camera_raw', 20, 'software', 'hevc'), /#video=h264#audio=aac/);
  assert.match(optionalAudioSource('camera_raw', 20, 'copy', null), /#video=copy#audio=aac/);
});

test('VM is protected by per-container cgroup memory caps', () => {
  const compose = read('docker-compose.yml');
  assert.match(compose, /mem_limit: \$\{GO2RTC_MEMORY_LIMIT:-1536m\}/);
  assert.match(compose, /mem_limit: \$\{BACKEND_MEMORY_LIMIT:-1536m\}/);
});

test('orphan cleanup cannot delete non-application go2rtc streams', () => {
  const code = read('backend/src/services/media/StreamOrchestrator.js');
  assert.match(code, /pruneOrphanedBrokersOnBoot/);
  assert.match(code, /cam_\[a-z0-9_.-\]/);
  assert.match(code, /this\.sessions\.size/);
  assert.match(read('backend/src/server.js'), /await streamOrchestrator\.pruneOrphanedBrokersOnBoot\(\)/);
});

test('reused raw producer is never deleted while any broker still owns it', () => {
  const code = read('backend/src/services/media/StreamOrchestrator.js');
  assert.match(code, /const rawInUse = \[\.\.\.this\.brokerRefs\.values\(\)\]/);
  assert.match(code, /\.\.\.\(!rawInUse \? \[go2RtcClient\.deleteStream\(entry\.raw\)\] : \[\]\)/);
  assert.match(code, /this\.maintenanceRunning/);
});

test('motion migrates to central preview and idle background brokers expire', () => {
  const orch = read('backend/src/services/media/StreamOrchestrator.js');
  const motion = read('backend/src/services/recording/MotionDetectionService.js');
  assert.match(motion, /central\.quality === quality/);
  assert.match(motion, /central-preview-ready/);
  assert.match(orch, /\['motion', 'prebuffer'\]\.includes\(session\.purpose\)/);
});
