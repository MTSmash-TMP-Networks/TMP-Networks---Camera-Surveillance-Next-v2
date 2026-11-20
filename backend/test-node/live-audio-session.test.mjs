import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allowedProxyRequest } from '../src/services/remoteProxyPolicy.js';
import { buildLocalHlsRingArgs } from '../src/services/media/FfmpegCommand.js';

const orchestrator = readFileSync(new URL('../src/services/media/StreamOrchestrator.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/routes/streams.js', import.meta.url), 'utf8');
const localPlayer = readFileSync(new URL('../../frontend/src/components/SeamlessLivePlayer.jsx', import.meta.url), 'utf8');
const pool = readFileSync(new URL('../../frontend/src/services/liveStreamPool.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../frontend/src/pages/LivePage.jsx', import.meta.url), 'utf8');

test('only a customer-initiated live-audio request can create the optional audio branch', () => {
  assert.equal(allowedProxyRequest('POST', '/api/streams/camera_1/cloud-audio'), true);
  assert.equal(allowedProxyRequest('POST', '/api/streams/camera_1/cloud-audio?token=abc'), false);
  assert.equal(allowedProxyRequest('POST', '/api/streams/camera_1/session'), false);
  assert.match(orchestrator, /'live-audio', 'kiosk'/);
  assert.match(orchestrator, /session\.purpose === 'live-audio'/);
  assert.match(orchestrator, /wantsMicrophoneOnly \? existing\.microphoneConfigured : existing\.audioConfigured/);
  assert.match(orchestrator, /const videoOnlyPreview = session\.permanent/);
  assert.match(routes, /quality: 'high', viewportWidth: 1280, purpose: 'live-audio'/);
  assert.ok(routes.indexOf("streamsRouter.post('/:id/cloud-audio'") > routes.indexOf('streamsRouter.use(authenticate)'));
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
  const dual = buildLocalHlsRingArgs({
    sourceUri: 'http://mediamtx:1984/api/stream.ts?src=cam_video',
    audioSourceUri: 'http://mediamtx:1984/api/stream.ts?src=cam_audio',
    outputDir: '/data/live/cam_audio',
    includeAudio: true,
  });
  assert.equal(dual.filter((arg) => arg === '-i').length, 2);
  assert.ok(dual.includes('0:v:0'));
  assert.ok(dual.includes('1:a:0?'));
  assert.ok(!dual.includes('0:a:0?'));
  assert.match(orchestrator, /startRing\(broker\.video, true, broker\.audioBrokerName\)/);
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
