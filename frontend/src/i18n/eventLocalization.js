import { translateLegacyPhrase } from './legacyPhrases.js';

const codeEnglish = Object.freeze({
  CAMERA_START_LOCK_ACQUIRED: 'Camera connection startup is serialized to prevent parallel RTSP starts.',
  GO2RTC_BROKER_REUSED: 'The existing central camera broker is being reused.',
  GO2RTC_BROKER_RESTORED: 'The broker reference existed but go2rtc had lost the stream; the broker path is being restored.',
  GO2RTC_RAW_SOURCE_CONFIGURED: 'The native camera producer was created and verified in go2rtc.',
  GO2RTC_NORMALIZED_SOURCE_CONFIGURED: 'The normalized H.264 video path was created and verified.',
  GO2RTC_OPTIONAL_AUDIO_CONFIGURED: 'The optional AAC audio path was created separately from the stable video path.',
  GO2RTC_OPTIONAL_AUDIO_SKIPPED: 'The optional audio path could not be created; video remains available.',
  SESSION_COALESCED: 'A parallel connection request was merged into the active camera session.',
  SESSION_CREATED: 'A new media session was created.',
  STREAM_START_FAILED: 'The live stream could not be started with any available camera profile.',
  PERMANENT_INGEST_CREATED: 'The permanent camera publisher was created.',
  PERMANENT_INGEST_START_FAILED: 'The permanent camera publisher could not be started.',
  STREAM_URI_FAILED: 'ONVIF did not provide a usable media address for this profile.',
  GO2RTC_READY: 'The go2rtc control API is reachable.',
  GO2RTC_UNAVAILABLE: 'go2rtc is not reachable through the internal control API.',
  PROFILES_DISCOVERED: 'ONVIF camera profiles were loaded.',
  PROFILES_UNAVAILABLE_USING_ALTERNATIVES: 'ONVIF profiles are unavailable; alternative media sources are still being checked.',
  PROFILE_REFRESH_FAILED: 'ONVIF profiles could not be refreshed.',
  ATTEMPTS_PREPARED: 'Stream variants were prepared for systematic connection testing.',
  BROKER_PROFILE_METADATA: 'Profile metadata was accepted without a blocking camera probe.',
  STREAM_READY: 'The live stream is ready.',
  ATTEMPT_FAILED: 'A stream connection variant failed.',
  SNAPSHOT_VIDEO_FALLBACK_READY: 'Snapshots are being exposed as an H.264 live stream without changing the browser image.',
  LOCAL_HLS_READINESS_POLL: 'The local HLS ring is being checked before browser release.',
  LOCAL_HLS_FFMPEG_STARTED: 'The local HLS ring was started from the normalized go2rtc path.',
  BROKER_AUDIO_FALLBACK: 'The audio path was not ready in time; the same producer continues without audio.',
  LOCAL_HLS_READY: 'The local HLS ring is providing a playlist and video segments.',
  PUBLISHER_READY: 'The central broker and local browser HLS ring are ready.',
  SNAPSHOT_REFRESH_FAILED: 'A new snapshot could not be loaded; the last valid image remains available.',
  SNAPSHOT_LOCAL_HLS_STARTED: 'Snapshot video is being generated directly as a local HLS ring.',
  SNAPSHOT_FFMPEG_EXITED: 'The snapshot FFmpeg process exited immediately after startup.',
  SNAPSHOT_LOCAL_HLS_READY: 'The snapshot video fallback is providing a local HLS ring.',
  FFMPEG_DIAGNOSTIC: 'FFmpeg reported a problem during media connection setup.',
  FFMPEG_EXIT: 'The FFmpeg media process exited unexpectedly.',
  STREAM_BROKER_LIVENESS_OK: 'go2rtc still reports active tracks; the publisher is left running.',
  STREAM_BROKER_API_GRACE: 'The go2rtc API is temporarily unavailable; the running media process is left untouched.',
  STREAM_SOFT_STALL_IGNORED: 'Media progress is old, but the broker or browser path is still alive; no hard restart is performed.',
  STREAM_HARD_STALL_GRACE: 'The stream appears temporarily stalled; a hard restart is delayed until the configured threshold.',
  STREAM_STALLED: 'A stalled live stream was detected.',
  AUTO_RESTART_SCHEDULED: 'The stream is scheduled for automatic reconnection.',
  AUTO_RESTART_FAILED: 'Automatic stream reconnection failed.',
  STREAM_RETAINED_REUSE: 'The existing publisher was retained and reused.',
  STREAM_RETAIN_REUSE_FAILED: 'The existing publisher could not be reused.',
  STREAM_NOT_READY: 'The camera stream is not ready for media consumption.',
  SNAPSHOT_MODE_NOT_RECORDABLE: 'Snapshot live mode cannot be used as a video recording source.',
  STREAM_RETAINED: 'The media session was retained for another consumer.',
  STREAM_RELEASED: 'The recording consumer released the media session.',
  PTZ_LIVE_RESYNC_CANCELLED: 'The scheduled live resynchronization was cancelled by new PTZ activity.',
  PTZ_LIVE_RESYNC_SCHEDULED: 'The live publisher will be stabilized and resynchronized after PTZ activity.',
  PTZ_LIVE_RESYNC_FAILED_RESTART: 'The failed live publisher will be restarted after PTZ activity.',
  PTZ_LIVE_RESYNC_DEFERRED: 'The live publisher is not ready yet; PTZ resynchronization is waiting for normal startup.',
  PTZ_LIVE_RESYNC_VERIFY: 'PTZ activity ended; the live publisher remains active and is being checked for progress.',
  MANUAL_RESTART: 'The stream was released for a manual rebuild.',
  SESSION_STOPPED: 'The live session was stopped.',
  SESSION_IDLE_STOP: 'The live session was stopped because it was idle.',
  RECORDING_START_RECOVERY_PENDING: 'The recording has not received media data yet and remains active while automatic reconnection runs.',
  RECORDING_STARTED: 'Recording started.',
  RECORDING_BLOCK_DAMAGED: 'A recording block was not playable; previously completed blocks remain available.',
  RECORDING_BLOCK_COMMITTED: 'A recording block was completed atomically.',
  RECORDING_RESUMED: 'Block recording is receiving media again after a stream interruption.',
  RECORDING_STALLED: 'The recording source stopped delivering data and is being reconnected.',
  RECORDING_MEDIA_TOKEN_REFRESH: 'The HLS recording is continuing with a refreshed internal read token.',
  RECORDING_SOURCE_FALLBACK_USED: 'The recording source was switched automatically after a startup failure.',
  RECORDING_SOURCE_START_FAILED: 'The recording source produced no usable media data; a fallback is being tried.',
  RECORDING_RECOVERY_LIMIT: 'The recording could not reconnect within the configured fault-tolerance window.',
  RECORDING_RECONNECT_DEFERRED_PTZ: 'Recording reconnection is deferred while PTZ control is active.',
  RECORDING_RECONNECT_SCHEDULED: 'Recording reconnection was scheduled.',
  RECORDING_PROCESS_STOPPED: 'The recording media process was stopped.',
  RECORDING_NO_PLAYABLE_BLOCKS: 'The recording contains no playable block.',
  RECORDING_FINISHED: 'Recording finished.',
  RECORDING_FINALIZE_FAILED: 'Block recording could not be finalized.',
  RECORDING_RECOVERED_AFTER_RESTART: 'An interrupted block recording was recovered from atomically saved blocks.',
  RECORDING_BLOCK_COMPRESSED: 'The recording block was compressed in the background.',
  RECORDING_EVENT_PUBLISHED: 'A recording event was registered.',
  RECORDING_EVENT_SUPPRESSED_PTZ: 'An automatic recording event was ignored while PTZ control was active.',
  RECORDING_START_SUPPRESSED_PTZ: 'Automatic recording startup was deferred while PTZ control was active.',
  RECORDING_SCHEDULER_ERROR: 'A scheduled recording action failed.',
  RECORDING_EVIDENCE_EXPORT_CREATED: 'The evidence export package was created.',
  RETENTION_CLEANUP_ERRORS: 'Some recordings could not be cleaned up automatically.',
  EVENT_PREBUFFER_READY: 'The camera stream is being kept warm for the event prebuffer.',
  EVENT_PREBUFFER_RELEASED: 'The event prebuffer was released.',
  MOTION_STREAM_RELEASED: 'Motion detection released the live media session.',
  MOTION_STREAM_READY: 'Motion detection is using the resource-efficient preview or substream path.',
  MOTION_SOURCE_FALLBACK_USED: 'Motion detection automatically switched to the next live source after a source error.',
  MOTION_REARMED: 'Motion detection was re-armed after a quiet image.',
  MOTION_EVENT_SUPPRESSED_PTZ: 'Motion was detected but was not processed as a recording event while PTZ control was active.',
  MOTION_RETRIGGERED: 'Motion detection was retriggered.',
  MOTION_DETECTED: 'Motion was detected.',
  MOTION_DETECTION_FAILED: 'Motion detection could not produce a comparison frame.',
  PTZ_ASYNC_COMMAND_FAILED: 'The asynchronous PTZ command failed.',
  PTZ_MOVE_ACCEPTED: 'PTZ movement was accepted without recording or motion dependencies.',
  PTZ_LEASE_INVARIANT_RECOVERED: 'Multiple PTZ leases were detected; a physical safety stop is still being performed.',
  PTZ_STOP_OK: 'PTZ movement was stopped and automatic recording remains paused during stabilization.',
  PTZ_STOP_FAILED: 'PTZ stop failed; the automation lock remains active for recovery.',
  PTZ_RECOVERY_STOP: 'An orphaned PTZ operation was ended by a recovery stop.',
  PTZ_COMMAND_FAILED: 'The PTZ command failed.',
  PTZ_PRESETS_FAILED: 'PTZ presets could not be loaded.',
  AI_EVENT_ANALYSIS_STARTED: 'AI event analysis started.',
  AI_EVENT_ANALYSIS_COMPLETED: 'AI event analysis completed.',
  AI_EVENT_ANALYSIS_FAILED: 'AI event analysis failed.',
});

const germanHint = /(?:[äöüß]|\b(?:der|die|das|wird|wurde|konnte|könnte|nicht|keine|kein|einer|einem|einen|aufnahme|stream|kamera|bewegung|verbindung|fehler|wieder|bereit|geladen|gestartet|beendet|freigegeben|erkannt|geprüft|geprueft|waehrend|während)\b)/iu;

function normalize(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }

export function eventTypeLabel(item, t) {
  const type = normalize(item?.type || '');
  if (type === 'camera.log') return t('events.type.cameraLog');
  if (type === 'audit.log') return t('events.type.auditLog');
  if (type === 'system.hello') return t('events.type.systemHello');
  return type || normalize(item?.action) || t('events.system');
}

export function eventComponentLabel(item, t) {
  const payload = item?.payload || item?.details || {};
  const raw = normalize(payload.component || item?.resourceType || item?.source || 'system').toLowerCase();
  if (raw.includes('ai-event-analysis') || raw === 'ai') return t('ai.analysis');
  if (raw.includes('record')) return t('events.source.recording');
  if (raw.includes('motion')) return t('events.source.motion');
  if (raw.includes('ptz')) return t('events.source.ptz');
  if (raw.includes('stream') || raw.includes('go2rtc') || raw.includes('ffmpeg') || raw.includes('onvif')) return t('events.source.stream');
  if (raw.includes('camera')) return t('events.source.camera');
  return t('events.source.system');
}

export function eventMetaLabel(item, t) {
  const payload = item?.payload || item?.details || {};
  const outcome = normalize(item?.outcome).toLowerCase();
  const level = normalize(payload.level).toLowerCase();
  const code = normalize(payload.code || item?.code);
  let state = '';
  if (['success', 'denied', 'failed'].includes(outcome)) state = t(`events.outcome.${outcome}`);
  else if (['info', 'warn', 'error', 'debug'].includes(level)) state = t(`events.level.${level}`);
  const source = code || normalize(item?.source);
  return [state, source].filter(Boolean).join(' · ');
}

export function localizeEventMessage(item, { locale, t } = {}) {
  const payload = item?.payload || item?.details || {};
  const original = normalize(payload.message);
  const code = normalize(payload.code || item?.code);
  if (locale === 'de') {
    if (original) return original;
    return t('events.message.generic', { component: eventComponentLabel(item, t) });
  }
  if (code && codeEnglish[code]) return codeEnglish[code];
  if (original) {
    const legacy = translateLegacyPhrase(locale, original);
    if (legacy && legacy !== original) return legacy;
    if (!germanHint.test(original)) return original;
  }
  if (item?.action && !item?.type) {
    const resource = eventComponentLabel(item, t);
    const resourceId = normalize(item.resourceId);
    return resourceId ? `${resource} · ${resourceId}` : resource;
  }
  return t('events.message.generic', { component: eventComponentLabel(item, t) });
}

export function originalEventMessage(item) {
  const payload = item?.payload || item?.details || {};
  return normalize(payload.message);
}
