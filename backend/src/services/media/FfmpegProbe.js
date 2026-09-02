import { spawn } from 'node:child_process';
import { config } from '../../config.js';
import { AppError } from '../../utils/errors.js';
import { buildMediaInputArgs } from './FfmpegInputOptions.js';

function collect(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new AppError(504, 'MEDIA_PROBE_TIMEOUT', 'Medienpruefung hat das Zeitlimit ueberschritten'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.once('error', (error) => finish(reject, error));
    child.once('exit', (code) => {
      if (code === 0) finish(resolve, stdout);
      else finish(reject, new AppError(502, 'MEDIA_PROBE_FAILED', 'Kameraquelle konnte nicht geprueft werden', sanitize(stderr)));
    });
  });
}

export function sanitize(message) {
  return String(message || '')
    .replace(/\b(?:rtsp|https?):\/\/[^\s]+/gi, '[Medienadresse]')
    .replace(/(Authorization:|password=|pass=)[^\s]+/gi, '$1[REDACTED]')
    .split('\n').filter(Boolean).slice(-8).join(' | ').slice(0, 1200);
}

export function buildProbeArgs(uri, transport = 'tcp') {
  return [
    '-v', 'error',
    ...buildMediaInputArgs(uri, transport, { reconnectAtEof: false }),
    '-show_streams', '-show_format', '-of', 'json', uri,
  ];
}

export async function probeMedia(uri, transport = 'tcp') {
  const output = await collect(
    spawn(config.ffprobePath, buildProbeArgs(uri, transport), { stdio: ['ignore', 'pipe', 'pipe'] }),
    config.probeTimeoutMs + 1500,
  );
  const parsed = JSON.parse(output);
  const video = parsed.streams?.find((stream) => stream.codec_type === 'video') || null;
  const audio = parsed.streams?.find((stream) => stream.codec_type === 'audio') || null;
  if (!video) throw new AppError(502, 'NO_VIDEO_TRACK', 'Die Quelle enthaelt keine Videospur');
  return {
    video: video ? {
      codec: video.codec_name,
      profile: video.profile || null,
      level: video.level || null,
      width: video.width,
      height: video.height,
      fps: frameRate(video.avg_frame_rate || video.r_frame_rate),
      hasBFrames: Number(video.has_b_frames || 0) > 0,
      pixelFormat: video.pix_fmt || null,
    } : null,
    audio: audio ? {
      codec: audio.codec_name,
      sampleRate: Number(audio.sample_rate || 0) || null,
      channels: Number(audio.channels || 0) || null,
    } : null,
    bitRate: Number(parsed.format?.bit_rate || 0) || null,
  };
}

function frameRate(value) {
  if (!value || value === '0/0') return null;
  const [a, b] = String(value).split('/').map(Number);
  return b ? a / b : a || null;
}

function normalizedProfile(value) {
  return String(value || '').trim().toLowerCase();
}

export function mediaPolicy(probe, { profile = null, browserVideoMode = config.streamBrowserVideoMode } = {}) {
  const videoCodec = String(probe.video?.codec || '').toLowerCase();
  const isH264 = videoCodec === 'h264';
  const isH265 = ['hevc', 'h265'].includes(videoCodec);
  const ffprobeProfile = normalizedProfile(probe.video?.profile);
  const onvifProfile = normalizedProfile(profile?.videoProfile);
  const effectiveProfile = ffprobeProfile || onvifProfile;
  const pixelFormat = probe.video?.pixelFormat || null;
  const mode = ['copy', 'force-copy', 'copy-first', 'transcode', 'safe'].includes(String(browserVideoMode || '').toLowerCase())
    ? String(browserVideoMode || '').toLowerCase()
    : 'copy-first';

  const forceCopy = mode === 'copy' || mode === 'force-copy';
  const copyFirst = mode === 'copy-first';
  const explicitlyTranscode = mode === 'transcode';
  const browserSafeH264 = isH264
    && !probe.video?.hasBFrames
    && ['yuv420p', null].includes(pixelFormat)
    && (!effectiveProfile || /baseline/.test(effectiveProfile));
  // H.264 is first remuxed without re-encoding. The browser reports an actual
  // playback failure and only then starts a separate on-demand transcode path.
  const copyVideo = forceCopy || (!explicitlyTranscode && (browserSafeH264 || (copyFirst && isH264)));

  let reason;
  if (copyVideo) {
    reason = forceCopy
      ? 'Video-Durchleitung wurde für den ressourcenschonenden Ingest erzwungen.'
      : copyFirst && !browserSafeH264
        ? 'H.264 wird zunächst verlustfrei durchgereicht; eine Browser-Neukodierung startet nur nach einem echten Wiedergabefehler.'
        : 'H.264 Baseline ohne B-Frames ist browserkompatibel; Video wird verlustfrei durchgereicht.';
  } else if (isH265) {
    reason = 'H.265/HEVC wird für eine einheitliche WebRTC- und HLS-Wiedergabe automatisch nach H.264 Baseline transkodiert.';
  } else if (isH264 && !browserSafeH264) {
    reason = 'H.264 ist vorhanden, aber nicht sicher browserkompatibel (Profil, Pixelformat, B-Frames oder GOP); Ausgabe wird nach H.264 Baseline mit frischen Keyframes normalisiert.';
  } else {
    reason = 'Videocodec oder GOP-Struktur wird für WebRTC und HLS nach H.264 Baseline normalisiert.';
  }

  return {
    copyVideo,
    transcodeVideo: !copyVideo,
    sourceVideoCodec: isH265 ? 'h265' : videoCodec || null,
    sourceVideoProfile: effectiveProfile || null,
    sourcePixelFormat: pixelFormat,
    browserVideoMode: mode,
    outputVideoCodec: 'h264',
    transcodeAudio: Boolean(probe.audio),
    outputAudioCodecs: probe.audio ? { webrtc: 'opus', hls: 'aac' } : null,
    reason,
  };
}
