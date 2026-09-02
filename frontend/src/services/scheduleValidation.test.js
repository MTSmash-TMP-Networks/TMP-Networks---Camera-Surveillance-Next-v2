import { describe, expect, it } from 'vitest';
import { isValidIsoDate, isValidTimeZone, parseDateList, validateRecordingPlans } from './scheduleValidation.js';

describe('Planvalidierung', () => {
  it('normalisiert Datumslisten', () => {
    expect(parseDateList('2026-01-01, 2026-01-01;2026-12-25')).toEqual(['2026-01-01', '2026-12-25']);
  });

  it('prüft echte Kalenderdaten und IANA-Zeitzonen', () => {
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('TMP/Unbekannt')).toBe(false);
  });

  it('akzeptiert überlappende valide Pläne', () => {
    const base = { name: 'Plan', mode: 'scheduled', timezone: 'Europe/Berlin', weekdays: [1], startTime: '08:00', endTime: '16:00', includeDates: [], excludeDates: [], holidayDates: [], holidayPolicy: 'include', priority: 100, prebufferSeconds: 0, postbufferSeconds: 10 };
    expect(validateRecordingPlans([base, { ...base, name: 'Plan 2', startTime: '10:00' }])).toEqual([]);
  });

  it('meldet ungültige Kalenderwerte', () => {
    const errors = validateRecordingPlans([{ name: '', mode: 'event', weekdays: [], startTime: '25:00', endTime: '16:00', eventTypes: [], includeDates: ['kaputt'], excludeDates: [], holidayDates: [] }]);
    expect(errors.length).toBeGreaterThan(2);
  });
});
