import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { allowedProxyRequest } from '../src/services/remoteProxyPolicy.js';
import { buildLocalHlsRingArgs, ffprobeHasAacStream } from '../src/services/media/FfmpegCommand.js';

const orchestrator = readFileSync(new URL('../src/services/media/StreamOrchestrator.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/routes/streams.js', import.meta.url), 'utf8');
const localPlayer = readFileSync(new URL('../../frontend/src/components/SeamlessLivePlayer.jsx', import.meta.url), 'utf8');
const pool = readFileSync(new URL('../../frontend/src/services/liveStreamPool.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../frontend/src/pages/LivePage.jsx', import.meta.url), 'utf8');
const recordingCommand = readFileSync(new URL('../src/services/recording/RecordingCommand.js', import.meta.url), 'utf8');

test('only a customer-initiated live-audio request can create the optional audio branch', () => {
  assert.equal(allowedProxyRequest('POST', '/api/streams/camera_1/cloud-audio'), true);
  assert.equal(allowedProxyRequest('POST', '/api/streams/camera_1/cloud-audio?token=abc'), false);
  assert.equal(allowedProxyRequest('POST', '/api/streams/camera_1/session'), false);
  assert.match(orchestrator, /'live-audio', 'kiosk'/);
  assert.match(orchestrator, /session\.purpose === 'live-audio'/);
  assert.match(orchestrator, /const activeAudioName = paths\.audio/);
  assert.match(orchestrator, /optionalAudioSource\(paths\.raw, 20, encoder, profile\?\.videoCodec\)/);
  assert.doesNotMatch(orchestrator, /wantsMicrophoneOnly/);
  assert.match(orchestrator, /const videoOnlyPreview = session\.permanent/);
  assert.match(routes, /quality: 'high', viewportWidth: 1280, purpose: 'live-audio'/);
  assert.ok(routes.indexOf("streamsRouter.post('/:id/cloud-audio'") > routes.indexOf('streamsRouter.use(authenticate)'));
});

test('AAC detection accepts duplicated FFprobe MPEG-TS program/stream lines', () => {
  // A real TS segment may produce two identical audio codec lines. The old
  // exact-output comparison incorrectly marked these playable streams silent.
  assert.equal(ffprobeHasAacStream('aac'), true);
  assert.equal(ffprobeHasAacStream('aac\\naac'.replaceAll('\\n', '\n')), true);
  assert.equal(ffprobeHasAacStream('codec_name=aac\naac\n'), true);
  assert.equal(ffprobeHasAacStream('  AAC \r\n  aac\n'), true);
  assert.equal(ffprobeHasAacStream(''), false);
  assert.equal(ffprobeHasAacStream('pcm_alaw\nopus\n'), false);
  assert.equal(ffprobeHasAacStream('not_aac\n'), false);
  assert.match(orchestrator, /ffprobeHasAacStream\(stdout\)/);
  assert.match(orchestrator, /LOCAL_HLS_AUDIO_VERIFIED/);
});

test('real MPEG-TS FFprobe output with AAC is recognized (when FFmpeg is available)', (t) => {
  const encoder = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', timeout: 3000 });
  const analyzer = spawnSync('ffprobe', ['-version'], { encoding: 'utf8', timeout: 3000 });
  if (encoder.error || analyzer.error || encoder.status !== 0 || analyzer.status !== 0) {
    t.skip('FFmpeg/FFprobe unavailable in this test environment');
    return;
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'camera-aac-probe-'));
  try {
    const file = path.join(dir, 'sample.ts');
    const ffmpeg = spawnSync('ffmpeg', [
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000',
      '-t', '2', '-c:v', 'mpeg2video', '-c:a', 'aac',
      '-ar', '48000', '-f', 'mpegts', file,
    ], { encoding: 'utf8', timeout: 15000 });
    assert.equal(ffmpeg.status, 0, ffmpeg.stderr || 'Could not create A/V MPEG-TS');
    const probe = spawnSync('ffprobe', [
      '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name',
      '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ], { encoding: 'utf8', timeout: 10000 });
    assert.equal(probe.status, 0, probe.stderr || 'FFprobe failed');
    assert.ok(probe.stdout.includes('aac'), 'Generated A/V MPEG-TS must include AAC');
    assert.equal(ffprobeHasAacStream(probe.stdout), true, JSON.stringify(probe.stdout));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('audio availability is based on verified AAC in completed HLS segments', () => {
  assert.match(orchestrator, /'a:0'.*'stream=codec_name'/s);
  assert.match(orchestrator, /verifiedAudioCodec = 'aac'/);
  assert.match(orchestrator, /session\.audioEnabled = Boolean\(verifiedAudioCodec\)/);
  assert.match(orchestrator, /audioEnabled: Boolean\(session\.audioEnabled\)/);
  assert.match(pool, /hasAudio: Boolean\(session\.audioEnabled\)/);
  const args = buildLocalHlsRingArgs({
    sourceUri: 'http://mediamtx:1984/api/stream.ts?src=cam_audio',
    outputDir: '/data/live/cam_audio',
    includeAudio: true,
  });
  assert.ok(args.includes('0:a:0?'));
  assert.ok(args.includes('copy'));
  assert.ok(!args.includes('-an'));
  // Recording-compatible A/V path is a synchronized single input; no ADTS
  // rendezvous, and the mapping still includes both H264 and AAC.
  assert.equal(args.filter((item) => item === '-i').length, 1);
  assert.ok(args.includes('0:v:0'));
  assert.ok(args.includes('0:a:0?'));
  assert.ok(!args.includes('1:a:0?'));
  const dual = buildLocalHlsRingArgs({
    sourceUri: 'http://mediamtx:1984/api/stream.ts?src=cam_video',
    audioSourceUri: 'http://mediamtx:1984/api/stream.aac?src=cam_audio',
    outputDir: '/data/live/cam_audio',
    includeAudio: true,
  });
  assert.equal(dual.filter((arg) => arg === '-i').length, 2);
  assert.ok(dual.includes('0:v:0'));
  assert.ok(dual.includes('1:a:0?'));
  assert.ok(!dual.includes('0:a:0?'));
  // Live audio uses the same video+AAC producer that recording FFmpeg reads.
  // Only one go2rtc MPEG-TS input is needed for its HLS player.
  assert.match(orchestrator, /session\.purpose === 'live-audio'[\s\S]*await startRing\(broker\.audioBrokerName, true\)/);
  assert.match(orchestrator, /startRing\(broker\.video, true, broker\.audioBrokerName\)/);
  assert.match(orchestrator, /sharedWithRecording: true/);
  assert.match(orchestrator, /session\.paths\.recording = ring\.includeAudio/);
  assert.match(orchestrator, /\? broker\.audio/);
  assert.match(recordingCommand, /'-map', '0:v:0', '-map', '0:a:0\?'/);
  assert.match(orchestrator, /existing\.audioConfigured = true/);
  assert.match(orchestrator, /session\.purpose !== 'live-audio'/);
  assert.match(orchestrator, /checkedAudioSegments/);
  assert.match(orchestrator, /audioProbeDeadline/);
  const noAudio = buildLocalHlsRingArgs({
    sourceUri: 'http://mediamtx:1984/api/stream.ts?src=cam_video',
    outputDir: '/data/live/cam_video',
    includeAudio: false,
  });
  assert.ok(noAudio.includes('-an'));
});

test('local live speaker requests new session and original kiosk/preview stays muted', () => {
  assert.match(localPlayer, /purpose: 'live-audio'/);
  assert.match(localPlayer, /audioHostRef/);
  assert.match(localPlayer, /setAudioQuality\('high'\)/);
  assert.match(localPlayer, /setAudioRequested\(true\)/);
  assert.match(localPlayer, /audioHandleRef\.current\?\.setMuted\(nextMuted\)/);
  assert.doesNotMatch(localPlayer, /disabled=\{status\.hasAudio === false\}/);
  assert.doesNotMatch(page, /Audio wird für die stabile Browseransicht deaktiviert/);
  assert.match(pool, /if \(!muted\) entry\.video\.play/);
  assert.match(pool, /return purpose === 'live' && quality === 'auto' && !profileToken/);
});
