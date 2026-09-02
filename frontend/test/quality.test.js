import { describe, expect, it } from 'vitest';
import { qualityForWidth, reduceQuality } from '../src/services/quality.js';

describe('Adaptive Stream-Qualitaet', () => {
  it('waehlt Kachel-, Standard- und Vollbildprofil', () => {
    expect(qualityForWidth(480)).toBe('low');
    expect(qualityForWidth(1280)).toBe('balanced');
    expect(qualityForWidth(1920)).toBe('high');
  });

  it('reduziert die Qualitaet stufenweise bei Paketverlust', () => {
    expect(reduceQuality('high', 1)).toBe('balanced');
    expect(reduceQuality('high', 2)).toBe('low');
    expect(reduceQuality('low', 2)).toBe('low');
  });
});
