import { describe, expect, it } from 'vitest';
import { codecFamily, codecLabel, codecPreferenceLabel } from './codec.js';

describe('Codec-Anzeige', () => {
  it('erkennt H.265 und HEVC', () => {
    expect(codecFamily('H265')).toBe('h265');
    expect(codecFamily('HEVC')).toBe('h265');
    expect(codecFamily('H.265 / HEVC Main')).toBe('h265');
  });

  it('zeigt Codec und Encoderprofil gemeinsam an', () => {
    expect(codecLabel({ videoCodec: 'H264', videoProfile: 'High' })).toBe('H.264 / AVC High');
    expect(codecLabel({ videoCodec: 'H265', videoProfile: 'Main' })).toBe('H.265 / HEVC Main');
  });

  it('beschreibt die Codec-Praeferenz', () => {
    expect(codecPreferenceLabel('h265')).toContain('H.265');
  });
});
