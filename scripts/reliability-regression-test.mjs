import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chooseMotionComparison, compareMotionFrames, pushMotionWindow, selectMotionBaseline, summarizeMotionWindow } from '../backend/src/services/recording/MotionDetectionAlgorithm.js';
import { evaluateRecordingPlans, normalizeRecordingPlan } from '../backend/src/services/recording/RecordingSchedule.js';
import { CameraTaskCancelledError, PerCameraTaskQueue } from '../backend/src/services/runtime/CameraTaskQueue.js';
import { PtzAutomationInterlock } from '../backend/src/services/runtime/PtzAutomationInterlock.js';
import { classifyHostFingerprint, hasCameraIdentityText } from '../backend/src/services/media/CameraHostClassifier.js';
import { isSafeSsdpLocation } from '../backend/src/services/media/DiscoveryUrlSafety.js';
import { prepareMediaReadSource } from '../backend/src/services/media/MediaReadAuth.js';
import {
  mediaServiceCandidates,
  mergeOnvifProfiles,
  profilesFromSoap,
} from '../backend/src/services/onvif/profileDiscovery.js';
import {
  profilesForService,
  snapshotUriForService,
  streamUriForService,
} from '../backend/src/services/onvif/mediaSoap.js';
import {
  buildRecordingArgs,
  nextRecordingSegmentNumber,
  waitForRecordingStartup,
} from '../backend/src/services/recording/RecordingCommand.js';
import { buildKioskCameraStatus, summarizeKioskStatus } from '../frontend/src/services/kioskStatus.js';
import { isRecoverableInitialRecordingFailure, recordingRecoveryDecision } from '../backend/src/services/recording/RecordingRecoveryPolicy.js';

const checks = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => checks.push(name));
}


await check('camera-task-queue-priority-and-serialization', async () => {
  const queue = new PerCameraTaskQueue({ name: 'regression', maxPending: 5 });
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = queue.enqueue('cam-1', async () => { order.push('first-start'); await firstGate; order.push('first-end'); return 'first'; }, { priority: 1, type: 'first' });
  await Promise.resolve();
  const low = queue.enqueue('cam-1', async () => { order.push('low'); return 'low'; }, { priority: 1, type: 'low' });
  const high = queue.enqueue('cam-1', async () => { order.push('high'); return 'high'; }, { priority: 50, type: 'high' });
  releaseFirst();
  assert.equal(await first, 'first');
  assert.equal(await high, 'high');
  assert.equal(await low, 'low');
  assert.deepEqual(order, ['first-start', 'first-end', 'high', 'low']);
});


await check('camera-task-queue-coalesces-pending-ptz-moves', async () => {
  const queue = new PerCameraTaskQueue({ name: 'coalesce-regression', maxPending: 10 });
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = queue.enqueue('cam-1', async () => { await gate; return 'first'; }, { type: 'first', priority: 1 });
  await Promise.resolve();
  const replaced = queue.enqueue('cam-1', async () => 'old-move', { type: 'move', priority: 1, coalesceKey: 'continuous-move' });
  const latest = queue.enqueue('cam-1', async () => 'latest-move', { type: 'move', priority: 1, coalesceKey: 'continuous-move' });
  await assert.rejects(replaced, CameraTaskCancelledError);
  releaseFirst();
  assert.equal(await first, 'first');
  assert.equal(await latest, 'latest-move');
  assert.equal(queue.stats('cam-1').cancelled, 1);
});


await check('recording-initial-start-failure-enters-recovery', () => {
  assert.equal(isRecoverableInitialRecordingFailure(new Error('FFmpeg startup media timeout')), true);
  const persistent = recordingRecoveryDecision({
    triggerType: 'continuous',
    outageSeconds: 600,
    reconnectAttempts: 50,
    maxOutageSeconds: 180,
    maxReconnectAttempts: 30,
  });
  assert.equal(persistent.terminal, false);
  const event = recordingRecoveryDecision({
    triggerType: 'event',
    outageSeconds: 181,
    reconnectAttempts: 5,
    maxOutageSeconds: 180,
    maxReconnectAttempts: 30,
  });
  assert.equal(event.terminal, true);
});

await check('kiosk-status-motion-and-continuous-recording-badges', () => {
  const now = Date.parse('2026-07-24T12:00:10.000Z');
  const status = buildKioskCameraStatus({
    motion: { cameras: [{ cameraId: 'cam-1', motionActive: false, lastDetectedAt: '2026-07-24T12:00:02.000Z' }] },
    activeRecordings: [{ id: 10, cameraId: 'cam-1', triggerType: 'continuous', startedAt: '2026-07-24T11:00:00.000Z' }],
  }, now);
  assert.equal(status['cam-1'].motionActive, true);
  assert.equal(status['cam-1'].continuousRecording, true);
  assert.deepEqual(summarizeKioskStatus(status), { motionCount: 1, recordingCount: 1, continuousRecordingCount: 1 });
});

await check('ptz-interlock-blocks-recording-and-rejects-competing-controller', () => {
  const interlock = new PtzAutomationInterlock({ disableSweep: true, settleMs: 0 });
  try {
    const permit = interlock.acquireAutomaticPermit('cam-ptz', { eventId: 'event-before-ptz' });
    interlock.begin('cam-ptz', { interactionId: 'interaction-user-a', userId: 'user-a', clientId: 'tab-a', sequence: 1 });
    assert.throws(
      () => interlock.begin('cam-ptz', { interactionId: 'interaction-user-b', userId: 'user-b', clientId: 'tab-b', sequence: 1 }),
      (error) => error.code === 'PTZ_BUSY',
    );
    assert.throws(() => permit.assert('before-spawn'), (error) => error.code === 'AUTOMATIC_RECORDING_SUPPRESSED_PTZ');
    interlock.end('cam-ptz', { interactionId: 'interaction-user-a', userId: 'user-a', clientId: 'tab-a', reason: 'stop' });
    assert.equal(interlock.isBlocked('cam-ptz'), false);
  } finally { interlock.shutdown(); }
});

await check('motion-local-object', () => {
  const width = 32;
  const height = 18;
  const before = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) before[y * width + x] = (x * 7 + y * 11 + (x * y) % 31) % 180 + 30;
  }
  const after = Buffer.from(before);
  for (let y = 6; y < 12; y += 1) {
    for (let x = 12; x < 20; x += 1) after[y * width + x] = 245;
  }
  const result = compareMotionFrames(before, after, {
    width,
    height,
    pixelThreshold: 10,
    minChangedRatio: 0.008,
    minAverageDiff: 0.6,
    minChangedPixels: 18,
    maxShiftPixels: 1,
    compensateBrightness: true,
  });
  assert.equal(result.motion, true);
  assert.ok(result.activeRegions > 0);
});

await check('motion-global-brightness', () => {
  const result = compareMotionFrames(Buffer.alloc(96, 30), Buffer.alloc(96, 65), {
    width: 12,
    height: 8,
    pixelThreshold: 10,
    minChangedRatio: 0.01,
    minAverageDiff: 1,
    minChangedPixels: 2,
    compensateBrightness: true,
  });
  assert.equal(result.motion, false);
  assert.ok(Math.abs(result.globalBrightnessShift - 35) < 0.001);
});

await check('motion-one-pixel-jitter', () => {
  const width = 16;
  const height = 10;
  const before = Buffer.alloc(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 2; x += 1) before[y * width + x] = (x * 13 + y * 7) % 255;
  }
  const after = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) after[y * width + x + 1] = before[y * width + x];
  }
  const result = compareMotionFrames(before, after, {
    width,
    height,
    pixelThreshold: 8,
    minChangedRatio: 0.01,
    minAverageDiff: 1,
    minChangedPixels: 2,
    maxShiftPixels: 1,
  });
  assert.equal(result.motion, false);
  assert.equal(result.alignmentX, 1);
});



await check('motion-resettable-sliding-window', () => {
  let window = [];
  window = pushMotionWindow(window, false, 4);
  window = pushMotionWindow(window, true, 4);
  window = pushMotionWindow(window, true, 4);
  assert.equal(summarizeMotionWindow(window, 2).active, true);
  window = pushMotionWindow(window, false, 4);
  window = pushMotionWindow(window, false, 4);
  window = pushMotionWindow(window, false, 4);
  assert.equal(summarizeMotionWindow(window, 2).active, false);
  window = pushMotionWindow(window, true, 4);
  window = pushMotionWindow(window, true, 4);
  assert.equal(summarizeMotionWindow(window, 2).active, true);
});

await check('motion-reference-does-not-latch-active-event', () => {
  const quiet = { motion: false, changedRatio: 0, averageDiff: 0, changedPixels: 0, reason: 'below-threshold' };
  const reference = { motion: true, changedRatio: 0.06, averageDiff: 6, changedPixels: 64, reason: 'motion' };
  assert.equal(chooseMotionComparison(quiet, reference, { motionActive: false }).comparisonBasis, 'stable-reference');
  const active = chooseMotionComparison(quiet, reference, { motionActive: true });
  assert.equal(active.motion, false);
  assert.equal(active.comparisonBasis, 'previous-frame');
});

await check('motion-source-change-baseline', () => {
  const frame = Buffer.alloc(20, 10);
  assert.deepEqual(selectMotionBaseline(frame, 'live-rtsp|a', 'live-hls|a'), { frame: null, sourceChanged: true });
  assert.deepEqual(selectMotionBaseline(frame, 'live-rtsp|a', 'live-rtsp|a'), { frame, sourceChanged: false });
});

await check('motion-frame-size-guard', () => {
  const result = compareMotionFrames(Buffer.alloc(20), Buffer.alloc(19), { width: 5, height: 4 });
  assert.equal(result.motion, false);
  assert.equal(result.reason, 'frame-size-mismatch');
});

await check('discovery-rejects-brand-only-vigi', () => {
  assert.equal(hasCameraIdentityText('TP-Link VIGI Business Surveillance'), false);
  assert.equal(hasCameraIdentityText('TP-Link VIGI IP Camera C540'), true);
});

await check('discovery-rejects-rtsp-only', () => {
  const result = classifyHostFingerprint({
    openPorts: [554],
    rtspServices: [{ port: 554, confirmed: true }],
  });
  assert.equal(result.candidate, false);
  assert.equal(result.likelyCamera, false);
  assert.equal(result.rtspOnly, true);
});

await check('discovery-rejects-generic-media-server', () => {
  const result = classifyHostFingerprint({
    openPorts: [80, 554],
    pages: [{
      statusCode: 200,
      url: 'http://192.168.1.90/',
      headers: { server: 'nginx' },
      body: '<html><title>go2rtc streaming server</title><p>RTSP proxy</p></html>',
    }],
    rtspServices: [{ port: 554, confirmed: true }],
  });
  assert.equal(result.candidate, false);
  assert.equal(result.likelyCamera, false);
});

await check('discovery-keeps-camera-fingerprint', () => {
  const result = classifyHostFingerprint({
    openPorts: [80, 554, 8000],
    pages: [{
      statusCode: 200,
      url: 'http://192.168.1.86/ISAPI/System/deviceInfo',
      headers: { 'content-type': 'application/xml' },
      body: '<DeviceInfo><deviceName>Network Camera</deviceName><model>DS-2CD2385FWD-I</model></DeviceInfo>',
    }],
    rtspServices: [{ port: 554, confirmed: true }],
  });
  assert.equal(result.candidate, true);
  assert.equal(result.verified, true);
});

await check('ssdp-location-ssrf-guard', () => {
  assert.equal(isSafeSsdpLocation('http://192.168.1.20:8080/device.xml', '192.168.1.20'), true);
  assert.equal(isSafeSsdpLocation('http://192.168.1.21/device.xml', '192.168.1.20'), false);
  assert.equal(isSafeSsdpLocation('http://203.0.113.10/device.xml', '203.0.113.10'), false);
  assert.equal(isSafeSsdpLocation('http://user:pass@192.168.1.20/device.xml', '192.168.1.20'), false);
  assert.equal(isSafeSsdpLocation('file:///etc/passwd', '192.168.1.20'), false);
  assert.equal(isSafeSsdpLocation('http://camera.local/device.xml', '192.168.1.20'), false);
});


await check('onvif-all-media-profiles', () => {
  const media1Data = [{ getProfilesResponse: [{ profiles: [
    { $: { token: 'MainStreamProfileToken' }, name: ['MainStreamProfile'], videoEncoderConfiguration: [{ encoding: ['H264'], resolution: [{ width: ['1920'], height: ['1080'] }], H264: [{ H264Profile: ['Main'] }] }] },
    { $: { token: 'SecondStreamProfileToken' }, name: ['SecondStreamProfile'], videoEncoderConfiguration: [{ encoding: ['H264'], resolution: [{ width: ['640'], height: ['352'] }], H264: [{ H264Profile: ['Main'] }] }] },
  ] }] }];
  const media2Data = [{ getProfilesResponse: [{ profiles: [
    { $: { token: 'H265MainProfileToken' }, name: ['H265MainProfile'], configurations: [{ videoEncoder: [{ $: { token: 'H265Encoder' } }] }] },
  ] }] }];
  const encoderData = [{ getVideoEncoderConfigurationsResponse: [{ configurations: [
    { $: { token: 'H265Encoder', Encoding: 'H265', Profile: 'Main' }, resolution: [{ $: { Width: '2688', Height: '1520' } }], rateControl: [{ $: { FrameRateLimit: '25', BitrateLimit: '4096' } }] },
  ] }] }];
  const profiles = mergeOnvifProfiles(
    profilesFromSoap(media1Data, 'media'),
    profilesFromSoap(media2Data, 'media2', encoderData),
  );
  assert.deepEqual(profiles.map((profile) => profile.token), ['MainStreamProfileToken', 'SecondStreamProfileToken', 'H265MainProfileToken']);
  assert.deepEqual(profiles[2], {
    token: 'H265MainProfileToken', name: 'H265MainProfile', videoCodec: 'H265', videoProfile: 'Main', audioCodec: null,
    width: 2688, height: 1520, fps: 25, bitrate: 4096, hasPtz: false, mediaService: 'media2',
  });
});

await check('onvif-vendor-field-variants', () => {
  const profiles = profilesFromSoap(
    [{ GetProfilesResponse: [{ Profile: [{
      $: { Token: 'vendor-hevc' }, Name: ['Vendor HEVC'],
      Configurations: [{ VideoEncoder: [{ $: { Token: 'vendor-encoder' }, Resolution: [{ $: { Width: '2304' } }] }] }],
    }] }] }],
    'media2',
    [{ GetVideoEncoderConfigurationResponse: [{ Configuration: [{
      $: { Token: 'vendor-encoder', Encoding: 'HEVC', Profile: 'Main10' },
      resolution: [{ $: { Width: '1920', Height: '1296' } }],
    }] }] }],
  );
  assert.deepEqual(profiles.map(({ token, videoCodec, videoProfile, width, height, mediaService }) => ({ token, videoCodec, videoProfile, width, height, mediaService })), [{
    token: 'vendor-hevc', videoCodec: 'H265', videoProfile: 'Main 10', width: 2304, height: 1296, mediaService: 'media2',
  }]);
});

await check('onvif-same-resolution-profiles-remain-separate', () => {
  const profiles = mergeOnvifProfiles(
    [{ token: 'h264-token', name: 'Main', videoCodec: 'H264', width: 1920, height: 1080, mediaService: 'media' }],
    [{ token: 'h265-token', name: 'Main', videoCodec: 'H265', width: 1920, height: 1080, mediaService: 'media2' }],
  );
  assert.equal(profiles.length, 2);
});

await check('onvif-token-dedup-merges-media-services', () => {
  const profiles = mergeOnvifProfiles(
    [{ token: 'shared', name: 'Main', videoCodec: 'H264', hasPtz: true, mediaService: 'media' }],
    [{ token: 'shared', name: 'Main HEVC', videoCodec: 'H265', videoProfile: 'Main 10', width: 3840, height: 2160, mediaService: 'media2' }],
  );
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].videoCodec, 'H265');
  assert.equal(profiles[0].mediaService, 'both');
  assert.equal(profiles[0].hasPtz, true);
});

await check('onvif-profile-origin-routes-media-service', () => {
  assert.deepEqual(mediaServiceCandidates('media2', false), ['media2', 'media']);
  assert.deepEqual(mediaServiceCandidates('media', true), ['media', 'media2']);
  assert.deepEqual(mediaServiceCandidates('auto', true), ['media2', 'media']);
});


await check('onvif-media2-soap-profile-enrichment', async () => {
  const calls = [];
  const cam = {
    uri: { media2: {} },
    _envelopeHeader: () => '<Envelope><Body>',
    _envelopeFooter: () => '</Body></Envelope>',
    _request({ service, body }, callback) {
      calls.push({ service, body });
      if (body.includes('GetVideoEncoderConfigurations')) {
        callback(null, [{ getVideoEncoderConfigurationsResponse: [{ configurations: [{
          $: { token: 'encoder-hevc', Encoding: 'H265', Profile: 'Main' },
          resolution: [{ $: { Width: '2560', Height: '1440' } }],
        }] }] }]);
        return;
      }
      callback(null, [{ getProfilesResponse: [{ profiles: [{
        $: { token: 'profile-hevc' }, name: ['HEVC Main'],
        configurations: [{ videoEncoder: [{ $: { token: 'encoder-hevc' } }] }],
      }] }] }]);
    },
  };
  const profiles = await profilesForService(cam, 'media2');
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].videoCodec, 'H265');
  assert.equal(profiles[0].width, 2560);
  assert.ok(calls.every((call) => call.service === 'media2'));
});

await check('onvif-media2-soap-uri-routing', async () => {
  const calls = [];
  const cam = {
    _envelopeHeader: () => '<Envelope><Body>',
    _envelopeFooter: () => '</Body></Envelope>',
    _request({ service, body }, callback) {
      calls.push({ service, body });
      if (body.includes('GetStreamUri')) callback(null, [{ getStreamUriResponse: [{ uri: ['rtsp://192.0.2.20/hevc'] }] }]);
      else callback(null, [{ getSnapshotUriResponse: [{ uri: ['http://192.0.2.20/hevc.jpg'] }] }]);
    },
  };
  assert.equal(await streamUriForService(cam, 'media2', 'profile&hevc', 'TCP'), 'rtsp://192.0.2.20/hevc');
  assert.equal(await snapshotUriForService(cam, 'media2', 'profile&hevc'), 'http://192.0.2.20/hevc.jpg');
  assert.ok(calls.every((call) => call.service === 'media2'));
  assert.match(calls[0].body, /<Protocol>RTSP<\/Protocol>/);
  assert.match(calls[0].body, /profile&amp;hevc/);
});

await check('media-read-auth', () => {
  const rtsp = prepareMediaReadSource('rtsp://127.0.0.1:8554/camera/stream', 'secret-token');
  assert.equal(new URL(rtsp.uri).searchParams.get('token'), null);
  assert.equal(rtsp.displayUri.includes('secret-token'), false);
  const hls = prepareMediaReadSource('http://127.0.0.1:8888/camera/stream/index.m3u8', 'secret-token');
  assert.deepEqual(hls.inputArgs, ['-headers', 'Authorization: Bearer secret-token\r\n']);
  assert.equal(hls.uri.includes('secret-token'), false);
  const busted = prepareMediaReadSource('http://127.0.0.1:8888/live/index.m3u8?token=x&_motion=1&_live=2&_ts=3&keep=ok');
  assert.equal(busted.displayUri, 'http://127.0.0.1:8888/live/index.m3u8?keep=ok');
});

await check('recording-command-auth-and-numbering', () => {
  const rtspArgs = buildRecordingArgs({
    sourceUri: 'rtsp://127.0.0.1:8554/camera/stream',
    mediaToken: 'secret-token',
    segmentPattern: '/tmp/block-%06d.ts.partial',
    segmentStartNumber: 8,
  });
  const inputAt = rtspArgs.indexOf('-i');
  assert.ok(inputAt > 0);
  assert.equal(new URL(rtspArgs[inputAt + 1]).searchParams.get('token'), null);
  assert.equal(nextRecordingSegmentNumber({ blockCounter: 5, segmentIndexes: [2, 8, 7] }), 9);
});

await check('recording-startup-requires-media', async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  let sizeBytes = 0;
  setTimeout(() => { sizeBytes = 1880; }, 30);
  setTimeout(() => { sizeBytes = 4096; }, 75);
  const result = await waitForRecordingStartup({
    child,
    startIndex: 4,
    minimumBytes: 1880,
    timeoutMs: 500,
    pollIntervalMs: 15,
    settleMs: 40,
    inspect: () => [{ index: 4, sizeBytes }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.file.index, 4);
});

await check('recording-startup-rejects-empty-process', async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  const result = await waitForRecordingStartup({
    child,
    startIndex: 1,
    minimumBytes: 1880,
    timeoutMs: 120,
    pollIntervalMs: 20,
    settleMs: 20,
    inspect: () => [],
  });
  assert.equal(result.ok, false);
  assert.match(result.error.message, /keine Mediendaten/);
});

console.log(JSON.stringify({ result: 'ok', checks: checks.length, covered: checks }, null, 2));
