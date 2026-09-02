import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalHlsRingArgs, buildSnapshotLocalHlsArgs } from '../src/services/media/FfmpegCommand.js';

function joined(args) { return args.join(' '); }

test('local HLS video path consumes go2rtc HTTP MPEG-TS and publishes atomic segments', () => {
  const args = buildLocalHlsRingArgs({ sourceUri: 'http://go2rtc:1984/media/go2rtc/api/stream.ts?src=cam_video', outputDir: '/data/live/cam' });
  const value = joined(args);
  assert.doesNotMatch(value, /-rtsp_transport/);
  assert.match(value, /api\/stream\.ts\?src=cam_video/);
  assert.match(value, /-map 0:v:0/);
  assert.match(value, /-c:v copy/);
  assert.match(value, /-an/);
  assert.match(value, /-hls_segment_type mpegts/);
  assert.match(value, /temp_file/);
  assert.match(value, /\/data\/live\/cam\/index\.m3u8/);
});

test('audio-capable HTTP MPEG-TS path maps optional AAC without changing video copy', () => {
  const args = buildLocalHlsRingArgs({ sourceUri: 'http://go2rtc:1984/media/go2rtc/api/stream.ts?src=cam_audio', outputDir: '/data/live/cam', includeAudio: true });
  const value = joined(args);
  assert.doesNotMatch(value, /-rtsp_transport/);
  assert.match(value, /-map 0:a:0\?/);
  assert.match(value, /-c:a copy/);
  assert.match(value, /-c:v copy/);
  assert.doesNotMatch(value, / -an(?: |$)/);
});

test('legacy RTSP input remains supported for recording compatibility', () => {
  const args = buildLocalHlsRingArgs({ sourceUri: 'rtsp://go2rtc:8554/cam_video?video=h264', outputDir: '/data/live/cam' });
  assert.match(joined(args), /-rtsp_transport tcp/);
});

test('snapshot emergency path creates the same local HLS contract', () => {
  const args = buildSnapshotLocalHlsArgs({ outputDir: '/data/live/snapshot', width: 640, height: 360, fps: 5 });
  const value = joined(args);
  assert.match(value, /-f image2pipe/);
  assert.match(value, /-c:v libx264/);
  assert.match(value, /-f hls/);
  assert.match(value, /\/data\/live\/snapshot\/index\.m3u8/);
});
