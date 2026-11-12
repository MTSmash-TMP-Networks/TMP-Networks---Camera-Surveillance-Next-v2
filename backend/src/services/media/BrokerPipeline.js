import crypto from 'node:crypto';

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function safeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'camera';
}

function stripCredentials(value) {
  return String(value || '').replace(/:\/\/([^:@/]+):([^@/]+)@/g, '://');
}

function appendOptions(source, options) {
  const clean = String(source || '').trim();
  if (!clean) throw new Error('Broker source is empty');
  const suffix = options.filter(Boolean).join('#');
  return suffix ? `${clean}#${suffix}` : clean;
}

export function brokerStreamPaths(cameraId, profile = {}, candidate = {}, encoder = 'software') {
  const parts = [
    String(cameraId || ''),
    String(profile?.token || profile?.name || ''),
    String(candidate?.sourceId || ''),
    stripCredentials(candidate?.uri || ''),
  ];
  // The historical software path stays stable. Copy/VAAPI get independent
  // broker paths so a retry never alters another active stream's producer.
  if (encoder === 'copy' || encoder === 'vaapi') parts.push(encoder);
  const identity = parts.join('|');
  const digest = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 14);
  const base = `cam_${safeName(cameraId).slice(0, 20)}_${digest}`;
  return {
    raw: `${base}_raw`,
    video: `${base}_video`,
    audio: `${base}_audio`,
  };
}

export function nativeBrokerSource(sourceUri, inputTransport, timeoutSeconds = 20) {
  const source = String(sourceUri || '').trim();
  if (!source) throw new Error('Broker source is empty');
  const scheme = lower(source.split(':', 1)[0]);
  const timeout = Math.max(5, Math.min(120, Math.round(Number(timeoutSeconds) || 20)));
  if (!['rtsp', 'rtsps'].includes(scheme)) return source;
  const transport = lower(inputTransport) === 'udp' ? 'udp' : 'tcp';
  return appendOptions(source, [
    `transport=${transport}`,
    `timeout=${timeout}`,
    'backchannel=0',
  ]);
}

export function normalizedVideoSource(rawStreamName, timeoutSeconds = 20, hardware = 'none') {
  const name = String(rawStreamName || '').trim();
  if (!name) throw new Error('Raw broker stream name is empty');
  const timeout = Math.max(5, Math.min(120, Math.round(Number(timeoutSeconds) || 20)));
  const video = hardware === 'copy' ? 'copy' : 'h264';
  return `ffmpeg:${name}#video=${video}#timeout=${timeout}${hardware === 'vaapi' ? '#hardware=vaapi' : ''}`;
}

export function optionalAudioSource(rawStreamName, timeoutSeconds = 20, hardware = 'none') {
  const name = String(rawStreamName || '').trim();
  if (!name) throw new Error('Raw broker stream name is empty');
  const timeout = Math.max(5, Math.min(120, Math.round(Number(timeoutSeconds) || 20)));
  const video = hardware === 'copy' ? 'copy' : 'h264';
  return `ffmpeg:${name}#video=${video}#audio=aac#timeout=${timeout}${hardware === 'vaapi' ? '#hardware=vaapi' : ''}`;
}

function codecName(profile) {
  const codec = lower(profile?.videoCodec);
  if (codec === 'h264' || codec === 'avc') return 'h264';
  if (codec === 'h265' || codec === 'hevc') return 'hevc';
  if (codec === 'mjpeg' || codec === 'jpeg') return 'mjpeg';
  return codec || null;
}

export function profileMedia(profile = {}) {
  const fps = Number(profile?.fps || 0) || null;
  const width = Number(profile?.width || 0) || null;
  const height = Number(profile?.height || 0) || null;
  return {
    video: {
      codec: codecName(profile),
      profile: profile?.videoProfile || null,
      level: null,
      width,
      height,
      fps,
      hasBFrames: null,
      pixelFormat: null,
    },
    audio: profile?.audioCodec ? { codec: lower(profile.audioCodec), sampleRate: null, channels: null } : null,
    bitRate: Number(profile?.bitrate || 0) || null,
    source: 'onvif-profile-metadata',
  };
}

export function normalizedBrokerPolicy(profile = {}, encoder = 'software') {
  return {
    copyVideo: encoder === 'copy',
    transcodeVideo: encoder !== 'copy',
    sourceVideoCodec: codecName(profile),
    sourceVideoProfile: lower(profile?.videoProfile) || null,
    sourcePixelFormat: null,
    browserVideoMode: 'broker-normalized',
    outputVideoCodec: 'h264',
    transcodeAudio: false,
    outputAudioCodecs: null,
    reason: encoder === 'copy'
      ? 'H.264-Profil wird ohne erneute Videokodierung weitergegeben.'
      : encoder === 'vaapi'
        ? 'Intel VAAPI kodiert den zentralen Broker als H.264.'
        : 'go2rtc kodiert den Raw-Producer per Software in H.264.',
  };
}

// A known H.264 profile can be remuxed, while H.265/MJPEG must first be
// converted to browser-compatible H.264. A failed copy or GPU attempt is
// retried only for the specific camera/profile/source.
export function brokerEncoderCandidates(profile = {}, hardware = 'none', copyFirst = true) {
  const candidates = [];
  if (copyFirst && codecName(profile) === 'h264') candidates.push('copy');
  if (hardware === 'vaapi') candidates.push('vaapi');
  candidates.push('software');
  return candidates;
}

export function isBrokerEncoderRetryable(error) {
  const code = String(error?.code || '');
  return code === 'STREAM_NOT_READY' || code === 'FFMPEG_EXITED'
    || /vaapi|renderD128|drm device|hardware encoder/i.test(String(error?.message || ''));
}
