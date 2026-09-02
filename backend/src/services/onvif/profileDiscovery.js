function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function collapseSoapArrays(value) {
  if (Array.isArray(value)) {
    if (value.length === 1) return collapseSoapArrays(value[0]);
    return value.map(collapseSoapArrays);
  }
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, collapseSoapArrays(child)]));
}

function ownValue(object, key) {
  if (!isObject(object)) return undefined;
  if (Object.prototype.hasOwnProperty.call(object, key)) return object[key];
  const wanted = String(key).toLowerCase();
  const actual = Object.keys(object).find((candidate) => candidate.toLowerCase() === wanted);
  return actual === undefined ? undefined : object[actual];
}

function pathValue(object, path) {
  let current = object;
  for (const key of String(path).split('.')) {
    if (Array.isArray(current) && current.length === 1) current = current[0];
    current = ownValue(current, key);
    if (current === undefined || current === null) return current;
  }
  return current;
}

export function readOnvifValue(object, ...paths) {
  for (const path of paths) {
    const value = pathValue(object, path);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function scalar(value) {
  let current = value;
  while (Array.isArray(current) && current.length === 1) current = current[0];
  if (isObject(current) && Object.prototype.hasOwnProperty.call(current, '_')) return scalar(current._);
  return current;
}

function text(value) {
  const result = scalar(value);
  if (result === undefined || result === null || isObject(result) || Array.isArray(result)) return '';
  return String(result).trim();
}

function number(value) {
  const parsed = Number(scalar(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function list(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function mergeRaw(base, overlay) {
  if (!isObject(base)) return isObject(overlay) ? overlay : base;
  if (!isObject(overlay)) return base;
  const merged = { ...base };
  for (const [overlayKey, overlayValue] of Object.entries(overlay)) {
    if (overlayValue === undefined || overlayValue === null || overlayValue === '') continue;
    const existingKey = Object.keys(merged).find((key) => key.toLowerCase() === overlayKey.toLowerCase()) || overlayKey;
    const existingValue = merged[existingKey];
    merged[existingKey] = isObject(existingValue) && isObject(overlayValue)
      ? mergeRaw(existingValue, overlayValue)
      : overlayValue;
  }
  return merged;
}

export function normalizeVideoCodec(value) {
  const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.includes('H265') || compact.includes('HEVC')) return 'H265';
  if (compact.includes('H264') || compact === 'AVC' || compact.includes('AVC1')) return 'H264';
  if (compact.includes('MPEG4')) return 'MPEG4';
  if (compact.includes('JPEG') || compact.includes('MJPEG')) return 'JPEG';
  return compact || null;
}

export function normalizeVideoProfile(value) {
  const valueText = String(value || '').trim();
  if (!valueText) return null;
  const compact = valueText.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (compact.includes('baseline')) return 'Baseline';
  if (compact.includes('main10')) return 'Main 10';
  if (compact.includes('high')) return 'High';
  if (compact.includes('main')) return 'Main';
  return valueText;
}

export function normalizeMediaService(value) {
  const compact = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['media2', 'media20', 'ver20', 'profilet'].includes(compact)) return 'media2';
  if (['media', 'media1', 'media10', 'ver10', 'profiles'].includes(compact)) return 'media';
  if (compact === 'both') return 'both';
  return 'auto';
}

export function mediaServiceCandidates(value, media2Support = false) {
  const normalized = normalizeMediaService(value);
  if (normalized === 'media2' || normalized === 'both') return ['media2', 'media'];
  if (normalized === 'media') return ['media', 'media2'];
  return media2Support ? ['media2', 'media'] : ['media', 'media2'];
}

function profileEncoder(profile) {
  return readOnvifValue(
    profile,
    'videoEncoderConfiguration',
    'videoEncoder',
    'configurations.videoEncoder',
    'configurations.videoEncoderConfiguration',
  ) || {};
}

function profileAudioEncoder(profile) {
  return readOnvifValue(
    profile,
    'audioEncoderConfiguration',
    'audioEncoder',
    'configurations.audioEncoder',
    'configurations.audioEncoderConfiguration',
  ) || {};
}

function encoderToken(encoder) {
  return text(readOnvifValue(encoder, '$.token', 'token', 'configurationToken'));
}

function profileToken(profile) {
  return text(readOnvifValue(profile, '$.token', 'token', 'profileToken'));
}

function hasNamedObject(object, ...paths) {
  return paths.some((path) => {
    const value = readOnvifValue(object, path);
    return isObject(value) ? Object.keys(value).length > 0 : value !== undefined && value !== null;
  });
}

export function normalizeOnvifProfile(profileInput, { mediaService = 'auto', encoderConfiguration = null } = {}) {
  const profile = collapseSoapArrays(profileInput || {});
  const embeddedEncoder = collapseSoapArrays(profileEncoder(profile));
  const encoder = mergeRaw(collapseSoapArrays(encoderConfiguration || {}), embeddedEncoder);
  const audio = collapseSoapArrays(profileAudioEncoder(profile));
  const resolution = readOnvifValue(encoder, 'resolution') || {};
  const rate = readOnvifValue(encoder, 'rateControl') || {};
  const h264 = readOnvifValue(encoder, 'H264', 'extension.H264') || {};
  const h265 = readOnvifValue(encoder, 'H265', 'HEVC', 'extension.H265', 'extension.HEVC') || {};
  const token = profileToken(profile);
  const name = text(readOnvifValue(profile, 'name')) || token || 'ONVIF-Profil';
  const declaredCodec = text(readOnvifValue(encoder, 'encoding', '$.encoding'));
  const identity = `${name} ${token}`;
  const videoCodec = normalizeVideoCodec(declaredCodec)
    || (hasNamedObject(encoder, 'H265', 'HEVC', 'extension.H265', 'extension.HEVC') ? 'H265' : null)
    || (hasNamedObject(encoder, 'H264', 'extension.H264') ? 'H264' : null)
    || normalizeVideoCodec(identity);
  const videoProfile = normalizeVideoProfile(
    text(readOnvifValue(h265, 'h265Profile', 'HEVCProfile', 'profile', '$.profile'))
    || text(readOnvifValue(h264, 'h264Profile', 'profile', '$.profile'))
    || text(readOnvifValue(encoder, 'profile', '$.profile')),
  );
  const width = number(readOnvifValue(resolution, 'width', '$.width'))
    || number(readOnvifValue(encoder, 'width', '$.width'));
  const height = number(readOnvifValue(resolution, 'height', '$.height'))
    || number(readOnvifValue(encoder, 'height', '$.height'));
  const fps = number(readOnvifValue(rate, 'frameRateLimit', '$.frameRateLimit'))
    || number(readOnvifValue(encoder, 'frameRateLimit', '$.frameRateLimit'));
  const bitrate = number(readOnvifValue(rate, 'bitrateLimit', '$.bitrateLimit'))
    || number(readOnvifValue(encoder, 'bitrateLimit', '$.bitrateLimit'));
  const hasPtz = hasNamedObject(
    profile,
    'PTZConfiguration',
    'ptzConfiguration',
    'PTZConfigurationToken',
    'ptzConfigurationToken',
    'configurations.PTZ',
    'configurations.ptz',
    'configurations.PTZConfiguration',
    'configurations.ptzConfiguration',
  );

  return {
    token,
    name,
    videoCodec,
    videoProfile,
    audioCodec: normalizeVideoCodec(text(readOnvifValue(audio, 'encoding', '$.encoding'))),
    width,
    height,
    fps,
    bitrate,
    hasPtz,
    mediaService: normalizeMediaService(mediaService),
  };
}

function responseItems(data, responseNames, itemNames) {
  const body = collapseSoapArrays(data);
  const responses = Array.isArray(responseNames) ? responseNames : [responseNames];
  const items = Array.isArray(itemNames) ? itemNames : [itemNames];
  const response = readOnvifValue(body, ...responses);
  return list(readOnvifValue(response, ...items)).map(collapseSoapArrays);
}

export function profilesFromSoap(profileData, mediaService, encoderData = null) {
  const service = normalizeMediaService(mediaService);
  const encoders = responseItems(
    encoderData,
    ['getVideoEncoderConfigurationsResponse', 'getVideoEncoderConfigurationResponse'],
    ['configurations', 'configuration', 'videoEncoderConfigurations', 'videoEncoderConfiguration'],
  );
  const encodersByToken = new Map(encoders.map((encoder) => [encoderToken(encoder), encoder]).filter(([token]) => token));
  const profiles = responseItems(profileData, 'getProfilesResponse', ['profiles', 'profile']);
  return profiles.map((profile) => {
    const embedded = collapseSoapArrays(profileEncoder(profile));
    const complete = encodersByToken.get(encoderToken(embedded)) || null;
    return normalizeOnvifProfile(profile, { mediaService: service, encoderConfiguration: complete });
  }).filter((profile) => profile.token);
}

function meaningful(value) {
  return value !== undefined && value !== null && value !== '' && value !== 0;
}

function richness(profile) {
  return ['name', 'videoCodec', 'videoProfile', 'audioCodec', 'width', 'height', 'fps', 'bitrate']
    .reduce((score, key) => score + Number(meaningful(profile?.[key])), 0) + Number(Boolean(profile?.hasPtz));
}

function combinedService(left, right) {
  const a = normalizeMediaService(left);
  const b = normalizeMediaService(right);
  if (a === 'both' || b === 'both') return 'both';
  if (a === 'auto') return b;
  if (b === 'auto') return a;
  return a === b ? a : 'both';
}

function preferredProfile(left, right) {
  const leftService = normalizeMediaService(left.mediaService);
  const rightService = normalizeMediaService(right.mediaService);
  if (rightService === 'media2' && leftService !== 'media2') return [right, left];
  if (leftService === 'media2' && rightService !== 'media2') return [left, right];
  return richness(right) > richness(left) ? [right, left] : [left, right];
}

function mergeProfile(left, right) {
  const [preferred, fallback] = preferredProfile(left, right);
  const merged = { ...fallback, ...preferred };
  for (const key of ['name', 'videoCodec', 'videoProfile', 'audioCodec', 'width', 'height', 'fps', 'bitrate']) {
    if (!meaningful(merged[key]) && meaningful(fallback[key])) merged[key] = fallback[key];
  }
  merged.token = left.token;
  merged.hasPtz = Boolean(left.hasPtz || right.hasPtz);
  merged.mediaService = combinedService(left.mediaService, right.mediaService);
  return merged;
}

export function mergeOnvifProfiles(...groups) {
  const byToken = new Map();
  for (const profile of groups.flat(Infinity).filter(Boolean)) {
    if (!profile.token) continue;
    const existing = byToken.get(profile.token);
    byToken.set(profile.token, existing ? mergeProfile(existing, profile) : { ...profile, mediaService: normalizeMediaService(profile.mediaService) });
  }
  return [...byToken.values()];
}
