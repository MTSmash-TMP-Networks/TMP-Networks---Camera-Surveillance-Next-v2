import test from 'node:test';
import assert from 'node:assert/strict';
import {
  brokerStreamPaths,
  nativeBrokerSource,
  normalizedVideoSource,
  optionalAudioSource,
  profileMedia,
  normalizedBrokerPolicy,
} from '../src/services/media/BrokerPipeline.js';

test('native RTSP broker source keeps all media for downstream broker consumers', () => {
  const value = nativeBrokerSource('rtsp://user:secret@192.0.2.10/live', 'tcp', 20);
  assert.equal(value, 'rtsp://user:secret@192.0.2.10/live#transport=tcp#timeout=20#backchannel=0');
});

test('UDP is preserved only when explicitly requested', () => {
  assert.match(nativeBrokerSource('rtsp://camera/live', 'udp'), /#transport=udp#/);
  assert.match(nativeBrokerSource('rtsp://camera/live', 'http'), /#transport=tcp#/);
});

test('normalized stream consumes the raw stream name', () => {
  assert.equal(normalizedVideoSource('cam_1_raw'), 'ffmpeg:cam_1_raw#video=h264#timeout=20');
});

test('optional audio stream is isolated from the stable video-only path', () => {
  assert.equal(optionalAudioSource('cam_1_raw'), 'ffmpeg:cam_1_raw#video=h264#audio=aac#timeout=20');
  assert.doesNotMatch(normalizedVideoSource('cam_1_raw'), /audio=/);
});

test('broker paths are stable and credentials do not affect identity', () => {
  const a = brokerStreamPaths('camera-1', { token: 'main' }, { uri: 'rtsp://a:b@camera/live' });
  const b = brokerStreamPaths('camera-1', { token: 'main' }, { uri: 'rtsp://x:y@camera/live' });
  assert.deepEqual(a, b);
  assert.match(a.raw, /_raw$/);
  assert.match(a.video, /_video$/);
});

test('profile metadata replaces camera ffprobe as non-blocking diagnostics', () => {
  const media = profileMedia({ videoCodec: 'H264', videoProfile: 'Main', width: 1920, height: 1080, fps: 25, audioCodec: 'G711' });
  assert.equal(media.video.codec, 'h264');
  assert.equal(media.video.width, 1920);
  assert.equal(media.audio.codec, 'g711');
  const policy = normalizedBrokerPolicy({ videoCodec: 'H264', videoProfile: 'Main' });
  assert.equal(policy.outputVideoCodec, 'h264');
  assert.equal(policy.transcodeVideo, true);
});


test('Intel VAAPI is opt-in for broker encoder and has unchanged CPU fallback path', () => {
  assert.equal(normalizedVideoSource('cam_1_raw', 20, 'vaapi'), 'ffmpeg:cam_1_raw#video=h264#timeout=20#hardware=vaapi');
  assert.equal(optionalAudioSource('cam_1_raw', 20, 'vaapi'), 'ffmpeg:cam_1_raw#video=h264#audio=aac#timeout=20#hardware=vaapi');
  assert.equal(normalizedVideoSource('cam_1_raw', 20, 'none'), normalizedVideoSource('cam_1_raw'));
  assert.doesNotMatch(normalizedVideoSource('cam_1_raw', 20, 'unknown'), /hardware=/);
});
