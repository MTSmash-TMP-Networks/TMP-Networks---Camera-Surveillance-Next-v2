import { buildMediaInputArgs } from './FfmpegInputOptions.js';

function videoArgs(policy, probe) {
  if (policy.copyVideo) return ['-c:v', 'copy'];
  const fps = Math.max(10, Math.min(30, Math.round(probe.video?.fps || 25)));
  return [
    '-vf', `fps=${fps},format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-profile:v', 'baseline', '-level', '4.1', '-pix_fmt', 'yuv420p',
    '-r', String(fps), '-fps_mode', 'cfr', '-g', String(fps), '-keyint_min', String(fps),
    '-sc_threshold', '0', '-bf', '0', '-maxrate', '4500k', '-bufsize', '9000k',
  ];
}

function audioOutputArgs(probe) {
  if (!probe.audio) return [];
  const channels = Number(probe.audio.channels || 1) > 1 ? '2' : '1';
  return [
    '-c:a:0', 'libopus', '-application:a:0', 'lowdelay', '-frame_duration:a:0', '20',
    '-ar:a:0', '48000', '-ac:a:0', channels, '-b:a:0', '64k',
    '-c:a:1', 'aac', '-profile:a:1', 'aac_low', '-ar:a:1', '48000',
    '-ac:a:1', channels, '-b:a:1', channels === '2' ? '128k' : '80k',
  ];
}

function escapeTeeTarget(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

export function teeTarget(url, audioIndex = null) {
  const select = audioIndex === null ? "v\\:0" : `v\\:0,a\\:${audioIndex}`;
  return `[onfail=ignore:f=rtsp:rtsp_transport=tcp:select='${select}']${escapeTeeTarget(url)}`;
}

export function buildFfmpegArgs({ sourceUri, inputTransport, policy, probe, webrtcOutput, hlsOutput }) {
  const args = [
    '-hide_banner', '-nostdin', '-loglevel', 'warning', '-stats_period', '1',
    '-progress', 'pipe:1',
    ...buildMediaInputArgs(sourceUri, inputTransport, { threadQueueSize: 1024 }),
  ];

  args.push(
    '-fflags', '+genpts+discardcorrupt', '-flags', 'low_delay',
    '-analyzeduration', '3000000', '-probesize', '6000000',
    '-i', sourceUri,
    '-map', '0:v:0',
  );

  if (probe.audio) args.push('-map', '0:a:0', '-map', '0:a:0');
  args.push(
    ...videoArgs(policy, probe),
    ...audioOutputArgs(probe),
    '-max_muxing_queue_size', '2048', '-avoid_negative_ts', 'make_zero',
    '-f', 'tee', '-use_fifo', '1',
    '-fifo_options', 'attempt_recovery=1:recover_any_error=1:drop_pkts_on_overflow=1',
  );

  const outputs = probe.audio
    ? `${teeTarget(webrtcOutput, 0)}|${teeTarget(hlsOutput, 1)}`
    : `${teeTarget(webrtcOutput)}|${teeTarget(hlsOutput)}`;
  args.push(outputs);
  return args;
}


export function buildSnapshotVideoArgs({ webrtcOutput, hlsOutput, width = 1280, height = 720, fps = 5 }) {
  const safeFps = Math.max(1, Math.min(12, Math.round(Number(fps) || 5)));
  const safeWidth = Math.max(320, Math.min(1920, Math.round(Number(width) || 1280)));
  const safeHeight = Math.max(180, Math.min(1080, Math.round(Number(height) || 720)));
  const filter = `scale=${safeWidth}:${safeHeight}:force_original_aspect_ratio=decrease,pad=${safeWidth}:${safeHeight}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,fps=${safeFps}`;
  return [
    '-hide_banner', '-loglevel', 'warning', '-stats_period', '1', '-progress', 'pipe:1',
    '-fflags', '+genpts+discardcorrupt',
    '-f', 'image2pipe', '-framerate', String(safeFps), '-vcodec', 'mjpeg', '-i', 'pipe:0',
    '-map', '0:v:0', '-vf', filter,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-profile:v', 'baseline', '-level', '4.1', '-pix_fmt', 'yuv420p',
    '-r', String(safeFps), '-g', String(safeFps), '-keyint_min', String(safeFps), '-sc_threshold', '0', '-bf', '0',
    '-an', '-max_muxing_queue_size', '1024', '-avoid_negative_ts', 'make_zero',
    '-f', 'tee', '-use_fifo', '1',
    '-fifo_options', 'attempt_recovery=1:recover_any_error=1:drop_pkts_on_overflow=1',
    `${teeTarget(webrtcOutput)}|${teeTarget(hlsOutput)}`,
  ];
}

export function buildSnapshotLocalHlsArgs({ outputDir, width = 1280, height = 720, fps = 5, segmentSeconds = 1, listSize = 8 }) {
  const safeFps = Math.max(1, Math.min(12, Math.round(Number(fps) || 5)));
  const safeWidth = Math.max(320, Math.min(1920, Math.round(Number(width) || 1280)));
  const safeHeight = Math.max(180, Math.min(1080, Math.round(Number(height) || 720)));
  const safeSegmentSeconds = Math.max(1, Math.min(6, Math.round(Number(segmentSeconds) || 1)));
  const safeListSize = Math.max(4, Math.min(20, Math.round(Number(listSize) || 8)));
  const directory = outputDir.replace(/\/$/, '');
  const filter = `scale=${safeWidth}:${safeHeight}:force_original_aspect_ratio=decrease,pad=${safeWidth}:${safeHeight}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,fps=${safeFps}`;
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'warning', '-y',
    '-fflags', '+genpts+discardcorrupt', '-use_wallclock_as_timestamps', '1',
    '-f', 'image2pipe', '-framerate', String(safeFps), '-vcodec', 'mjpeg', '-i', 'pipe:0',
    '-map', '0:v:0', '-vf', filter,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-profile:v', 'baseline', '-level', '4.1', '-pix_fmt', 'yuv420p',
    '-r', String(safeFps), '-g', String(safeFps), '-keyint_min', String(safeFps), '-sc_threshold', '0', '-bf', '0',
    '-an', '-max_muxing_queue_size', '1024', '-avoid_negative_ts', 'make_zero', '-muxdelay', '0',
    '-progress', 'pipe:1', '-stats_period', '1',
    '-f', 'hls', '-hls_segment_type', 'mpegts',
    '-hls_time', String(safeSegmentSeconds), '-hls_list_size', String(safeListSize), '-hls_delete_threshold', '3',
    '-hls_start_number_source', 'epoch',
    '-hls_flags', 'delete_segments+append_list+independent_segments+program_date_time+temp_file+omit_endlist',
    '-hls_segment_filename', `${directory}/seg_%010d.ts`,
    `${directory}/index.m3u8`,
  ];
}

export function buildLocalHlsRingArgs({ sourceUri, outputDir, includeAudio = false, segmentSeconds = 1, listSize = 8 }) {
  const safeSegmentSeconds = Math.max(1, Math.min(6, Math.round(Number(segmentSeconds) || 1)));
  const safeListSize = Math.max(4, Math.min(20, Math.round(Number(listSize) || 8)));
  const directory = outputDir.replace(/\/$/, '');
  const isRtspInput = /^rtsps?:\/\//i.test(String(sourceUri || ''));
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'warning', '-y',
    ...(isRtspInput ? ['-rtsp_transport', 'tcp'] : []),
    '-thread_queue_size', '1024',
    '-fflags', '+genpts+discardcorrupt', '-flags', 'low_delay',
    '-use_wallclock_as_timestamps', '1',
    '-analyzeduration', '5000000', '-probesize', '5000000',
    '-i', sourceUri,
    '-map', '0:v:0',
    ...(includeAudio ? ['-map', '0:a:0?', '-c:a', 'copy'] : ['-an']),
    '-c:v', 'copy',
    '-max_muxing_queue_size', '2048', '-avoid_negative_ts', 'make_zero', '-muxdelay', '0',
    '-progress', 'pipe:1', '-stats_period', '1',
    '-f', 'hls', '-hls_segment_type', 'mpegts',
    '-hls_time', String(safeSegmentSeconds), '-hls_list_size', String(safeListSize), '-hls_delete_threshold', '3',
    '-hls_start_number_source', 'epoch',
    '-hls_flags', 'delete_segments+append_list+independent_segments+program_date_time+temp_file+omit_endlist',
    '-hls_segment_filename', `${directory}/seg_%010d.ts`,
    `${directory}/index.m3u8`,
  ];
}
