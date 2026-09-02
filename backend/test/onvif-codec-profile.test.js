import { describe, expect, it } from 'vitest';
import { normalizeVideoCodec, normalizeVideoProfile } from '../src/services/onvif/profileDiscovery.js';

describe('ONVIF-Codec- und Profilnormalisierung', () => {
  it('erkennt H.265 und HEVC als H265', () => {
    expect(normalizeVideoCodec('H265')).toBe('H265');
    expect(normalizeVideoCodec('H.265')).toBe('H265');
    expect(normalizeVideoCodec('HEVC')).toBe('H265');
    expect(normalizeVideoCodec('H.265 / HEVC MainProfile')).toBe('H265');
    expect(normalizeVideoCodec('H265-main-stream')).toBe('H265');
  });

  it('erkennt H.264-Varianten', () => {
    expect(normalizeVideoCodec('H264')).toBe('H264');
    expect(normalizeVideoCodec('H.264 / AVC')).toBe('H264');
  });

  it('normalisiert Baseline, Main, Main10 und High', () => {
    expect(normalizeVideoProfile('Baseline')).toBe('Baseline');
    expect(normalizeVideoProfile('MainProfile')).toBe('Main');
    expect(normalizeVideoProfile('Main10')).toBe('Main 10');
    expect(normalizeVideoProfile('HighProfile')).toBe('High');
  });
});
