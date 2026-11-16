import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const motion = read('backend/src/services/recording/MotionDetectionService.js');
const orchestrator = read('backend/src/services/media/StreamOrchestrator.js');
const compression = read('backend/src/services/recording/RecordingCompressionService.js');
const config = read('backend/src/config.js');

test('motion reuses finalized HLS from central ingest and preserves RTSP fallback', () => {
  assert.match(orchestrator, /motionHlsUri\(session\)/);
  assert.match(orchestrator, /motionHlsUri: this\.motionHlsUri\(session\)/);
  assert.match(motion, /selectFreshMotionSegment\(localPlaylist/);
  assert.match(motion, /return local \? \[local, rtsp, hls\] : \[rtsp, hls\]/);
  assert.match(motion, /localHlsPlaylistUri: retained\.motionHlsUri/);
  assert.match(config, /MOTION_PREFER_LOCAL_HLS', true/);
});

test('offline H264 recompression yields to active recordings and high system load', () => {
  assert.match(compression, /config\.recordingCompressionPauseWhileRecording/);
  assert.match(compression, /SELECT 1 FROM recordings WHERE status='recording' LIMIT 1/);
  assert.match(compression, /this\.criticalBusyReason\(\) \|\| this\.systemLoadBusyReason\(\)/);
  assert.match(config, /RECORDING_COMPRESSION_PAUSE_WHILE_RECORDING', true/);
});
