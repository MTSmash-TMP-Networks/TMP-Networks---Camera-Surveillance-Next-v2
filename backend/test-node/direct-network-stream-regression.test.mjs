import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectDirectStream, normalizeDirectStreamInput } from '../src/services/DirectStreamInstaller.js';
import { normalizeMediaSourceUrl } from '../src/services/media/MediaSource.js';
import { buildProbeArgs } from '../src/services/media/FfmpegProbe.js';
import { buildMediaInputArgs } from '../src/services/media/FfmpegInputOptions.js';

test('direct stream input derives host, protocol and removes embedded credentials from persisted URL', () => {
  const result = normalizeDirectStreamInput({
    name: 'Public demo', connectionMode: 'stream', username: '', password: '',
    mediaSources: [{ label: 'Demo', kind: 'auto', url: 'rtsp://alice:secret@example.org:8554/live', enabled: true }],
  });
  assert.equal(result.ip, 'example.org');
  assert.equal(result.port, 8554);
  assert.equal(result.primarySource.kind, 'rtsp');
  assert.equal(result.primarySource.url, 'rtsp://example.org:8554/live');
  assert.equal(result.username, 'alice');
  assert.equal(result.password, 'secret');
});

test('HLS direct stream can be inspected without ONVIF when ffprobe confirms video', async () => {
  const result = await inspectDirectStream({
    name: 'City live', connectionMode: 'stream', mediaSources: [{ label: 'City', kind: 'hls', url: 'https://video.example.org/live/master.m3u8', enabled: true }],
  }, { probe: async () => ({ video: { codec: 'h264', width: 1920, height: 1080, fps: 25 }, audio: { codec: 'aac' }, bitRate: 4000000 }) });
  assert.equal(result.mode, 'stream');
  assert.equal(result.capabilities.driver, 'direct-stream');
  assert.equal(result.capabilities.connectionType, 'stream');
  assert.equal(result.capabilities.onvif, false);
  assert.equal(result.capabilities.audio, true);
  assert.equal(result.connection.ip, 'video.example.org');
  assert.equal(result.mediaSources[0].kind, 'hls');
});

test('normal camera alternatives still reject another host while direct streams may use external hosts', () => {
  assert.throws(() => normalizeMediaSourceUrl('https://other.example/live.m3u8', 'camera.example'), /dieselbe Kamera-IP/);
  assert.equal(
    normalizeMediaSourceUrl('https://other.example/live.m3u8', 'camera.example', { allowExternalHost: true }),
    'https://other.example/live.m3u8',
  );
});


test('HTTP/HLS probing does not reconnect forever at EOF while long-running ingest still can', () => {
  const url = 'https://video.example/live/index.m3u8';
  const probeArgs = buildProbeArgs(url, 'hls');
  const ingestArgs = buildMediaInputArgs(url, 'hls');
  assert.ok(probeArgs.includes('-reconnect_streamed'));
  assert.ok(!probeArgs.includes('-reconnect_at_eof'));
  assert.ok(ingestArgs.includes('-reconnect_at_eof'));
});
