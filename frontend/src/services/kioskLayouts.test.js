import { describe, expect, it } from 'vitest';
import {
  applyKioskTemplate,
  autoAssignKioskLayout,
  buildAutomaticKioskLayout,
  createKioskLayout,
  loadKioskLayouts,
  saveKioskLayouts,
} from './kioskLayouts.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

const cameras = Array.from({ length: 7 }, (_, index) => ({ id: `cam-${index + 1}` }));

describe('kioskLayouts', () => {
  it('builds an automatic grid for all enabled cameras', () => {
    const layout = buildAutomaticKioskLayout(cameras);
    expect(layout.columns).toBe(3);
    expect(layout.rows).toBe(3);
    expect(layout.slots).toHaveLength(7);
  });

  it('creates an asymmetric focus layout with deterministic camera assignments', () => {
    const layout = createKioskLayout({ templateId: 'focus-five', cameras, name: 'Eingang' });
    expect(layout.name).toBe('Eingang');
    expect(layout.columns).toBe(4);
    expect(layout.rows).toBe(2);
    expect(layout.slots[0]).toMatchObject({ cameraId: 'cam-1', columnSpan: 2, rowSpan: 2 });
  });

  it('keeps existing assignments when switching templates', () => {
    const first = createKioskLayout({ templateId: 'quad', cameras });
    const next = applyKioskTemplate(first, 'wide-six', cameras);
    expect(next.slots.slice(0, 4).map((item) => item.cameraId)).toEqual(['cam-1', 'cam-2', 'cam-3', 'cam-4']);
  });

  it('can reassign a layout sequentially', () => {
    const layout = createKioskLayout({ templateId: 'focus-five', cameras: [] });
    expect(autoAssignKioskLayout(layout, cameras).slots[4].cameraId).toBe('cam-5');
  });

  it('persists and sanitizes user layouts', () => {
    const storage = memoryStorage();
    const layout = createKioskLayout({ templateId: 'quad', cameras });
    saveKioskLayouts([layout], storage);
    const loaded = loadKioskLayouts(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].slots[0].cameraId).toBe('cam-1');
  });
});
