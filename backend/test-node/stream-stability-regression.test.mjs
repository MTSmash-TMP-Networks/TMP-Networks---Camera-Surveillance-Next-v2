import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const compression = readFileSync(resolve(root, 'backend/src/services/recording/RecordingCompressionService.js'), 'utf8');
const config = readFileSync(resolve(root, 'backend/src/config.js'), 'utf8');
const ptzBackend = readFileSync(resolve(root, 'backend/src/services/ptz/PtzService.js'), 'utf8');
const orchestrator = readFileSync(resolve(root, 'backend/src/services/media/StreamOrchestrator.js'), 'utf8');
const ptzFrontend = readFileSync(resolve(root, 'frontend/src/components/PtzControls.jsx'), 'utf8');
const livePool = readFileSync(resolve(root, 'frontend/src/services/liveStreamPool.js'), 'utf8');
const player = readFileSync(resolve(root, 'frontend/src/components/SeamlessLivePlayer.jsx'), 'utf8');
const ffmpegCommand = readFileSync(resolve(root, 'backend/src/services/media/FfmpegCommand.js'), 'utf8');
const hlsPlayer = readFileSync(resolve(root, 'frontend/src/services/hlsPlayer.js'), 'utf8');
const livePage = readFileSync(resolve(root, 'frontend/src/pages/LivePage.jsx'), 'utf8');

test('compression backfill cannot bypass the configured startup delay', () => {
  assert.match(compression, /this\.backfill\(\{ schedule: false \}\)/);
  assert.match(compression, /this\.schedule\(config\.recordingCompressionStartDelayMs\)/);
  assert.doesNotMatch(compression, /if \(config\.recordingCompressionBackfill\) this\.backfill\(\);\s*this\.schedule/);
});

test('compression yields to stream recovery and PTZ but can process finalized blocks during active recordings', () => {
  assert.match(compression, /streamOrchestrator\.compressionActivity\(\)/);
  assert.match(compression, /ptzAutomationInterlock\.status\(\)/);
  assert.match(compression, /r\.status IN \('recording','ready','ready_with_gaps'\)/);
  assert.doesNotMatch(compression, /SELECT id,camera_id FROM recordings WHERE status='recording'/);
  assert.match(compression, /os\.setPriority/);
  assert.match(compression, /RECORDING_COMPRESSION_DEFERRED/);
  assert.match(config, /Math\.max\(120_000, integer\('RECORDING_COMPRESSION_START_DELAY_MS', 120000/);
  assert.match(config, /Math\.max\(15_000, integer\('UPDATER_HEALTH_TIMEOUT_MS', 15_000/);
  assert.match(config, /RECORDING_COMPRESSION_MAX_LOAD_RATIO', 0\.75/);
});

test('PTZ movement is independent from browser stream recovery', () => {
  assert.doesNotMatch(ptzBackend, /recoverCamera\(cameraId, 'ptz-preflight'\)/);
  assert.doesNotMatch(ptzFrontend, /await liveStreamPool\.prepareForControl/);
  assert.doesNotMatch(ptzFrontend, /then\(\(\) => liveStreamPool\.prepareForControl/);
  assert.match(ptzFrontend, /A frozen player must never delay or/);
});

test('post-PTZ publisher recovery requires the normal stall threshold', () => {
  assert.match(orchestrator, /thresholdMs = Math\.max\(config\.streamStallSeconds \* 1000/);
  assert.match(orchestrator, /session\.controlVerifyPromise/);
  assert.match(orchestrator, /if \(staleForMs < thresholdMs\) return false/);
});

test('permanent ingest is a low-cost preview publisher', () => {
  assert.match(config, /PERMANENT_CAMERA_INGEST_ENABLED', true/);
  assert.match(config, /PERMANENT_CAMERA_INGEST_QUALITY', 'low'/);
  assert.match(config, /PERMANENT_CAMERA_INGEST_PROFILE', 'auto-substream'/);
  assert.match(config, /PERMANENT_CAMERA_INGEST_VIDEO_MODE', 'force-copy'/);
  assert.match(orchestrator, /return `cam_\$\{cameraPart\}_preview`/);
  assert.match(orchestrator, /GO2RTC_RAW_SOURCE_CONFIGURED/);
  assert.match(orchestrator, /GO2RTC_NORMALIZED_SOURCE_CONFIGURED/);
  assert.match(orchestrator, /startPermanentIngestForAll/);
  assert.match(orchestrator, /startPermanentIngestForCamera/);
});

test('kiosk and motion prefer substream while live and recording prefer mainstream', () => {
  assert.match(config, /KIOSK_PREFER_SUBSTREAM', true/);
  assert.match(config, /LIVE_PREFER_MAINSTREAM', true/);
  assert.match(config, /RECORDING_PREFER_MAINSTREAM', true/);
  assert.match(config, /MOTION_PREFER_SUBSTREAM', true/);
  assert.match(orchestrator, /purpose === 'kiosk'.*return 'low'/s);
  assert.match(orchestrator, /purpose === 'live'.*return 'high'/s);
  assert.match(orchestrator, /purpose === 'recording'.*return 'high'/s);
  assert.match(orchestrator, /purpose === 'motion'.*return 'low'/s);
  assert.match(orchestrator, /permanentIngestProfile === 'auto-substream'\) return 'low'/);
  assert.match(orchestrator, /shared-substream-hls/);
  assert.match(orchestrator, /shared-mainstream-hls/);
  assert.match(orchestrator, /sharedMainstream/);
  assert.match(orchestrator, /'mainstream'/);
});

test('duplicate browser transcode sessions are disabled by default', () => {
  assert.match(config, /BROWSER_TRANSCODE_FALLBACK_ENABLED', false/);
  assert.match(livePool, /VITE_BROWSER_TRANSCODE_FALLBACK_ENABLED \|\| 'false'/);
  assert.match(livePool, /const attempts = TRANSCODE_FALLBACK && entry\.purpose !== 'kiosk' \? \[false, true\] : \[false\]/);
  assert.match(livePool, /await this\.connectSession\(entry, session, stale, forceTranscode\)/);
  assert.match(livePool, /waitForFrameProgress/);
});

test('audio stays enabled on direct and fallback paths', () => {
  assert.doesNotMatch(config, /PERMANENT_CAMERA_INGEST_AUDIO_MODE/);
  assert.match(ffmpegCommand, /libopus/);
  assert.match(ffmpegCommand, /aac/);
  assert.match(player, /Volume2|VolumeX/);
  assert.match(livePool, /hasAudio: Boolean\(session\.media\?\.audio\)/);
});

test('hidden browser-wide camera decoding is disabled by default', () => {
  assert.match(livePool, /VITE_STREAM_BROWSER_PREWARM_ENABLED \|\| 'false'/);
  assert.match(livePool, /if \(!PREWARM_ENABLED\) return/);
  assert.doesNotMatch(livePool, /VITE_STREAM_ALWAYS_ON/);
});


test('browser watchdog accepts WebRTC stats and media timeline progress', () => {
  assert.match(livePool, /function markTransportStatsProgress/);
  assert.match(livePool, /stats\.frameDelta|frameDelta/);
  assert.match(livePool, /byteDelta/);
  assert.match(livePool, /timelineAdvanced = current > entry\.lastCurrentTime/);
  assert.match(livePool, /lastProgressSource/);
});

test('backend watchdog uses go2rtc liveness and jittered restart backoff', () => {
  assert.match(config, /STREAM_HARD_STALL_SECONDS/);
  assert.match(config, /STREAM_BROKER_API_GRACE_MS/);
  assert.match(orchestrator, /refreshStreamBrokerLiveness/);
  assert.match(orchestrator, /STREAM_BROKER_LIVENESS_OK/);
  assert.match(orchestrator, /STREAM_BROKER_API_GRACE/);
  assert.match(orchestrator, /streamRestartJitterMs/);
  assert.match(orchestrator, /streamBrokerUnavailableRetryMs/);
});

test('local HLS bridge consumes the verified go2rtc HTTP MPEG-TS endpoint', () => {
  assert.match(orchestrator, /go2RtcClient\.streamTsUrl\(brokerName\)/);
  assert.match(orchestrator, /brokerInput: 'go2rtc-http-mpegts'/);
  assert.doesNotMatch(orchestrator, /const brokerReadUrl = `\$\{config\.go2RtcPublishBase/);
  assert.match(ffmpegCommand, /const isRtspInput =/);
  assert.match(ffmpegCommand, /isRtspInput \? \['-rtsp_transport', 'tcp'\] : \[\]/);
});



test('local HLS keeps a deep ring and browser playback stays behind the live edge', () => {
  assert.match(config, /LOCAL_HLS_LIST_SIZE', 30/);
  assert.match(config, /LOCAL_HLS_SEGMENT_SECONDS', 1/);
  assert.match(orchestrator, /listSize: config\.localHlsListSize/);
  assert.match(orchestrator, /segmentSeconds: config\.localHlsSegmentSeconds/);
  assert.match(ffmpegCommand, /listSize = 30/);
  assert.match(ffmpegCommand, /Math\.min\(120/);
  assert.match(hlsPlayer, /TARGET_LIVE_DELAY_SECONDS = 8/);
  assert.match(hlsPlayer, /MAX_LIVE_LATENCY_SECONDS = 20/);
  assert.match(hlsPlayer, /maxBufferLength: 30/);
  assert.match(hlsPlayer, /backBufferLength: 15/);
  assert.match(hlsPlayer, /lowLatencyMode: false/);
});

test('camera status suppresses false red indicators while another stream is healthy', () => {
  assert.match(orchestrator, /cameraHasHealthySession/);
  assert.match(orchestrator, /CAMERA_STATUS_ERROR_SUPPRESSED/);
  assert.match(orchestrator, /markCameraStreamError/);
  assert.match(livePage, /cameraRailState/);
  assert.match(livePage, /playbackState === 'ready'/);
  assert.match(livePage, /cameraStatus === 'stream_error'/);
});


test('kiosk never switches into a separate browser transcode fallback path', () => {
  assert.match(orchestrator, /browserTranscodeFallbackEnabled && consumerPurpose !== 'kiosk'/);
  assert.match(livePool, /TRANSCODE_FALLBACK && entry\.purpose !== 'kiosk'/);
});

test('encoder fallback remains pinned instead of retrying GPU on a timer', () => {
  assert.match(orchestrator, /stickyEncoderFailures/);
  assert.doesNotMatch(orchestrator, /encoderFailureCooldownMs/);
  assert.doesNotMatch(orchestrator, /encoderFailureCooldownMs/);
  assert.match(orchestrator, /const failedEncoders = this\.brokerEncoderFailures\.get\(failureKey\) \|\| new Map\(\)/);
  assert.match(orchestrator, /brokerEncoderFailures\.set\(failureKey, failedEncoders\)/);
});


test('mainstream failure can downgrade to a weaker profile and keep that profile sticky', () => {
  assert.match(orchestrator, /stableProfileToken/);
  assert.match(orchestrator, /STREAM_PROFILE_DOWNGRADED/);
  assert.match(orchestrator, /prioritizeStableProfile\(requestedFirst, session\.stableProfileToken\)/);
  assert.match(orchestrator, /requestedProfile && requestedProfile\.token !== profile\.token/);
  assert.match(orchestrator, /session\.quality === 'high' && profile\.role !== 'high'/);
});

test('failed source memory is isolated per ONVIF profile', () => {
  assert.match(orchestrator, /function candidateKey\(candidate, profileToken = null\)/);
  assert.match(orchestrator, /candidateKey\(attempt\.candidate, attempt\.profile\?\.token\)/);
  assert.match(orchestrator, /candidateKey\(candidate, profile\.token\)/);
});
