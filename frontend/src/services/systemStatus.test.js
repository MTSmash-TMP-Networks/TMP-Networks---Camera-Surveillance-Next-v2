import { describe, expect, it } from 'vitest';
import { appendMetricSample, formatBitRate, formatBytes, formatDuration, metricSeverity } from './systemStatus.js';

describe('Systemstatus-Helfer', () => {
  it('formatiert Speicherwerte und Laufzeiten lesbar', () => {
    expect(formatBytes(1024 ** 3)).toBe('1.0 GiB');
    expect(formatDuration(90061)).toBe('1 T 1 Std');
    expect(formatDuration(3660, { day: 'j', hour: 'h', minute: 'min' })).toBe('1 h 1 min');
    expect(formatBitRate(125000)).toBe('1.0 Mbit/s');
  });

  it('bewertet Lastschwellen und begrenzt die Historie', () => {
    expect(metricSeverity(74)).toBe('normal');
    expect(metricSeverity(80)).toBe('warning');
    expect(metricSeverity(95)).toBe('critical');
    expect(appendMetricSample([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
  });
});
