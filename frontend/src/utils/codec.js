export function codecFamily(value) {
  const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.includes('H265') || compact.includes('HEVC')) return 'h265';
  if (compact.includes('H264') || compact === 'AVC' || compact.includes('AVC1')) return 'h264';
  return 'other';
}

export function codecLabel(profile = {}) {
  const family = codecFamily(profile.videoCodec);
  const codec = family === 'h265' ? 'H.265 / HEVC' : family === 'h264' ? 'H.264 / AVC' : (profile.videoCodec || 'Unbekannt');
  return profile.videoProfile ? `${codec} ${profile.videoProfile}` : codec;
}

export function codecPreferenceLabel(value) {
  if (value === 'h265') return 'H.265 / HEVC bevorzugen';
  if (value === 'h264') return 'H.264 / AVC bevorzugen';
  return 'Automatisch (H.264 bevorzugt)';
}
