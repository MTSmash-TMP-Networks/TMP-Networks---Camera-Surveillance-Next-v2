const PRESETS = new Set(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow']);

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

export function normalizeRecordingCompressionPreset(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return PRESETS.has(normalized) ? normalized : 'veryfast';
}

export function buildRecordingCompressionArgs({
  inputPath,
  outputPath,
  crf = 29,
  maxVideoBitrateKbps = 2500,
  preset = 'veryfast',
  threads = 1,
  maxHeight = 0,
  audioBitrateKbps = 64,
} = {}) {
  if (!inputPath || !outputPath) throw new Error('Ein- und Ausgabepfad der Aufnahme-Komprimierung fehlen');
  const normalizedHeight = integer(maxHeight, 0, 0, 4320);
  const normalizedMaxVideoBitrateKbps = integer(maxVideoBitrateKbps, 2500, 0, 50000);
  const filters = normalizedHeight > 0 ? ['-vf', `scale=-2:min(ih\\,${normalizedHeight})`] : [];
  const bitrateControl = normalizedMaxVideoBitrateKbps > 0
    ? ['-maxrate', `${normalizedMaxVideoBitrateKbps}k`, '-bufsize', `${normalizedMaxVideoBitrateKbps * 2}k`]
    : [];
  return [
    '-hide_banner', '-nostdin', '-y', '-loglevel', 'warning',
    '-fflags', '+genpts+discardcorrupt', '-err_detect', 'ignore_err',
    '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-map_metadata', '-1',
    ...filters,
    '-c:v', 'libx264',
    '-preset', normalizeRecordingCompressionPreset(preset),
    '-crf', String(integer(crf, 29, 18, 40)),
    ...bitrateControl,
    '-pix_fmt', 'yuv420p',
    '-threads:v', String(integer(threads, 1, 1, 16)),
    '-c:a', 'aac',
    '-b:a', `${integer(audioBitrateKbps, 64, 24, 320)}k`,
    '-ac', '2',
    '-avoid_negative_ts', 'make_zero',
    '-max_muxing_queue_size', '2048',
    '-mpegts_flags', '+resend_headers+initial_discontinuity',
    '-muxdelay', '0', '-muxpreload', '0',
    '-f', 'mpegts', outputPath,
  ];
}
