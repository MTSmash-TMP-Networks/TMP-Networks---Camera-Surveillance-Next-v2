import { beforeAll, describe, expect, it } from 'vitest';
import { db, migrate } from '../src/db/database.js';
import { kioskLayoutSettingsService } from '../src/services/KioskLayoutSettingsService.js';

const key = 'kiosk_layouts_shared_v1';
const sample = {
  id: 'layout-sync-test',
  name: 'Shared kiosk test',
  templateId: 'single',
  columns: 1,
  rows: 1,
  slots: [{ id: 'a', column: 1, row: 1, columnSpan: 1, rowSpan: 1, cameraId: '' }],
};

beforeAll(() => migrate());

describe('Server-side shared kiosk layout settings', () => {
  it('persists layouts across reads and rejects stale revisions', () => {
    const old = db.prepare('SELECT value,updated_at FROM system_settings WHERE key=?').get(key);
    try {
      db.prepare('DELETE FROM system_settings WHERE key=?').run(key);
      const empty = kioskLayoutSettingsService.get();
      expect(empty).toMatchObject({ initialized: false, revision: 0, activeLayoutId: 'auto' });
      const updated = kioskLayoutSettingsService.save({
        layouts: [sample],
        activeLayoutId: sample.id,
        expectedRevision: empty.revision,
      });
      expect(updated).toMatchObject({ initialized: true, revision: 1, activeLayoutId: sample.id });
      expect(kioskLayoutSettingsService.get().layouts).toEqual([sample]);
      expect(() => kioskLayoutSettingsService.save({
        layouts: [], activeLayoutId: 'auto', expectedRevision: 0,
      })).toThrow(/anderen Geraet/);
      expect(kioskLayoutSettingsService.get().revision).toBe(1);
      expect(kioskLayoutSettingsService.get().layouts).toEqual([sample]);
      const cleared = kioskLayoutSettingsService.save({
        layouts: [], activeLayoutId: 'auto', expectedRevision: 1,
      });
      expect(cleared.revision).toBe(2);
      expect(cleared.layouts).toEqual([]);
    } finally {
      if (!old) db.prepare('DELETE FROM system_settings WHERE key=?').run(key);
      else db.prepare('INSERT INTO system_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(key, old.value, old.updated_at);
    }
  });
});
