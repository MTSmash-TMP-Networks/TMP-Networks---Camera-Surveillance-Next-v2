import { describe, expect, it } from 'vitest';
import { planRetentionDeletion } from '../src/services/recording/RetentionPolicy.js';

const day = 86_400_000;
const now = Date.parse('2026-07-22T12:00:00.000Z');
const row = (id, ageDays, size = 100, patch = {}) => ({
  id, status: 'ready', started_at: new Date(now - ageDays * day).toISOString(), file_size_bytes: size,
  trigger_type: 'manual', retention_class: 'standard', protected_until: null, ...patch,
});
const basePolicy = {
  strategy: 'hybrid', cleanupEnabled: true, maxAgeDays: 30, eventMaxAgeDays: 90,
  maxStorageBytes: 0, minFreeBytes: 0, maxRecordings: 0, protectEventRecordings: true,
};

describe('Aufbewahrungsplanung', () => {
  it('löscht Standardaufnahmen nach der individuellen Frist', () => {
    const result = planRetentionDeletion([row(1, 31), row(2, 5)], basePolicy, { nowMs: now });
    expect(result.map((item) => item.id)).toEqual([1]);
    expect(result[0].reasons).toContain('age');
  });

  it('bewahrt Ereignisaufnahmen bis zur längeren Ereignisfrist auf', () => {
    const event = row(1, 40, 100, { trigger_type: 'event', retention_class: 'event' });
    expect(planRetentionDeletion([event], basePolicy, { nowMs: now })).toHaveLength(0);
    expect(planRetentionDeletion([row(2, 91, 100, { trigger_type: 'event' })], basePolicy, { nowMs: now })[0].reasons).toContain('event-age');
  });

  it('respektiert expliziten Löschschutz', () => {
    const protectedRow = row(1, 100, 100, { protected_until: new Date(now + day).toISOString() });
    expect(planRetentionDeletion([protectedRow], basePolicy, { nowMs: now })).toHaveLength(0);
  });

  it('verbraucht bei Speichergrenzen zuerst gewöhnliche Aufnahmen', () => {
    const policy = { ...basePolicy, strategy: 'quota', maxStorageBytes: 150 };
    const result = planRetentionDeletion([
      row('event', 10, 100, { trigger_type: 'event', retention_class: 'event' }),
      row('standard', 5, 100),
    ], policy, { nowMs: now });
    expect(result.map((item) => item.id)).toEqual(['standard']);
  });

  it('akzeptiert Repository-Modelle mit camelCase-Feldern', () => {
    const result = planRetentionDeletion([{
      id: 7, status: 'ready', startedAt: new Date(now - 31 * day).toISOString(), fileSizeBytes: 42, filePath: '/data/7.mp4',
      triggerType: 'manual', retentionClass: 'standard', protectedUntil: null,
    }], basePolicy, { nowMs: now });
    expect(result[0]).toMatchObject({ id: 7, filePath: '/data/7.mp4', sizeBytes: 42 });
  });

  it('reduziert älteste Aufnahmen bei Quota und Mindestfreiraum zuerst', () => {
    const policy = { ...basePolicy, strategy: 'quota', maxStorageBytes: 150, minFreeBytes: 200 };
    const result = planRetentionDeletion([row(1, 3, 100), row(2, 2, 100), row(3, 1, 100)], policy, { nowMs: now, freeBytes: 50 });
    expect(result[0].id).toBe(1);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});
