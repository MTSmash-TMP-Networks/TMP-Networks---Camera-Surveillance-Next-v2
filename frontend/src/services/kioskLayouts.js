export const KIOSK_LAYOUTS_STORAGE_KEY = 'tmp-camera-kiosk-layouts-v1';
export const KIOSK_ACTIVE_LAYOUT_STORAGE_KEY = 'tmp-camera-kiosk-active-layout-v1';

const slot = (id, column, row, columnSpan = 1, rowSpan = 1) => ({ id, column, row, columnSpan, rowSpan, cameraId: '' });

export const KIOSK_LAYOUT_TEMPLATES = Object.freeze([
  {
    id: 'single',
    name: '1 Kamera',
    description: 'Eine Kamera bildschirmfüllend',
    columns: 1,
    rows: 1,
    slots: [slot('a', 1, 1)],
  },
  {
    id: 'quad',
    name: '2 × 2',
    description: 'Vier gleich große Kameras',
    columns: 2,
    rows: 2,
    slots: [slot('a', 1, 1), slot('b', 2, 1), slot('c', 1, 2), slot('d', 2, 2)],
  },
  {
    id: 'nine',
    name: '3 × 3',
    description: 'Neun gleich große Kameras',
    columns: 3,
    rows: 3,
    slots: Array.from({ length: 9 }, (_, index) => slot(`s${index + 1}`, (index % 3) + 1, Math.floor(index / 3) + 1)),
  },
  {
    id: 'sixteen',
    name: '4 × 4',
    description: 'Sechzehn gleich große Kameras',
    columns: 4,
    rows: 4,
    slots: Array.from({ length: 16 }, (_, index) => slot(`s${index + 1}`, (index % 4) + 1, Math.floor(index / 4) + 1)),
  },
  {
    id: 'focus-five',
    name: '1 + 4 Fokus',
    description: 'Eine große und vier kleine Kameras',
    columns: 4,
    rows: 2,
    slots: [
      slot('focus', 1, 1, 2, 2),
      slot('s1', 3, 1), slot('s2', 4, 1),
      slot('s3', 3, 2), slot('s4', 4, 2),
    ],
  },
  {
    id: 'focus-seven',
    name: '1 + 6 Fokus',
    description: 'Eine große und sechs kleine Kameras',
    columns: 4,
    rows: 3,
    slots: [
      slot('focus', 1, 1, 2, 3),
      slot('s1', 3, 1), slot('s2', 4, 1),
      slot('s3', 3, 2), slot('s4', 4, 2),
      slot('s5', 3, 3), slot('s6', 4, 3),
    ],
  },
  {
    id: 'dual-six',
    name: '2 + 4 Fokus',
    description: 'Zwei große und vier kleine Kameras',
    columns: 4,
    rows: 3,
    slots: [
      slot('focus1', 1, 1, 2, 2), slot('focus2', 3, 1, 2, 2),
      slot('s1', 1, 3), slot('s2', 2, 3), slot('s3', 3, 3), slot('s4', 4, 3),
    ],
  },
  {
    id: 'wide-six',
    name: '2 × 3',
    description: 'Sechs gleich große Kameras',
    columns: 3,
    rows: 2,
    slots: Array.from({ length: 6 }, (_, index) => slot(`s${index + 1}`, (index % 3) + 1, Math.floor(index / 3) + 1)),
  },
]);

function cloneTemplate(template) {
  return {
    templateId: template.id,
    columns: template.columns,
    rows: template.rows,
    slots: template.slots.map((item) => ({ ...item })),
  };
}

export function getKioskLayoutTemplate(templateId) {
  return KIOSK_LAYOUT_TEMPLATES.find((item) => item.id === templateId) || KIOSK_LAYOUT_TEMPLATES[1];
}

export function createKioskLayout({ templateId = 'quad', cameras = [], name = '' } = {}) {
  const template = getKioskLayoutTemplate(templateId);
  const base = cloneTemplate(template);
  return {
    id: `layout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(name || template.name).trim() || template.name,
    ...base,
    slots: base.slots.map((item, index) => ({ ...item, cameraId: cameras[index]?.id || '' })),
  };
}

export function applyKioskTemplate(layout, templateId, cameras = []) {
  const template = getKioskLayoutTemplate(templateId);
  const previousAssignments = Array.isArray(layout?.slots) ? layout.slots.map((item) => item.cameraId).filter(Boolean) : [];
  const fallbackAssignments = cameras.map((camera) => camera.id);
  const assignments = previousAssignments.length ? previousAssignments : fallbackAssignments;
  const base = cloneTemplate(template);
  return {
    ...(layout || {}),
    templateId: template.id,
    columns: template.columns,
    rows: template.rows,
    slots: base.slots.map((item, index) => ({ ...item, cameraId: assignments[index] || '' })),
  };
}

export function autoAssignKioskLayout(layout, cameras = []) {
  return {
    ...layout,
    slots: (layout?.slots || []).map((item, index) => ({ ...item, cameraId: cameras[index]?.id || '' })),
  };
}

export function sanitizeKioskLayout(layout) {
  if (!layout || typeof layout !== 'object') return null;
  const columns = Math.max(1, Math.min(6, Number(layout.columns) || 1));
  const rows = Math.max(1, Math.min(6, Number(layout.rows) || 1));
  const slots = Array.isArray(layout.slots) ? layout.slots.slice(0, 36).map((item, index) => {
    const column = Math.max(1, Math.min(columns, Number(item?.column) || 1));
    const row = Math.max(1, Math.min(rows, Number(item?.row) || 1));
    const columnSpan = Math.max(1, Math.min(columns - column + 1, Number(item?.columnSpan) || 1));
    const rowSpan = Math.max(1, Math.min(rows - row + 1, Number(item?.rowSpan) || 1));
    return {
      id: String(item?.id || `s${index + 1}`).slice(0, 80),
      column,
      row,
      columnSpan,
      rowSpan,
      cameraId: String(item?.cameraId || '').slice(0, 120),
    };
  }) : [];
  if (!slots.length) return null;
  return {
    id: String(layout.id || `layout-${Date.now()}`).slice(0, 120),
    name: String(layout.name || 'Kiosk-Ansicht').trim().slice(0, 80) || 'Kiosk-Ansicht',
    templateId: String(layout.templateId || 'custom').slice(0, 80),
    columns,
    rows,
    slots,
  };
}

export function loadKioskLayouts(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem?.(KIOSK_LAYOUTS_STORAGE_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.map(sanitizeKioskLayout).filter(Boolean).slice(0, 30);
  } catch {
    return [];
  }
}

export function saveKioskLayouts(layouts, storage = globalThis.localStorage) {
  const safe = (Array.isArray(layouts) ? layouts : []).map(sanitizeKioskLayout).filter(Boolean).slice(0, 30);
  try { storage?.setItem?.(KIOSK_LAYOUTS_STORAGE_KEY, JSON.stringify(safe)); } catch { /* optional browser preference */ }
  return safe;
}

export function loadActiveKioskLayoutId(storage = globalThis.localStorage) {
  try { return storage?.getItem?.(KIOSK_ACTIVE_LAYOUT_STORAGE_KEY) || 'auto'; } catch { return 'auto'; }
}

export function saveActiveKioskLayoutId(layoutId, storage = globalThis.localStorage) {
  const safeId = String(layoutId || 'auto').slice(0, 120);
  try { storage?.setItem?.(KIOSK_ACTIVE_LAYOUT_STORAGE_KEY, safeId); } catch { /* optional browser preference */ }
  return safeId;
}

export function buildAutomaticKioskLayout(cameras = []) {
  const count = Math.max(1, cameras.length);
  const columns = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  const rows = Math.max(1, Math.ceil(count / columns));
  return {
    id: 'auto',
    name: 'Automatisches Raster',
    templateId: 'auto',
    columns,
    rows,
    slots: cameras.map((camera, index) => ({
      id: `auto-${camera.id}`,
      cameraId: camera.id,
      column: (index % columns) + 1,
      row: Math.floor(index / columns) + 1,
      columnSpan: 1,
      rowSpan: 1,
    })),
  };
}
