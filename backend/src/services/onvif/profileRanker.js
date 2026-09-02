const MAIN_WORDS = /(main|primary|high|haupt|stream1|profile1)/i;
const SUB_WORDS = /(sub|second|secondary|low|mobile|stream2|profile2)/i;

export function codecFamily(value) {
  const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.includes('H265') || compact.includes('HEVC')) return 'h265';
  if (compact.includes('H264') || compact === 'AVC' || compact.includes('AVC1')) return 'h264';
  return 'other';
}

function pixels(profile) {
  return Number(profile.width || 0) * Number(profile.height || 0);
}

export function rankProfiles(inputProfiles) {
  const profiles = inputProfiles.map((profile) => ({ ...profile }));
  if (!profiles.length) return [];

  const sorted = [...profiles].sort((a, b) => {
    const codecA = codecFamily(a.videoCodec) === 'h264' ? 0 : codecFamily(a.videoCodec) === 'h265' ? 1 : 2;
    const codecB = codecFamily(b.videoCodec) === 'h264' ? 0 : codecFamily(b.videoCodec) === 'h265' ? 1 : 2;
    if (codecA !== codecB) return codecA - codecB;
    return pixels(b) - pixels(a) || Number(b.bitrate || 0) - Number(a.bitrate || 0);
  });

  const largest = Math.max(...profiles.map(pixels));
  const smallest = Math.min(...profiles.map(pixels));
  const midpoint = (largest + smallest) / 2;

  return sorted.map((profile, rank) => {
    const name = profile.name || '';
    const px = pixels(profile);
    let role = 'balanced';
    if (MAIN_WORDS.test(name) || px === largest) role = 'high';
    if (SUB_WORDS.test(name) || px === smallest) role = 'low';
    if (profiles.length === 1) role = 'high';
    if (!MAIN_WORDS.test(name) && !SUB_WORDS.test(name) && px !== largest && px !== smallest) {
      role = Math.abs(px - midpoint) < Math.abs(px - largest) ? 'balanced' : 'high';
    }
    return { ...profile, role, rank };
  });
}

export function chooseProfiles(profiles, quality = 'auto', viewportWidth = 1280, codecPreference = 'auto') {
  const requested = quality === 'auto'
    ? viewportWidth <= 720 ? 'low' : viewportWidth <= 1440 ? 'balanced' : 'high'
    : quality;
  const order = requested === 'high' ? ['high', 'balanced', 'low']
    : requested === 'low' ? ['low', 'balanced', 'high']
      : ['balanced', 'low', 'high'];
  const selected = [];
  for (const role of order) {
    for (const profile of profiles.filter((item) => item.role === role)) {
      if (!selected.some((item) => item.token === profile.token)) selected.push(profile);
    }
  }
  for (const profile of profiles) if (!selected.some((item) => item.token === profile.token)) selected.push(profile);
  if (!['h264', 'h265'].includes(codecPreference)) return selected;
  const preferred = selected.filter((profile) => codecFamily(profile.videoCodec) === codecPreference);
  const fallback = selected.filter((profile) => codecFamily(profile.videoCodec) !== codecPreference);
  return [...preferred, ...fallback];
}
