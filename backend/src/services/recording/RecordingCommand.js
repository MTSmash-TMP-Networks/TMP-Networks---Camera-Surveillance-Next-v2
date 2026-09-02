import { config } from '../../config.js';
import { prepareMediaReadSource } from '../media/MediaReadAuth.js';

function protocolOf(sourceUri) {
  try { return new URL(sourceUri).protocol.toLowerCase(); } catch { return ''; }
}

function isHlsSource(sourceUri) {
  const value = String(sourceUri || '').toLowerCase();
  return value.includes('.m3u8') || /(?:^|\/)hls(?:\/|$)/.test(value);
}

/**
 * Build protocol-aware input options for the archive recorder.
 *
 * The recorder prefers the internal go2rtc RTSP reader by default. That path
 * follows the same already-running Live publisher but avoids HLS playlist reload
 * edge cases where FFmpeg can keep reconnecting without writing new TS bytes.
 * HLS remains available as an automatic fallback. Use RECORDING_SOURCE_PROTOCOL=rtsp-only or hls-only only for strict troubleshooting.
 */
export function buildRecordingInputArgs(sourceUri) {
  const protocol = protocolOf(sourceUri);
  const common = ['-rw_timeout', '15000000'];
  if (['rtsp:', 'rtsps:'].includes(protocol)) {
    return [
      ...common,
      '-rtsp_transport', 'tcp',
    ];
  }
  if (isHlsSource(sourceUri)) {
    return [
      ...common,
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
    ];
  }
  return [
    ...common,
    '-reconnect', '1',
    '-reconnect_at_eof', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
  ];
}

/**
 * Build a crash-tolerant recording command.
 *
 * With segmentPattern a single long-lived FFmpeg process writes independently
 * closed MPEG-TS blocks. This avoids reconnecting at every block boundary.
 * tempPath is retained for compatibility with focused unit tests and legacy
 * recovery helpers.
 */
export function buildRecordingArgs({
  sourceUri,
  mediaToken = null,
  tempPath = null,
  segmentPattern = null,
  segmentSeconds = 300,
  segmentStartNumber = 1,
  prebufferSeconds = 0,
}) {
  const preparedSource = prepareMediaReadSource(sourceUri, mediaToken);
  const effectiveSourceUri = preparedSource.uri;
  const prebuffer = Math.max(0, Math.min(config.recordingPrebufferMaxSeconds, Number(prebufferSeconds || 0)));
  const prebufferArgs = prebuffer > 0 && isHlsSource(effectiveSourceUri) ? ['-live_start_index', String(-Math.max(1, Math.ceil(prebuffer)))] : [];
  const common = [
    '-hide_banner', '-loglevel', 'warning', '-y',
    ...buildRecordingInputArgs(effectiveSourceUri),
    ...prebufferArgs,
    '-fflags', '+genpts+discardcorrupt', '-err_detect', 'ignore_err',
    ...preparedSource.inputArgs,
    '-i', effectiveSourceUri,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'copy', '-c:a', 'copy',
    '-avoid_negative_ts', 'make_zero',
    '-max_interleave_delta', '0',
    '-progress', 'pipe:1', '-nostats',
  ];

  if (segmentPattern) {
    return [
      ...common,
      '-f', 'segment',
      '-segment_format', 'mpegts',
      '-segment_time', String(Math.max(10, Number(segmentSeconds || 300))),
      '-segment_start_number', String(Math.max(1, Number(segmentStartNumber || 1))),
      '-segment_time_delta', '0.05',
      '-reset_timestamps', '1',
      '-segment_format_options', 'mpegts_flags=+resend_headers+initial_discontinuity',
      segmentPattern,
    ];
  }

  return [
    ...common,
    '-mpegts_flags', '+resend_headers+initial_discontinuity',
    '-muxdelay', '0', '-muxpreload', '0',
    '-f', 'mpegts', tempPath,
  ];
}

/** Legacy export helper retained for old monolithic recordings and recovery. */
export function buildRecordingRemuxArgs(tempPath, finalPath) {
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
    '-fflags', '+genpts+discardcorrupt', '-err_detect', 'ignore_err',
    '-i', tempPath, '-map', '0', '-c', 'copy', '-movflags', '+faststart', finalPath,
  ];
}

export function nextRecordingSegmentNumber({ blockCounter = 0, segmentIndexes = [] } = {}) {
  const indexes = [Number(blockCounter || 0), ...(segmentIndexes || []).map((value) => Number(value || 0))]
    .filter((value) => Number.isInteger(value) && value >= 0);
  return Math.max(0, ...indexes) + 1;
}

/**
 * A running FFmpeg process is not proof that recording has started. HLS and
 * RTSP reconnect loops may stay alive indefinitely without writing media. This
 * helper resolves only after a new block has reached the configured byte floor.
 */
export function waitForRecordingStartup({
  child,
  inspect,
  startIndex = 1,
  timeoutMs = 15_000,
  pollIntervalMs = 100,
  minimumBytes = 188,
  settleMs = 250,
} = {}) {
  if (!child || typeof child.once !== 'function') return Promise.resolve({ ok: false, error: new Error('FFmpeg-Prozess fehlt') });
  if (typeof inspect !== 'function') return Promise.resolve({ ok: false, error: new Error('Aufnahmepruefung fehlt') });

  return new Promise((resolve) => {
    let settled = false;
    let timeout = null;
    let poll = null;
    const normalizedStartIndex = Math.max(1, Number(startIndex) || 1);
    const normalizedMinimumBytes = Math.max(1, Number(minimumBytes) || 188);
    const normalizedSettleMs = Math.max(0, Number(settleMs) || 0);
    const normalizedTimeoutMs = Math.max(100, Number(timeoutMs) || 15_000);
    let mediaCandidate = null;
    let mediaCandidateAt = 0;
    let mediaCandidateSize = 0;
    let mediaCandidateGrew = false;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (poll) clearTimeout(poll);
      child.off?.('error', onError);
      child.off?.('exit', onExit);
      child.off?.('close', onClose);
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const onError = (error) => finish({ ok: false, error });
    const onExit = (code, signal) => finish({ ok: false, error: new Error(`FFmpeg beendet (${code ?? signal})`) });
    const onClose = (code, signal) => finish({ ok: false, error: new Error(`FFmpeg beendet (${code ?? signal})`) });
    const check = () => {
      if (settled) return;
      if (child.exitCode !== null) {
        finish({ ok: false, error: new Error(`FFmpeg beendet (${child.exitCode ?? child.signalCode ?? 'unbekannt'})`) });
        return;
      }
      let files;
      try { files = inspect() || []; }
      catch (error) { finish({ ok: false, error }); return; }
      const file = files
        .filter((item) => Number(item?.index || 0) >= normalizedStartIndex)
        .sort((left, right) => Number(left.index || 0) - Number(right.index || 0))
        .find((item) => Number(item?.sizeBytes || 0) >= normalizedMinimumBytes);
      if (file) {
        const sizeBytes = Number(file.sizeBytes || 0);
        if (!mediaCandidate || Number(mediaCandidate.index) !== Number(file.index)) {
          mediaCandidate = file;
          mediaCandidateAt = Date.now();
          mediaCandidateSize = sizeBytes;
          mediaCandidateGrew = normalizedSettleMs === 0;
        } else {
          if (sizeBytes > mediaCandidateSize) mediaCandidateGrew = true;
          mediaCandidateSize = Math.max(mediaCandidateSize, sizeBytes);
          mediaCandidate = file;
        }
        if (Date.now() - mediaCandidateAt >= normalizedSettleMs && mediaCandidateGrew) {
          finish({ ok: true, file: mediaCandidate });
          return;
        }
      } else {
        mediaCandidate = null;
        mediaCandidateAt = 0;
        mediaCandidateSize = 0;
        mediaCandidateGrew = false;
      }
      poll = setTimeout(check, Math.max(25, Number(pollIntervalMs) || 100));
    };

    child.once('error', onError);
    child.once('exit', onExit);
    child.once('close', onClose);
    timeout = setTimeout(() => finish({
      ok: false,
      error: new Error(`FFmpeg hat innerhalb von ${Math.round(normalizedTimeoutMs / 1000)} Sekunden keine Mediendaten geschrieben`),
    }), normalizedTimeoutMs);
    check();
  });
}

export function reconnectDelay(attempt) {
  return Math.min(config.recordingReconnectBaseMs * (2 ** Math.min(Math.max(0, attempt - 1), 8)), config.recordingReconnectMaxMs);
}
