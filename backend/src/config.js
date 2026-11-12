import path from 'node:path';

const env = process.env;

function number(name, fallback) {
  const value = Number(env[name] ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`Ungueltiger Zahlenwert fuer ${name}`);
  return value;
}

function integer(name, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = number(name, fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Ungueltiger Ganzzahlwert fuer ${name}`);
  return value;
}

function list(name) {
  return String(env[name] || '')
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function integerList(name, fallback) {
  return String(env[name] || fallback || '')
    .split(/[\s,;]+/)
    .map((item) => Number(String(item).trim()))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= 65535);
}

function configurableString(name, fallback) {
  return env[name] === undefined ? fallback : String(env[name]).trim();
}

function boolean(name, fallback = false) {
  if (env[name] === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(env[name]).trim().toLowerCase());
}

function normalizedWebRtcHosts() {
  return list('WEBRTC_ADDITIONAL_HOSTS')
    .map((item) => item.toLowerCase())
    .filter(Boolean);
}

function webRtcHostIsBrowserReachable(host) {
  const value = String(host || '').trim().toLowerCase();
  if (!value) return false;
  if (value === 'host.docker.internal') return false;
  if (value === 'localhost' || value === '0.0.0.0' || value === '::' || value === '::1') return false;
  if (/^127\./.test(value)) return false;
  return true;
}

function browserWebRtcEnabled() {
  if (!boolean('STREAM_WEBRTC_ENABLED', true)) return false;
  return normalizedWebRtcHosts().some(webRtcHostIsBrowserReachable);
}

function browserVideoMode() {
  const mode = configurableString('STREAM_BROWSER_VIDEO_MODE', 'copy-first').toLowerCase();
  // v2.18.0 wrote `safe` into existing .env files. Treat that legacy value as
  // copy-first so an updater installation cannot keep permanent eager transcoding alive.
  return mode === 'safe' ? 'copy-first' : mode;
}

export const config = Object.freeze({
  host: env.API_HOST || '127.0.0.1',
  port: number('API_PORT', 3000),
  dataDir: path.resolve(env.APP_DATA_DIR || '/data'),
  dbPath: path.resolve(env.DB_PATH || path.join(env.APP_DATA_DIR || '/data', 'kamera_server.db')),
  recordingsDir: path.resolve(env.RECORDINGS_DIR || path.join(env.APP_DATA_DIR || '/data', 'recordings')),
  recordingsLocalDir: path.resolve(env.RECORDINGS_LOCAL_DIR || path.join(env.APP_DATA_DIR || '/data', 'recordings')),
  updatesDir: path.resolve(env.UPDATES_DIR || path.join(env.APP_DATA_DIR || '/data', 'updates')),
  appVersion: env.APP_VERSION || '2.20.32',
  systemMetricsCacheMs: integer('SYSTEM_METRICS_CACHE_MS', 2000, { min: 250, max: 60_000 }),
  systemMetricsRefreshMs: integer('SYSTEM_METRICS_REFRESH_MS', 3000, { min: 1000, max: 60_000 }),
  systemMetricsCpuSampleMs: integer('SYSTEM_METRICS_CPU_SAMPLE_MS', 250, { min: 100, max: 2000 }),
  systemMetricsCommandTimeoutMs: integer('SYSTEM_METRICS_COMMAND_TIMEOUT_MS', 2500, { min: 500, max: 15_000 }),
  systemProcRoot: path.resolve(env.SYSTEM_PROC_ROOT || '/host/proc'),
  systemSysRoot: path.resolve(env.SYSTEM_SYS_ROOT || '/host/sys'),
  systemDiskPath: path.resolve(env.SYSTEM_DISK_PATH || env.APP_DATA_DIR || '/data'),
  systemStoragePlausibleMaxBytes: integer('SYSTEM_STORAGE_PLAUSIBLE_MAX_BYTES', 70_368_744_177_664, { min: 1_073_741_824, max: Number.MAX_SAFE_INTEGER }),
  systemHostDiskTotalBytes: integer('SYSTEM_HOST_DISK_TOTAL_BYTES', 0, { min: 0, max: Number.MAX_SAFE_INTEGER }),
  systemHostDiskUsedBytes: integer('SYSTEM_HOST_DISK_USED_BYTES', 0, { min: 0, max: Number.MAX_SAFE_INTEGER }),
  systemHostDiskAvailableBytes: integer('SYSTEM_HOST_DISK_AVAILABLE_BYTES', 0, { min: 0, max: Number.MAX_SAFE_INTEGER }),
  systemHostDiskSource: configurableString('SYSTEM_HOST_DISK_SOURCE', ''),
  systemNetworkExcludeInterfaces: list('SYSTEM_NETWORK_EXCLUDE_INTERFACES').length ? list('SYSTEM_NETWORK_EXCLUDE_INTERFACES') : ['lo', 'docker*', 'br-*', 'veth*', 'virbr*', 'cni*', 'podman*'],
  systemNetworkMaxDevices: integer('SYSTEM_NETWORK_MAX_DEVICES', 12, { min: 1, max: 128 }),
  nvidiaSmiPath: configurableString('NVIDIA_SMI_PATH', 'nvidia-smi'),
  // The explicit 'none' setting is respected. 'auto' only uses VAAPI after
  // scripts/intel-vaapi.sh --enable has opted the host in to the GPU overlay.
  go2RtcFfmpegHardware: (() => {
    const selected = configurableString('GO2RTC_FFMPEG_HARDWARE', 'auto').toLowerCase();
    if (selected === 'vaapi') return 'vaapi';
    if (selected === 'none') return 'none';
    return boolean('ENABLE_INTEL_GPU_COMPOSE', false) ? 'vaapi' : 'none';
  })(),
  go2RtcH264CopyFirst: boolean('GO2RTC_H264_COPY_FIRST', true),
  // HOST_SCAN_RANGES is administrator-owned and persistent. AUTO_HOST_SCAN_RANGES is refreshed by start.sh.
  hostScanRanges: list('HOST_SCAN_RANGES'),
  autoHostScanRanges: list('AUTO_HOST_SCAN_RANGES'),

  discoveryJobRetentionMs: integer('DISCOVERY_JOB_RETENTION_MS', 900_000, { min: 60_000, max: 86_400_000 }),
  discoveryMaxJobs: integer('DISCOVERY_MAX_JOBS', 30, { min: 2, max: 500 }),
  discoveryProtocolRetries: integer('DISCOVERY_PROTOCOL_RETRIES', 1, { min: 0, max: 4 }),
  discoveryRetryDelayMs: integer('DISCOVERY_RETRY_DELAY_MS', 350, { min: 0, max: 10_000 }),
  discoveryScanConcurrency: integer('DISCOVERY_SCAN_CONCURRENCY', 64, { min: 4, max: 512 }),
  discoveryPerHostConcurrency: integer('DISCOVERY_PER_HOST_CONCURRENCY', 4, { min: 1, max: 16 }),
  discoveryFingerprintConcurrency: integer('DISCOVERY_FINGERPRINT_CONCURRENCY', 8, { min: 1, max: 32 }),
  discoveryPortTimeoutMs: integer('DISCOVERY_PORT_TIMEOUT_MS', 600, { min: 150, max: 5000 }),
  discoveryAutoTimeoutMs: integer('DISCOVERY_AUTO_TIMEOUT_MS', 6500, { min: 1500, max: 30_000 }),
  discoveryAutoHostCollapseThreshold: integer('DISCOVERY_AUTO_HOST_COLLAPSE_THRESHOLD', 8, { min: 0, max: 1024 }),
  discoveryScanEngine: configurableString('DISCOVERY_SCAN_ENGINE', 'auto'),
  discoveryNmapPath: configurableString('DISCOVERY_NMAP_PATH', 'nmap'),
  discoveryNmapTimeoutMs: integer('DISCOVERY_NMAP_TIMEOUT_MS', 120_000, { min: 5_000, max: 900_000 }),
  discoveryHostDiscoveryPorts: integerList('DISCOVERY_HOST_DISCOVERY_PORTS', '80,443,554,8000,8080,8443,8554,8899,10554,37777,34567'),
  discoveryHostDiscoveryTimeoutMs: integer('DISCOVERY_HOST_DISCOVERY_TIMEOUT_MS', 350, { min: 100, max: 3000 }),
  discoveryFullScanFallbackHostLimit: integer('DISCOVERY_FULL_SCAN_FALLBACK_HOST_LIMIT', 32, { min: 0, max: 1024 }),
  discoveryInitialEnabled: boolean('DISCOVERY_INITIAL_ENABLED', true),
  discoveryInitialDelayMs: integer('DISCOVERY_INITIAL_DELAY_MS', 3500, { min: 0, max: 120_000 }),
  discoveryInitialAttempts: integer('DISCOVERY_INITIAL_ATTEMPTS', 3, { min: 1, max: 10 }),
  discoveryInitialRetryDelayMs: integer('DISCOVERY_INITIAL_RETRY_DELAY_MS', 5000, { min: 500, max: 300_000 }),
  discoveryInitialScanConcurrency: integer('DISCOVERY_INITIAL_SCAN_CONCURRENCY', 16, { min: 4, max: 128 }),
  discoveryInitialPerHostConcurrency: integer('DISCOVERY_INITIAL_PER_HOST_CONCURRENCY', 1, { min: 1, max: 8 }),
  discoveryInitialFingerprintConcurrency: integer('DISCOVERY_INITIAL_FINGERPRINT_CONCURRENCY', 2, { min: 1, max: 16 }),

  updaterUrls: list('UPDATER_URLS'),
  updaterUrl: configurableString('UPDATER_URL', ''),
  updaterServiceProtocol: configurableString('UPDATER_SERVICE_PROTOCOL', 'http'),
  updaterServiceName: configurableString('UPDATER_SERVICE_NAME', 'updater'),
  updaterServicePort: integer('UPDATER_SERVICE_PORT', 3010, { min: 1, max: 65535 }),
  updaterServiceBasePath: configurableString('UPDATER_SERVICE_BASE_PATH', ''),
  updaterSocketPath: configurableString('UPDATER_SOCKET_PATH', '/data/updates/tmp-camera-updater.sock'),
  updaterFallbackUrls: list('UPDATER_FALLBACK_URLS'),
  updaterFallbackUrl: configurableString('UPDATER_FALLBACK_URL', ''),
  updaterToken: env.UPDATER_TOKEN || '',
  updaterHealthTimeoutMs: Math.max(15_000, integer('UPDATER_HEALTH_TIMEOUT_MS', 15_000, { min: 500, max: 60_000 })),
  updaterRequestTimeoutMs: integer('UPDATER_REQUEST_TIMEOUT_MS', 15_000, { min: 1000, max: 300_000 }),
  updaterHealthRetries: integer('UPDATER_HEALTH_RETRIES', 1, { min: 0, max: 5 }),
  updaterRequestRetries: integer('UPDATER_REQUEST_RETRIES', 1, { min: 0, max: 3 }),
  updaterRetryDelayMs: integer('UPDATER_RETRY_DELAY_MS', 250, { min: 0, max: 5000 }),
  updaterRestartGraceMs: integer('UPDATER_RESTART_GRACE_MS', 300_000, { min: 10_000, max: 300_000 }),

  maxUpdateBytes: number('MAX_UPDATE_BYTES', 536870912),
  logLevel: env.LOG_LEVEL || 'info',
  jwtSecret: env.JWT_SECRET || 'change-this-jwt-secret-before-production-please',
  mediaTokenSecret: env.MEDIA_TOKEN_SECRET || 'change-this-media-secret-before-production',
  cameraCredentialKey: env.CAMERA_CREDENTIAL_KEY || 'change-this-camera-key-before-production',
  adminUser: env.ADMIN_USER || 'admin',
  adminPassword: env.ADMIN_PASSWORD || 'tmp-networks-admin',
  accessTokenTtl: env.ACCESS_TOKEN_TTL || '8h',
  mediaTokenTtlSeconds: number('MEDIA_TOKEN_TTL_SECONDS', 3600),
  recordingTokenTtlSeconds: number('RECORDING_TOKEN_TTL_SECONDS', 86400),
  streamBroker: configurableString('STREAM_BROKER', 'go2rtc').toLowerCase(),
  go2RtcApi: env.GO2RTC_API || 'http://127.0.0.1:1984/media/go2rtc',
  go2RtcPublishBase: env.GO2RTC_PUBLISH_BASE || 'rtsp://127.0.0.1:8554',
  go2RtcHlsInternal: env.GO2RTC_HLS_INTERNAL || 'http://127.0.0.1:1984',
  publicGo2RtcBase: env.PUBLIC_GO2RTC_BASE || '/media/go2rtc',
  localHlsDir: path.resolve(env.LOCAL_HLS_DIR || path.join(env.APP_DATA_DIR || '/data', 'live')),
  localHlsSegmentSeconds: integer('LOCAL_HLS_SEGMENT_SECONDS', 1, { min: 1, max: 6 }),
  localHlsListSize: integer('LOCAL_HLS_LIST_SIZE', 30, { min: 8, max: 120 }),
  publicLocalHlsBase: env.PUBLIC_LOCAL_HLS_BASE || '/live-hls',
  browserHlsMode: configurableString('STREAM_BROWSER_HLS_MODE', 'local-ring').toLowerCase(),
  publicWebRtcBase: env.PUBLIC_GO2RTC_BASE || env.PUBLIC_WEBRTC_BASE || '/media/go2rtc',
  publicHlsBase: env.PUBLIC_GO2RTC_BASE || env.PUBLIC_HLS_BASE || '/media/go2rtc',
  webRtcAdditionalHosts: list('WEBRTC_ADDITIONAL_HOSTS'),
  webRtcAdditionalHostsMode: configurableString('WEBRTC_ADDITIONAL_HOSTS_MODE', 'auto').toLowerCase(),
  browserWebRtcEnabled: browserWebRtcEnabled(),
  ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath: env.FFPROBE_PATH || 'ffprobe',
  streamIdleSeconds: number('STREAM_IDLE_SECONDS', 180),
  permanentIngestEnabled: boolean('PERMANENT_CAMERA_INGEST_ENABLED', true),
  permanentIngestQuality: configurableString('PERMANENT_CAMERA_INGEST_QUALITY', 'low').toLowerCase(),
  permanentIngestProfile: configurableString('PERMANENT_CAMERA_INGEST_PROFILE', 'auto-substream').toLowerCase(),
  permanentIngestVideoMode: configurableString('PERMANENT_CAMERA_INGEST_VIDEO_MODE', 'force-copy').toLowerCase(),
  permanentIngestStartupStaggerMs: integer('PERMANENT_CAMERA_INGEST_STARTUP_STAGGER_MS', 1500, { min: 0, max: 120_000 }),
  kioskPreferSubstream: boolean('KIOSK_PREFER_SUBSTREAM', true),
  livePreferMainstream: boolean('LIVE_PREFER_MAINSTREAM', true),
  recordingPreferMainstream: boolean('RECORDING_PREFER_MAINSTREAM', true),
  motionPreferSubstream: boolean('MOTION_PREFER_SUBSTREAM', true),
  browserTranscodeFallbackEnabled: boolean('BROWSER_TRANSCODE_FALLBACK_ENABLED', false),
  streamLeaseTtlSeconds: integer('STREAM_LEASE_TTL_SECONDS', 90, { min: 20, max: 900 }),
  streamBrowserCacheSeconds: integer('STREAM_BROWSER_CACHE_SECONDS', 120, { min: 0, max: 600 }),
  streamStallSeconds: number('STREAM_STALL_SECONDS', 45),
  streamHardStallSeconds: integer('STREAM_HARD_STALL_SECONDS', 300, { min: 60, max: 3600 }),
  streamBrokerApiGraceMs: integer('STREAM_BROKER_API_GRACE_MS', 120000, { min: 5000, max: 600000 }),
  streamRestartInitialDelayMs: integer('STREAM_RESTART_INITIAL_DELAY_MS', 2500, { min: 500, max: 60000 }),
  streamRestartJitterMs: integer('STREAM_RESTART_JITTER_MS', 750, { min: 0, max: 10000 }),
  streamBrokerUnavailableRetryMs: integer('STREAM_BROKER_UNAVAILABLE_RETRY_MS', 8000, { min: 1000, max: 120000 }),
  streamBrowserVideoMode: browserVideoMode(),
  ptzCommandTimeoutMs: integer('PTZ_COMMAND_TIMEOUT_MS', 5000, { min: 500, max: 60_000 }),
  ptzMotionSettleMs: integer('PTZ_MOTION_SETTLE_MS', 2200, { min: 0, max: 120_000 }),
  ptzStreamVerifyMs: integer('PTZ_STREAM_VERIFY_MS', 5000, { min: 1000, max: 30_000 }),
  ptzLiveResyncEnabled: boolean('PTZ_LIVE_RESYNC_ENABLED', true),
  ptzLiveResyncDelayMs: integer('PTZ_LIVE_RESYNC_DELAY_MS', 900, { min: 0, max: 30_000 }),
  ptzBrowserResyncMs: integer('PTZ_BROWSER_RESYNC_MS', 3500, { min: 500, max: 60_000 }),
  ptzContinuousMoveTimeoutMs: integer('PTZ_CONTINUOUS_MOVE_TIMEOUT_MS', 1200, { min: 250, max: 30_000 }),
  ptzLeaseTtlMs: integer('PTZ_LEASE_TTL_MS', 2500, { min: 750, max: 30_000 }),
  ptzLeaseSweepMs: integer('PTZ_LEASE_SWEEP_MS', 500, { min: 250, max: 5000 }),
  ptzTombstoneTtlMs: integer('PTZ_TOMBSTONE_TTL_MS', 15_000, { min: 1000, max: 300_000 }),
  ptzMaxLeasesPerCamera: integer('PTZ_MAX_LEASES_PER_CAMERA', 16, { min: 1, max: 256 }),
  ptzClientIdleMs: integer('PTZ_CLIENT_IDLE_MS', 300_000, { min: 10_000, max: 86_400_000 }),
  recordingQueueMaxPending: integer('RECORDING_QUEUE_MAX_PENDING', 20, { min: 1, max: 500 }),
  recordingCompressionEnabled: boolean('RECORDING_COMPRESSION_ENABLED', true),
  recordingCompressionCrf: integer('RECORDING_COMPRESSION_CRF', 29, { min: 18, max: 40 }),
  recordingCompressionMaxVideoBitrateKbps: integer('RECORDING_COMPRESSION_MAX_VIDEO_BITRATE_KBPS', 2500, { min: 0, max: 50000 }),
  recordingCompressionPreset: configurableString('RECORDING_COMPRESSION_PRESET', 'veryfast'),
  recordingCompressionThreads: integer('RECORDING_COMPRESSION_THREADS', 1, { min: 1, max: 16 }),
  recordingCompressionMaxHeight: integer('RECORDING_COMPRESSION_MAX_HEIGHT', 0, { min: 0, max: 4320 }),
  recordingCompressionAudioBitrateKbps: integer('RECORDING_COMPRESSION_AUDIO_BITRATE_KBPS', 64, { min: 24, max: 320 }),
  recordingCompressionMinBytes: integer('RECORDING_COMPRESSION_MIN_BYTES', 5242880, { min: 1880, max: Number.MAX_SAFE_INTEGER }),
  recordingCompressionMinSavingsPercent: number('RECORDING_COMPRESSION_MIN_SAVINGS_PERCENT', 5),
  recordingCompressionMinDurationRatio: number('RECORDING_COMPRESSION_MIN_DURATION_RATIO', 0.96),
  recordingCompressionTimeoutMs: integer('RECORDING_COMPRESSION_TIMEOUT_MS', 1800000, { min: 30000, max: 86400000 }),
  recordingCompressionProbeTimeoutMs: integer('RECORDING_COMPRESSION_PROBE_TIMEOUT_MS', 30000, { min: 1000, max: 300000 }),
  recordingCompressionPollMs: integer('RECORDING_COMPRESSION_POLL_MS', 5000, { min: 250, max: 300000 }),
  recordingCompressionStartDelayMs: Math.max(120_000, integer('RECORDING_COMPRESSION_START_DELAY_MS', 120000, { min: 0, max: 3600000 })),
  recordingCompressionBusyDelayMs: integer('RECORDING_COMPRESSION_BUSY_DELAY_MS', 60000, { min: 1000, max: 3600000 }),
  recordingCompressionMaxLoadRatio: number('RECORDING_COMPRESSION_MAX_LOAD_RATIO', 0.75),
  recordingCompressionIdleGraceMs: integer('RECORDING_COMPRESSION_IDLE_GRACE_MS', 30_000, { min: 0, max: 3_600_000 }),
  recordingCompressionRuntimeCheckMs: integer('RECORDING_COMPRESSION_RUNTIME_CHECK_MS', 2000, { min: 500, max: 60_000 }),
  recordingCompressionNice: integer('RECORDING_COMPRESSION_NICE', 15, { min: 0, max: 19 }),
  recordingCompressionPauseDuringPtz: boolean('RECORDING_COMPRESSION_PAUSE_DURING_PTZ', true),
  recordingCompressionPauseWhileRecording: boolean('RECORDING_COMPRESSION_PAUSE_WHILE_RECORDING', false),
  recordingCompressionPauseDuringStreamRecovery: boolean('RECORDING_COMPRESSION_PAUSE_DURING_STREAM_RECOVERY', true),
  recordingCompressionMaxAttempts: integer('RECORDING_COMPRESSION_MAX_ATTEMPTS', 3, { min: 1, max: 20 }),
  recordingCompressionRetryBaseMs: integer('RECORDING_COMPRESSION_RETRY_BASE_MS', 60000, { min: 1000, max: 3600000 }),
  recordingCompressionRetryMaxMs: integer('RECORDING_COMPRESSION_RETRY_MAX_MS', 3600000, { min: 1000, max: 86400000 }),
  recordingCompressionBackfill: boolean('RECORDING_COMPRESSION_BACKFILL', true),
  recordingCompressionBackfillLimit: integer('RECORDING_COMPRESSION_BACKFILL_LIMIT', 250, { min: 1, max: 1000000 }),
  snapshotVideoFps: number('SNAPSHOT_VIDEO_FPS', 5),
  snapshotRefreshMs: number('SNAPSHOT_REFRESH_MS', 1000),
  probeTimeoutMs: number('PROBE_TIMEOUT_MS', 9000),
  startTimeoutMs: number('STREAM_START_TIMEOUT_MS', 15000),
  maxRestartBackoffMs: number('MAX_RESTART_BACKOFF_MS', 30000),
  cameraConnectTimeoutMs: number('CAMERA_CONNECT_TIMEOUT_MS', 10000),
  // Synology-style clip truncation: independently committed archive blocks.
  // RECORDING_SEGMENT_SECONDS remains a backward-compatible fallback for existing .env files.
  recordingBlockSeconds: integer('RECORDING_BLOCK_SECONDS', env.RECORDING_SEGMENT_SECONDS ?? 300, { min: 10, max: 3600 }),
  recordingSegmentSeconds: integer('RECORDING_BLOCK_SECONDS', env.RECORDING_SEGMENT_SECONDS ?? 300, { min: 10, max: 3600 }),
  recordingBlockProbeTimeoutMs: integer('RECORDING_BLOCK_PROBE_TIMEOUT_MS', 12_000, { min: 1000, max: 120_000 }),
  recordingBlockMinimumBytes: integer('RECORDING_BLOCK_MINIMUM_BYTES', 1880, { min: 188, max: 10_000_000 }),
  recordingStartupMediaTimeoutMs: integer('RECORDING_STARTUP_MEDIA_TIMEOUT_MS', 15_000, { min: 2000, max: 120_000 }),
  recordingRotationGraceMs: integer('RECORDING_ROTATION_GRACE_MS', 5000, { min: 500, max: 60_000 }),
  recordingStopGraceMs: integer('RECORDING_STOP_GRACE_MS', 20_000, { min: 2000, max: 120_000 }),
  recordingMinFreeBytes: integer('RECORDING_MIN_FREE_BYTES', 536_870_912, { min: 0, max: Number.MAX_SAFE_INTEGER }),
  recordingFinalizeTimeoutMs: integer('RECORDING_FINALIZE_TIMEOUT_MS', 120_000, { min: 5000, max: 1_800_000 }),
  recordingReconnectBaseMs: integer('RECORDING_RECONNECT_BASE_MS', 1000, { min: 100, max: 30_000 }),
  recordingReconnectMaxMs: integer('RECORDING_RECONNECT_MAX_MS', 15_000, { min: 1000, max: 300_000 }),
  recordingMaxOutageSeconds: integer('RECORDING_MAX_OUTAGE_SECONDS', 180, { min: 5, max: 86_400 }),
  recordingMaxReconnectAttempts: integer('RECORDING_MAX_RECONNECT_ATTEMPTS', 30, { min: 1, max: 10_000 }),
  recordingStableResetSeconds: integer('RECORDING_STABLE_RESET_SECONDS', 30, { min: 5, max: 3600 }),
  recordingWatchdogIntervalMs: integer('RECORDING_WATCHDOG_INTERVAL_MS', 2500, { min: 500, max: 30_000 }),
  recordingStallSeconds: integer('RECORDING_STALL_SECONDS', 25, { min: 5, max: 1800 }),
  recordingSourceProtocol: configurableString('RECORDING_SOURCE_PROTOCOL', 'auto'),
  recordingPrebufferMaxSeconds: integer('RECORDING_PREBUFFER_MAX_SECONDS', 10, { min: 0, max: 120 }),
  recordingSchedulerIntervalMs: integer('RECORDING_SCHEDULER_INTERVAL_MS', 5000, { min: 1000, max: 60_000 }),
  recordingSchedulerConcurrency: integer('RECORDING_SCHEDULER_CONCURRENCY', 4, { min: 1, max: 32 }),
  recordingSchedulerImmediateDebounceMs: integer('RECORDING_SCHEDULER_IMMEDIATE_DEBOUNCE_MS', 250, { min: 0, max: 10000 }),
  motionDetectionEnabled: boolean('MOTION_DETECTION_ENABLED', true),
  motionDetectionSource: configurableString('MOTION_DETECTION_SOURCE', 'live'),
  motionDetectionSnapshotFallback: boolean('MOTION_DETECTION_SNAPSHOT_FALLBACK', false),
  motionDetectionSkipDuringPtz: boolean('MOTION_DETECTION_SKIP_DURING_PTZ', true),
  motionDetectionIntervalMs: integer('MOTION_DETECTION_INTERVAL_MS', 2000, { min: 500, max: 60_000 }),
  motionDetectionConcurrency: integer('MOTION_DETECTION_CONCURRENCY', 2, { min: 1, max: 16 }),
  motionDetectionFrameWidth: integer('MOTION_DETECTION_FRAME_WIDTH', 96, { min: 32, max: 320 }),
  motionDetectionFrameHeight: integer('MOTION_DETECTION_FRAME_HEIGHT', 54, { min: 18, max: 240 }),
  motionDetectionFrameTimeoutMs: integer('MOTION_DETECTION_FRAME_TIMEOUT_MS', 9000, { min: 2000, max: 60_000 }),
  motionDetectionBlurRadius: integer('MOTION_DETECTION_BLUR_RADIUS', 1, { min: 0, max: 4 }),
  motionDetectionStabilizationPixels: integer('MOTION_DETECTION_STABILIZATION_PIXELS', 1, { min: 0, max: 4 }),
  motionDetectionBrightnessCompensation: boolean('MOTION_DETECTION_BRIGHTNESS_COMPENSATION', true),
  motionDetectionPixelThreshold: integer('MOTION_DETECTION_PIXEL_THRESHOLD', 10, { min: 1, max: 255 }),
  motionDetectionMinChangedRatio: number('MOTION_DETECTION_MIN_CHANGED_RATIO', 0.008),
  motionDetectionMinAverageDiff: number('MOTION_DETECTION_MIN_AVERAGE_DIFF', 0.6),
  motionDetectionMinChangedPixels: integer('MOTION_DETECTION_MIN_CHANGED_PIXELS', 18, { min: 1, max: 1000000 }),
  motionDetectionSceneChangeRatio: number('MOTION_DETECTION_SCENE_CHANGE_RATIO', 0.85),
  motionDetectionSceneChangeMinAverageDiff: number('MOTION_DETECTION_SCENE_CHANGE_MIN_AVERAGE_DIFF', 12),
  motionDetectionSuppressSceneChanges: boolean('MOTION_DETECTION_SUPPRESS_SCENE_CHANGES', false),
  motionDetectionEventSeconds: integer('MOTION_DETECTION_EVENT_SECONDS', 20, { min: 1, max: 3600 }),
  motionDetectionCooldownSeconds: integer('MOTION_DETECTION_COOLDOWN_SECONDS', 3, { min: 0, max: 3600 }),
  motionDetectionRearmSeconds: number('MOTION_DETECTION_REARM_SECONDS', 3),
  motionDetectionRetriggerSeconds: number('MOTION_DETECTION_RETRIGGER_SECONDS', 12),
  motionDetectionDebounceFrames: integer('MOTION_DETECTION_DEBOUNCE_FRAMES', 1, { min: 1, max: 20 }),
  motionDetectionWindowFrames: integer('MOTION_DETECTION_WINDOW_FRAMES', 4, { min: 1, max: 30 }),
  motionDetectionWindowMinMotionFrames: integer('MOTION_DETECTION_WINDOW_MIN_MOTION_FRAMES', 1, { min: 1, max: 30 }),
  retentionCleanupIntervalMs: integer('RETENTION_CLEANUP_INTERVAL_MS', 900_000, { min: 60_000, max: 86_400_000 }),
  retentionStartupDelayMs: integer('RETENTION_STARTUP_DELAY_MS', 20_000, { min: 1000, max: 600_000 }),
  retentionBatchSize: integer('RETENTION_BATCH_SIZE', 100, { min: 1, max: 5000 }),
  retentionDefaultMaxAgeDays: integer('RETENTION_DEFAULT_MAX_AGE_DAYS', 30, { min: 0, max: 3650 }),
  alertWebhookUrl: configurableString('ALERT_WEBHOOK_URL', ''),
  alertMinLevel: configurableString('ALERT_MIN_LEVEL', 'error'),
  alertCooldownMs: integer('ALERT_COOLDOWN_MS', 300_000, { min: 10_000, max: 86_400_000 }),
  corsOrigin: env.CORS_ORIGIN || false,
  websocketAllowedOrigins: list('WEBSOCKET_ALLOWED_ORIGINS'),
  websocketMaxClients: integer('WEBSOCKET_MAX_CLIENTS', 128, { min: 1, max: 10_000 }),
  websocketMaxMessageBytes: integer('WEBSOCKET_MAX_MESSAGE_BYTES', 16_384, { min: 256, max: 1_048_576 }),
  websocketHeartbeatMs: integer('WEBSOCKET_HEARTBEAT_MS', 20_000, { min: 5000, max: 120_000 }),
  websocketMaxBufferedBytes: integer('WEBSOCKET_MAX_BUFFERED_BYTES', 1_048_576, { min: 16_384, max: 67_108_864 }),
  auditLogRetentionDays: integer('AUDIT_LOG_RETENTION_DAYS', 180, { min: 1, max: 3650 }),
  domainEventQueueLimit: integer('DOMAIN_EVENT_QUEUE_LIMIT', 2000, { min: 100, max: 100_000 }),
  trustProxy: env.TRUST_PROXY === 'true',
});

export function insecureDefaults() {
  return [
    config.jwtSecret.startsWith('change-this'),
    config.mediaTokenSecret.startsWith('change-this'),
    config.cameraCredentialKey.startsWith('change-this'),
    !config.updaterToken || config.updaterToken.length < 32,
    config.adminPassword === 'tmp-networks-admin',
  ].some(Boolean);
}
