#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let assertions = 0;
function check(condition, message) { assert.ok(condition, message); assertions += 1; }
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions += 1; }
function source(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }

const identity = await import('../backend/src/services/CameraIdentity.js');
equal(identity.normalizeMacAddress('aa-bb-cc-dd-ee-ff'), 'AA:BB:CC:DD:EE:FF', 'MAC normalization');
equal(identity.normalizeMacAddress('00:00:00:00:00:00'), null, 'invalid all-zero MAC');
check(identity.identityMatch({ serialNumber: 'DS-2CD-1234' }, { serial_number: 'ds-2cd-1234' }), 'serial identity match');
check(identity.deviceIdentityKeys({ deviceUid: 'urn:uuid:ABCDEF-123456' }).includes('uid:abcdef-123456'), 'UUID normalization');

const schedule = await import('../backend/src/services/recording/RecordingSchedule.js');
const berlinPlan = {
  id: 'office', name: 'Office', mode: 'scheduled', timezone: 'Europe/Berlin', enabled: true,
  weekdays: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '16:00', includeDates: [], excludeDates: [],
  holidayPolicy: 'include', holidayDates: [], eventTypes: ['motion'], priority: 100, quality: 'balanced',
};
check(schedule.isPlanCalendarActive(berlinPlan, new Date('2026-07-20T07:00:00.000Z')), 'weekday schedule active');
check(!schedule.isPlanCalendarActive(berlinPlan, new Date('2026-07-20T17:00:00.000Z')), 'weekday schedule inactive after interval');
const overnight = { ...berlinPlan, weekdays: [1], startTime: '22:00', endTime: '06:00' };
check(schedule.isPlanCalendarActive(overnight, new Date('2026-07-20T21:00:00.000Z')), 'overnight start active');
check(schedule.isPlanCalendarActive(overnight, new Date('2026-07-21T03:00:00.000Z')), 'overnight continuation uses prior weekday');
check(!schedule.isPlanCalendarActive({ ...overnight, excludeDates: ['2026-07-21'] }, new Date('2026-07-21T03:00:00.000Z')), 'current-date exception stops overnight interval');
const dateOnly = { ...berlinPlan, weekdays: [], includeDates: ['2026-07-20'] };
check(schedule.isPlanCalendarActive(dateOnly, new Date('2026-07-20T07:00:00.000Z')), 'date-only schedule active on include date');
check(!schedule.isPlanCalendarActive(dateOnly, new Date('2026-07-21T07:00:00.000Z')), 'explicit empty weekdays remain empty');
equal(schedule.normalizeRecordingPlan({ ...dateOnly, includeDates: ['2026-02-29', '2028-02-29'] }).includeDates, ['2028-02-29'], 'invalid calendar dates are discarded');
const holidayOnly = { ...berlinPlan, holidayPolicy: 'only', holidayDates: ['2026-07-20'] };
check(schedule.isPlanCalendarActive(holidayOnly, new Date('2026-07-20T07:00:00.000Z')), 'holiday-only schedule');
const eventPlan = { ...berlinPlan, id: 'event', mode: 'event', eventTypes: ['motion'], prebufferSeconds: 8, postbufferSeconds: 15, priority: 50 };
const event = { id: 'motion-1', type: 'motion', state: 'stop', startedAt: '2026-07-20T06:59:00.000Z', endedAt: '2026-07-20T06:59:50.000Z' };
check(schedule.matchingEventForPlan(eventPlan, [event], new Date('2026-07-20T07:00:00.000Z'))?.id === 'motion-1', 'event postbuffer active');
check(schedule.matchingEventForPlan(eventPlan, [event], new Date('2026-07-20T07:00:06.000Z')) === null, 'event postbuffer expires');
const merged = schedule.evaluateRecordingPlans([berlinPlan, eventPlan], [{ ...event, state: 'pulse', endedAt: null, expiresAt: '2026-07-20T07:02:00.000Z' }], new Date('2026-07-20T07:00:00.000Z'));
check(merged.shouldRecord && merged.planIds.length === 2 && merged.mode === 'scheduled', 'overlapping plans merge into one recorder');
const standby = schedule.evaluateRecordingPlans([eventPlan], [], new Date('2026-07-20T07:00:00.000Z'));
check(!standby.shouldRecord && standby.eventStandby && standby.standbyPrebufferSeconds === 8, 'event prebuffer standby');

const retention = await import('../backend/src/services/recording/RetentionPolicy.js');
const now = Date.parse('2026-07-22T12:00:00.000Z');
const rows = [
  { id: 1, started_at: '2026-06-01T00:00:00.000Z', file_size_bytes: 100, trigger_type: 'scheduled', status: 'ready', file_path: '/recordings/1.mp4' },
  { id: 2, started_at: '2026-06-02T00:00:00.000Z', file_size_bytes: 100, trigger_type: 'event', status: 'ready', file_path: '/recordings/2.mp4' },
  { id: 3, started_at: '2026-05-01T00:00:00.000Z', file_size_bytes: 100, trigger_type: 'scheduled', status: 'recording', file_path: '/recordings/3.mp4' },
  { id: 4, started_at: '2026-05-01T00:00:00.000Z', file_size_bytes: 100, trigger_type: 'scheduled', status: 'ready', protected_until: '2026-08-01T00:00:00.000Z', file_path: '/recordings/4.mp4' },
];
const agePlan = retention.planRetentionDeletion(rows, { cleanupEnabled: true, strategy: 'age', maxAgeDays: 30, eventMaxAgeDays: 90, protectEventRecordings: true }, { nowMs: now });
equal(agePlan.map((row) => row.id), [1], 'age retention respects event age, active and protected rows');
const quotaPlan = retention.planRetentionDeletion(rows.slice(0, 2), { cleanupEnabled: true, strategy: 'quota', maxRecordings: 1, maxStorageBytes: 0, minFreeBytes: 0, protectEventRecordings: true }, { nowMs: now });
equal(quotaPlan.map((row) => row.id), [1], 'quota removes ordinary recordings before events');

const command = await import('../backend/src/services/recording/RecordingCommand.js');
const args = command.buildRecordingArgs({ sourceUri: 'http://mediamtx:1984/api/stream.m3u8?src=cam', mediaToken: 'secret-token', tempPath: '/tmp/part.ts', prebufferSeconds: 5 });
check(args.includes('-reconnect') && args.includes('-reconnect_streamed'), 'recording reconnect flags');
check(!args.includes('-reconnect_at_eof'), 'live HLS does not use reconnect_at_eof');
check(args.includes('+genpts+discardcorrupt') && args.includes('ignore_err'), 'corrupt frame tolerance');
check(args.includes('-live_start_index') && args.includes('-5'), 'HLS prebuffer');
check(command.reconnectDelay(50) <= 15000, 'recording reconnect delay is bounded');

const frontendValidation = await import('../frontend/src/services/scheduleValidation.js');
check(frontendValidation.isValidIsoDate('2028-02-29') && !frontendValidation.isValidIsoDate('2026-02-29'), 'frontend calendar date validation');
const overlapErrors = frontendValidation.validateRecordingPlans([{ ...berlinPlan, includeDates: ['2026-07-20'], excludeDates: ['2026-07-20'] }]);
check(overlapErrors.some((message) => message.includes('gleichzeitig')), 'frontend detects conflicting exceptions');
const emptyHolidayErrors = frontendValidation.validateRecordingPlans([{ ...berlinPlan, holidayPolicy: 'only', holidayDates: [] }]);
check(emptyHolidayErrors.some((message) => message.includes('Feiertag')), 'frontend validates holiday-only rule');

const { runStreamCleanup } = await import('../frontend/src/utils/asyncCleanup.js');
let cleaned = 0;
await runStreamCleanup(() => { cleaned += 1; });
await runStreamCleanup(async () => { cleaned += 1; });
await runStreamCleanup(() => { throw new Error('expected teardown error'); });
equal(cleaned, 2, 'sync and async stream cleanup');

const systemParsers = await import('../backend/src/services/systemMetricsParsers.js');
const cpuBefore = systemParsers.parseCpuStat('cpu 100 0 50 850 0 0 0 0\n');
const cpuAfter = systemParsers.parseCpuStat('cpu 160 0 90 950 0 0 0 0\n');
equal(systemParsers.calculateCpuUsage(cpuBefore, cpuAfter).cpu, 50, 'system status CPU delta');
equal(systemParsers.parseMemInfo('MemTotal: 1000 kB\nMemAvailable: 250 kB\n').usagePercent, 75, 'system status memory parser');
const netBefore = systemParsers.parseNetworkDev('Inter-|   Receive                                                |  Transmit\n face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n eth0: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0\n');
const netAfter = systemParsers.parseNetworkDev(' eth0: 3000 20 0 0 0 0 0 0 7000 40 0 0 0 0 0 0\n');
equal(Math.round(systemParsers.calculateNetworkRates(netBefore, netAfter, 1000).eth0.totalBytesPerSecond), 7000, 'system status network throughput parser');
const parsedGpu = systemParsers.parseNvidiaCsv('0, NVIDIA Tesla V100, GPU-test, 40, 32768, 8192, 51')[0];
equal(parsedGpu.memoryUsagePercent, 25, 'system status NVIDIA parser');
const systemFrontend = await import('../frontend/src/services/systemStatus.js');
equal(systemFrontend.metricSeverity(95), 'critical', 'system status critical threshold');
check(systemFrontend.appendMetricSample([1, 2, 3], 4, 3).join(',') === '2,3,4', 'system status history limit');
check(systemFrontend.formatBitRate(125000).includes('Mbit/s'), 'system status bitrate formatter');

const updaterDockerfile = source('updater/Dockerfile');
check(!updaterDockerfile.includes('FROM docker:'), 'updater avoids a separate modern docker CLI base image');
check(updaterDockerfile.includes('docker.io docker-compose'), 'updater includes Docker 20 compatible CLI and Compose v1');
check(updaterDockerfile.includes('CMD ["/usr/local/bin/node", "src/server.js"]'), 'updater starts absolute Node binary');
const compose = source('docker-compose.yml');
check(compose.includes('- updater') && compose.includes('- tmp-camera-updater'), 'updater has stable network aliases');
check(compose.includes('UPDATER_SERVICE_NAME: ${UPDATER_SERVICE_NAME:-updater}'), 'backend uses configurable service discovery');
check(compose.includes('${PROJECT_DIR:-.}/.env'), 'backend env_file resolves to mounted project env during updater preflight');
check(compose.includes('/proc:/host/proc:ro') && compose.includes('/sys:/host/sys:ro'), 'system metrics mounts are read-only');
check(compose.includes('SYSTEM_NETWORK_EXCLUDE_INTERFACES') && compose.includes('SYSTEM_HOST_DISK_TOTAL_BYTES'), 'system status exposes network and host disk metrics configuration');
check(compose.includes('ENABLE_NVIDIA_GPU_COMPOSE: ${ENABLE_NVIDIA_GPU_COMPOSE:-false}'), 'GPU compose passthrough has separate opt-in flag');
check(source('scripts/docker-compose.sh').includes('ENABLE_NVIDIA_GPU_COMPOSE'), 'GPU override is controlled by compose opt-in, not status visibility');
check(fs.existsSync(path.join(root, 'docker-compose.gpu.yml')), 'optional NVIDIA compose override exists');
check(source('docker-compose.gpu.yml').includes('capabilities: [gpu]'), 'NVIDIA compose override requests GPU capability');
check(source('backend/src/routes/system.js').includes("get('/status'"), 'admin system status route exists');
check(source('frontend/src/config/navigation.js').includes('/system/status'), 'system status navigation exists');
const systemStatusPage = source('frontend/src/pages/SystemStatusPage.jsx');
check(systemStatusPage.includes("t('system.cpu.coresTitle')"), 'system status dashboard renders localized per-core telemetry');
check(systemStatusPage.includes("t('system.network.interfacesTitle')"), 'system status dashboard renders localized network throughput telemetry');
check(systemStatusPage.includes('<ContainerStatusSection') && systemStatusPage.includes('system.containers.restarts'), 'system status dashboard renders container runtime telemetry');
check(source('backend/src/routes/system.js').includes('containerStatus') && source('updater/src/server.js').includes("/runtime/containers"), 'container runtime status is relayed through the authenticated updater service');
const frontendSources = fs.readdirSync(path.join(root, 'frontend/src'), { recursive: true })
  .filter((entry) => /\.(?:js|jsx)$/.test(entry))
  .map((entry) => source(path.join('frontend/src', entry))).join('\n');
check(!frontendSources.includes('http://updater:3010'), 'frontend never exposes internal updater URL');
const resolverSource = source('backend/src/services/updater/UpdaterEndpointResolver.js');
check(resolverSource.includes('UPDATER_SERVICE_PROTOCOL') || resolverSource.includes('updaterServiceProtocol'), 'updater resolver is environment-driven');
const clientSource = source('backend/src/services/updater/UpdaterClient.js');
check(clientSource.includes('UPDATER_DNS_ERROR') && clientSource.includes('diagnosticId'), 'updater client exposes safe diagnostic classes');
check(source('updater/src/server.js').includes('ensurePreflightEnvFile') && source('updater/src/server.js').includes('preflight-placeholder'), 'updater compose preflight does not require package .env');

const profileDiscovery = await import('../backend/src/services/onvif/profileDiscovery.js');
const allOnvifProfiles = profileDiscovery.mergeOnvifProfiles(
  [{ token: 'profile-h264', name: 'Main', videoCodec: 'H264', width: 1920, height: 1080, mediaService: 'media' }],
  [{ token: 'profile-h265', name: 'Main HEVC', videoCodec: 'H265', width: 1920, height: 1080, mediaService: 'media2' }],
);
check(allOnvifProfiles.length === 2 && allOnvifProfiles.some((profile) => profile.videoCodec === 'H265'), 'Media1 and Media2 profiles are both retained');
equal(profileDiscovery.mediaServiceCandidates('media2'), ['media2', 'media'], 'Media2 profile routes through Media2 first');
const onvifClientSource = source('backend/src/services/onvif/OnvifClient.js');
check(onvifClientSource.includes("for (const service of availableMediaServices(cam))") && onvifClientSource.includes('profilesForService(cam, service)'), 'ONVIF client queries every advertised media service');
check(onvifClientSource.includes('streamUriForService(cam, service, profileToken') && onvifClientSource.includes('snapshotUriForService(cam, service, profileToken)'), 'ONVIF stream and snapshot requests follow profile origin');
check(source('backend/src/services/cameraRepository.js').includes('media_service AS mediaService'), 'ONVIF profile media origin is persisted');

const cameraClassifier = await import('../backend/src/services/media/CameraHostClassifier.js');
const webPage = (body, server = 'embedded') => [{ statusCode: 200, url: 'http://192.0.2.1:80/', headers: { server }, body }];
const tpLinkRouter = cameraClassifier.classifyHostFingerprint({ openPorts: [80], pages: webPage('<title>TP-Link Wireless Router</title><h1>Archer Internet Gateway</h1>', 'TP-LINK Router') });
check(!tpLinkRouter.candidate && tpLinkRouter.confidence === 0, 'plain TP-Link router web UI is not a camera');
const ubiquitiGateway = cameraClassifier.classifyHostFingerprint({ openPorts: [80], pages: webPage('<title>UniFi Network</title><h1>Ubiquiti Security Gateway</h1>', 'UBNT') });
check(!ubiquitiGateway.candidate && ubiquitiGateway.confidence === 0, 'plain Ubiquiti network web UI is not a camera');
const managedSwitch = cameraClassifier.classifyHostFingerprint({ openPorts: [80], pages: webPage('<title>Managed Ethernet Switch</title><p>VLAN profile for IP camera traffic</p>') });
check(!managedSwitch.candidate, 'camera help text on a switch page is not a camera fingerprint');
const vigiCamera = cameraClassifier.classifyHostFingerprint({ openPorts: [80], pages: webPage('<title>VIGI Network Camera Login</title><h1>Live View</h1>') });
check(vigiCamera.verified && vigiCamera.manufacturer === 'TP-Link', 'camera-specific VIGI web UI remains detectable');

const discoverySource = source('backend/src/services/DiscoveryJobService.js');
check(discoverySource.includes('findDiscoveryDuplicate') && discoverySource.includes('filteredExisting'), 'discovery filters existing cameras');
check(discoverySource.includes('DISCOVERY_INTERRUPTED_RESTART'), 'stale discovery jobs are recovered');
const networkDiscoverySource = source('backend/src/services/NetworkCameraDiscovery.js');
check(networkDiscoverySource.includes('discoveryPerHostConcurrency') && networkDiscoverySource.includes('mapLimit'), 'discovery uses bounded two-level concurrency');
check(networkDiscoverySource.includes('autoHostScanRanges'), 'automatic and manual scan ranges are combined');
check(networkDiscoverySource.includes('export function normalizeAutomaticScanRanges') && networkDiscoverySource.includes('cidrContains'), 'automatic scan range normalization is exported and drops covered host routes');
check(networkDiscoverySource.includes('collapseHostRouteThreshold') && networkDiscoverySource.includes('/24'), 'automatic host routes can collapse into LAN scans');
check(networkDiscoverySource.includes('autoHostScanRanges') && networkDiscoverySource.includes('normalizeAutomaticScanRanges'), 'automatic scan ranges are normalized before scanning');
check(networkDiscoverySource.includes('scanOpenCameraPortsWithNmap') && networkDiscoverySource.includes('-sT'), 'optional Nmap port scan engine exists');
const startSource = source('start.sh');
check(startSource.includes('AUTO_HOST_SCAN_RANGES') && startSource.includes("ensure_env_key HOST_SCAN_RANGES ''"), 'start script preserves manual scan ranges');
check(startSource.includes('p <= 30') && startSource.includes('Keine /32-Hostrouten'), 'start script excludes automatic /32 host routes');
check(source('backend/Dockerfile').includes(' nmap '), 'backend image includes optional nmap scanner');

const motionAlgorithmSource = source('backend/src/services/recording/MotionDetectionAlgorithm.js');
check(motionAlgorithmSource.includes('pushMotionWindow') && motionAlgorithmSource.includes('chooseMotionComparison'), 'motion detector has resettable sliding-window helpers');
const motionServiceSource = source('backend/src/services/recording/MotionDetectionService.js');
check(motionServiceSource.includes('motionEpisodeId') && motionServiceSource.includes('MOTION_REARMED'), 'motion service tracks episodes and re-arms after quiet frames');
check(motionServiceSource.includes('MOTION_RETRIGGERED') && motionServiceSource.includes('recordingEventDispatcher.publish'), 'motion service retriggers recordings through the event dispatcher');
const runtimeCoordinatorSource = source('backend/src/services/runtime/CameraRuntimeCoordinator.js');
check(runtimeCoordinatorSource.includes('runPtzCommand') && runtimeCoordinatorSource.includes('runRecordingTask') && runtimeCoordinatorSource.includes('runMotionFrameTask'), 'runtime coordinator separates PTZ, recording and motion work');
check(runtimeCoordinatorSource.includes('MOTION_SUPPRESSED_DURING_PTZ') && runtimeCoordinatorSource.includes('abortMotionTasks'), 'runtime coordinator suppresses motion captures during PTZ activity');
const cameraTaskQueueSource = source('backend/src/services/runtime/CameraTaskQueue.js');
check(cameraTaskQueueSource.includes('coalesceKey') && cameraTaskQueueSource.includes('CameraTaskTimeoutError'), 'camera task queue supports coalescing and timeouts');
const ptzServiceSource = source('backend/src/services/ptz/PtzService.js');
check(ptzServiceSource.includes('ptzAutomationInterlock.begin') && ptzServiceSource.includes('ptzCommandRuntime.submitMove'), 'PTZ service uses a lease interlock and latest-wins command runtime');
check(!ptzServiceSource.includes('triggerPtzRecordingEvents') && !ptzServiceSource.includes('recordingEventDispatcher.publish'), 'PTZ control never creates synthetic recording events');
check(ptzServiceSource.includes('PTZ_LEASE_INVARIANT_RECOVERED') && ptzServiceSource.includes("ptzClientPool.get(camera, 'stop')"), 'PTZ uses exclusive leases and an independent physical stop channel');
check(ptzServiceSource.includes('config.ptzCommandTimeoutMs + 1000'), 'PTZ stop lease outlives the bounded ONVIF stop request');
check(ptzServiceSource.includes('verifyProgressAfterControl') && source('backend/src/services/media/StreamOrchestrator.js').includes('progressUpdates'), 'PTZ completion verifies real stream progress and recovers frozen publishers');
check(ptzServiceSource.includes('if (interlock.newLease)') && !ptzServiceSource.includes("code: dispatch.queued ? 'PTZ_MOVE_COALESCED'"), 'high-frequency PTZ refreshes are not persisted as individual camera events');
const auditTrailSource = source('backend/src/middleware/auditTrail.js');
check(auditTrailSource.includes('HIGH_FREQUENCY_PTZ') && auditTrailSource.includes('res.statusCode < 400'), 'successful PTZ move and heartbeat pulses bypass synchronous audit writes while failures remain auditable');
const interlockSource = source('backend/src/services/runtime/PtzAutomationInterlock.js');
check(interlockSource.includes('acquireAutomaticPermit') && interlockSource.includes('PTZ_INTERACTION_OWNER_MISMATCH') && interlockSource.includes('PTZ_BUSY'), 'PTZ interlock fences recording races and grants exclusive camera ownership');
const recordingEventDispatcherSource = source('backend/src/services/recording/RecordingEventDispatcher.js');
check(recordingEventDispatcherSource.includes('RECORDING_EVENT_SUPPRESSED_PTZ') && recordingEventDispatcherSource.includes('requestScheduler'), 'recording event dispatcher suppresses PTZ-time events and debounces scheduler work');

const ptzControlsSource = source('frontend/src/components/PtzControls.jsx');
check(ptzControlsSource.includes('MOVE_PULSE_MS') && ptzControlsSource.includes('ptzHeartbeat') && ptzControlsSource.includes('interactionId'), 'frontend renews continuous PTZ moves with heartbeat and stable interaction IDs');
check(!ptzControlsSource.includes('Recording-Event #'), 'PTZ UI no longer reports synthetic recording events');
check(ptzControlsSource.includes('stopPromiseRef') && ptzControlsSource.includes('previousStop'), 'frontend serializes stop-before-next-move PTZ transitions');
const websocketHubSource = source('backend/src/services/events/EventWebSocketHub.js');
check(websocketHubSource.includes('revalidateWebSocketUser') && websocketHubSource.includes('websocket-client-frame-not-masked'), 'event WebSocket revalidates sessions and rejects unmasked client frames');
const frontendNginxSource = source('frontend/nginx.conf');
check(frontendNginxSource.includes('location /ws/') && frontendNginxSource.includes('proxy_set_header Upgrade $http_upgrade'), 'frontend proxy forwards authenticated WebSocket upgrades');
check(source('backend/src/services/ptz/PtzClientPool.js').includes("createHash('sha256')"), 'PTZ pool does not retain a plaintext credential fingerprint');

const streamProgressSource = source('backend/src/services/media/StreamProgressTracker.js');
check(streamProgressSource.includes('value > previous') && streamProgressSource.includes('consumeFfmpegProgress'), 'stream watchdog requires monotonic FFmpeg media progress');
const liveStreamPoolSource = source('frontend/src/services/liveStreamPool.js');
check(liveStreamPoolSource.includes('hasReliableFrameSignal') && liveStreamPoolSource.includes('markTransportStatsProgress') && liveStreamPoolSource.includes('timelineAdvanced = current > entry.lastCurrentTime'), 'browser watchdog combines displayed frames, timeline progress and RTP stats without false reloads');

const kioskPageSource = source('frontend/src/pages/KioskPage.jsx');
check(kioskPageSource.includes('api.kioskStatus()') && kioskPageSource.includes('summarizeKioskStatus'), 'kiosk wall polls compact runtime status');
const kioskStatusSource = source('frontend/src/services/kioskStatus.js');
check(kioskStatusSource.includes('Daueraufnahme') && kioskStatusSource.includes('MOTION_VISIBLE_HOLD_MS'), 'kiosk status keeps motion visible and labels continuous recordings');
const seamlessPlayerSource = source('frontend/src/components/SeamlessLivePlayer.jsx');
check(seamlessPlayerSource.includes('KioskStatusBadges') && seamlessPlayerSource.includes('kioskStatus'), 'compact live player renders kiosk motion and recording badges');
check(source('backend/src/routes/recordings.js').includes("recordingsRouter.get('/kiosk/status'") && source('backend/src/routes/recordings.js').includes('activeRecordings'), 'backend exposes no-cache kiosk status endpoint');

const livePoolSource = source('frontend/src/services/liveStreamPool.js');
check(livePoolSource.includes('Moving the same node keeps MediaSource/WebRTC alive'), 'live and kiosk reuse the real video node');
check(livePoolSource.includes('entry.abort?.abort()') && livePoolSource.includes('Promise.resolve(pending)'), 'live reconnect cancels and serializes in-flight connection attempts');
check(livePoolSource.includes('BROWSER_STREAM_STALLED'), 'live stream stall monitor');
check(livePoolSource.includes('api.streamHeartbeat') && livePoolSource.includes('requestVideoFrameCallback'), 'live stream heartbeat and real frame monitor');
check(livePoolSource.includes('verifyAfterControl') && livePoolSource.includes('PTZ_BROWSER_CONTINUITY_OK') && livePoolSource.includes('PTZ_BROWSER_RESYNC_NEEDED'), 'browser PTZ continuity check reconnects only when frames stop advancing');
check(source('frontend/src/services/hlsPlayer.js').includes('cacheBustUrl') && source('frontend/src/services/hlsPlayer.js').includes('no-store'), 'HLS player avoids stale browser frames');
const streamOrchestratorSource = source('backend/src/services/media/StreamOrchestrator.js');
check(streamOrchestratorSource.includes("purpose: consumerPurpose") && streamOrchestratorSource.includes('shared-mainstream-hls') && streamOrchestratorSource.includes('shared-substream-hls'), 'recording uses on-demand mainstream while motion reuses the low-cost preview publisher');
check(streamOrchestratorSource.includes("'browser-fallback'") && livePoolSource.includes('BROWSER_TRANSCODE_FALLBACK_START'), 'browser transcode is isolated and starts only after direct playback failure');
check(streamOrchestratorSource.includes('retainedSession') && streamOrchestratorSource.includes('ensureRetainedHls'), 'recording can rebind a retained media session after a gap');
check(streamOrchestratorSource.includes('scheduleLiveResyncAfterControl') && streamOrchestratorSource.includes('PTZ_LIVE_RESYNC_VERIFY') && !streamOrchestratorSource.includes('Live-Publisher wird nach PTZ neu aufgebaut'), 'backend verifies PTZ stream continuity without tearing down healthy publishers');
const recordingServiceSource = source('backend/src/services/RecordingService.js');
check(recordingServiceSource.includes('retainedSession(state.retainedKey') && recordingServiceSource.includes('progress is intentionally ignored'), 'recording reconnects use file growth instead of noisy ffmpeg progress');
check(recordingServiceSource.includes('recoverInterruptedRecordings') && recordingServiceSource.includes('ready_with_gaps'), 'recording crash recovery retains valid segments');
check(recordingServiceSource.includes('recordingFinalizeTimeoutMs'), 'recording finalization has a bounded timeout');
check(recordingServiceSource.includes('stopFfmpegGracefully') && recordingServiceSource.includes("child.stdin.write('q\\n')"), 'short recordings use graceful FFmpeg stop');
check(recordingServiceSource.includes('block_archive_v1') && recordingServiceSource.includes('finalizeBlock'), 'recording uses independently committed block archive');
check(recordingServiceSource.includes('recordingPolicyRepository.getRetention') && recordingServiceSource.includes('state.blockSeconds'), 'block length is configurable per camera');
check(recordingServiceSource.includes('acquireAutomaticPermit') && recordingServiceSource.includes('before-ffmpeg-spawn'), 'automatic recording startup is fenced before FFmpeg spawn');
check(recordingServiceSource.includes('RECORDING_START_RECOVERY_PENDING') && recordingServiceSource.includes('startRecoveryBlock(state)'), 'initial FFmpeg media failures keep the recording session active and retry');
check(recordingServiceSource.includes('reconnectInFlight') && recordingServiceSource.includes('RECORDING_RECONNECT_DEFERRED_PTZ'), 'recording reconnects are single-flight and PTZ-aware before first media');
const recordingRecoveryPolicySource = source('backend/src/services/recording/RecordingRecoveryPolicy.js');
check(recordingRecoveryPolicySource.includes("'manual', 'continuous', 'scheduled'") && recordingRecoveryPolicySource.includes('persistent-recording'), 'persistent recording modes retry beyond transient outage limits');
const blockArchiveSource = source('backend/src/services/recording/BlockArchive.js');
check(blockArchiveSource.includes('fs.renameSync(tempPath, finalPath)') && blockArchiveSource.includes('#EXT-X-DISCONTINUITY'), 'blocks finalize atomically and archive playback marks gaps');
check(!recordingServiceSource.includes('concatenateFiles(segments'), 'new block archives are not concatenated during normal finalization');
const schedulerSource = source('backend/src/services/recording/RecordingScheduler.js');
check(schedulerSource.includes('prebufferLeases') && schedulerSource.includes('prebufferFailures'), 'event prebuffer has leases and retry backoff');
const footerSource = source('frontend/src/components/AppFooter.jsx');
check(footerSource.includes('new Date().getFullYear()') && footerSource.includes('TMP-SYSTEM-SERVICE GmbH'), 'global footer year is dynamic');
const brandSource = source('frontend/src/components/BrandIcon.jsx');
check(brandSource.includes('../assets/tmp-camera-icon-192.png') && brandSource.includes('../assets/tmp-camera-icon-512.png') && brandSource.includes('TMP Networks Camera Surveillance'), 'shared TMP Networks brand icon uses Vite-managed assets');
check(fs.existsSync(path.join(root, 'frontend/src/assets/tmp-camera-icon-192.png')) && fs.existsSync(path.join(root, 'frontend/src/assets/tmp-camera-icon-512.png')), 'Vite-managed brand assets exist');
check(fs.existsSync(path.join(root, 'frontend/public/icons/tmp-camera-icon-512.png')), '512px app icon exists');
check(source('frontend/index.html').includes('/site.webmanifest'), 'web app manifest is linked');


const addCameraSource = source('frontend/src/pages/AddCameraPage.jsx');
check(addCameraSource.includes('api.nextCameraName()') && addCameraSource.includes('Kamera-1'), 'add camera wizard loads a sequential default camera name');
check(addCameraSource.includes('nameTouched') && addCameraSource.includes('defaultCameraName'), 'manual camera names are preserved while automatic names stay sequential');
check(!addCameraSource.includes('name: device.name || device.model'), 'discovery metadata no longer becomes the persisted camera name');
check(addCameraSource.includes("latestDiscoveryJob('manual')") && addCameraSource.includes("latestDiscoveryJob('startup')"), 'startup and manual discovery jobs are tracked independently');
check(addCameraSource.includes('manualSearchBusy') && addCameraSource.includes('setupBusy'), 'camera setup is not blocked by background discovery');
check(addCameraSource.includes('Kamera sofort per IP hinzufügen'), 'direct manual camera setup remains immediately available');
const discoveryStateSource = source('frontend/src/services/cameraDiscoveryState.js');
check(discoveryStateSource.includes('mergeDiscoveredDevices') && discoveryStateSource.includes('manualSearchBusy'), 'discovery state helper merges parallel results and isolates UI locks');
const discoveryJobSource = source('backend/src/services/DiscoveryJobService.js');
check(discoveryJobSource.includes('discoveryInitialScanConcurrency') && discoveryJobSource.includes('discoveryInitialPerHostConcurrency'), 'startup discovery uses a separate low-impact resource budget');
const repositorySource = source('backend/src/services/cameraRepository.js');
check(repositorySource.includes('nextDefaultCameraName') && repositorySource.includes('Kamera-${max + 1}'), 'backend assigns sequential camera names');


const appSource = source('frontend/src/App.jsx');
check(appSource.includes('path="/license"') && appSource.includes('LicensePage'), 'public license route is registered');
const languageSource = source('frontend/src/i18n/languages.js');
check(languageSource.includes("code: 'ar'") && languageSource.includes("code: 'zh-CN'") && languageSource.includes("code: 'ko'"), 'large locale list includes RTL and Asian language packs');
const i18nProviderSource = source('frontend/src/i18n/I18nProvider.jsx');
check(i18nProviderSource.includes('LANGUAGE_STORAGE_KEY') && i18nProviderSource.includes('document.documentElement.dir'), 'locale selection persists and updates document direction');
const licensePageSource = source('frontend/src/pages/LicensePage.jsx');
check(licensePageSource.includes('getLicenseSections') && licensePageSource.includes('thirdPartyNoticesPath'), 'standalone license page uses the published content export and third-party notices');
check(source('frontend/src/components/AppFooter.jsx').includes('to=\"/license\"') && source('frontend/src/components/AppFooter.jsx').includes('LanguageSelector'), 'footer exposes license agreement after version and language selector');
check(!appSource.includes('/license/manage') && !fs.existsSync(path.join(root, 'frontend/src/pages/LicenseManagementPage.jsx')), 'standalone build has no activation-management route');
check(fs.existsSync(path.join(root, 'INSTALLATION.md')) && fs.existsSync(path.join(root, 'INSTALLATION.md')), 'Buyer and installation documentation are included');
check(fs.existsSync(path.join(root, 'LICENSE_AGREEMENT.md')) && fs.existsSync(path.join(root, 'docs/THIRD_PARTY_NOTICES.md')) && fs.existsSync(path.join(root, 'docs/COMPATIBILITY.md')), 'License notice, compatibility and third-party notices are included');
check(!fs.existsSync(path.join(root, 'backend/src/services/license')) && !fs.existsSync(path.join(root, 'backend/src/routes/license.js')), 'runtime activation and certificate modules are absent');
check(!fs.existsSync(path.join(root, 'secrets/vendor-private-key.pem')), 'customer project never contains the vendor private signing key');

console.log(`Core smoke test passed: ${assertions} assertions.`);
