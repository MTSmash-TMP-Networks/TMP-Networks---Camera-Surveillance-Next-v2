import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KIOSK_LAYOUT_TEMPLATES,
  applyKioskTemplate,
  autoAssignKioskLayout,
  buildAutomaticKioskLayout,
  createKioskLayout,
  loadKioskLayouts,
  saveKioskLayouts,
} from '../frontend/src/services/kioskLayouts.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cameras = Array.from({ length: 7 }, (_, index) => ({ id: `cam-${index + 1}`, name: `Camera ${index + 1}` }));

assert.equal(KIOSK_LAYOUT_TEMPLATES.length, 8);
const automatic = buildAutomaticKioskLayout(cameras);
assert.deepEqual([automatic.columns, automatic.rows, automatic.slots.length], [3, 3, 7]);

const focus = createKioskLayout({ templateId: 'focus-five', cameras, name: 'Entrance' });
assert.equal(focus.slots.length, 5);
assert.deepEqual([focus.slots[0].columnSpan, focus.slots[0].rowSpan], [2, 2]);
assert.equal(focus.slots[0].cameraId, 'cam-1');

const wide = applyKioskTemplate(focus, 'wide-six', cameras);
assert.equal(wide.slots.length, 6);
assert.equal(wide.slots[0].cameraId, 'cam-1');
assert.equal(autoAssignKioskLayout(wide, cameras).slots[5].cameraId, 'cam-6');

const values = new Map();
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
saveKioskLayouts([focus], storage);
assert.equal(loadKioskLayouts(storage)[0].name, 'Entrance');

const page = fs.readFileSync(path.join(root, 'frontend/src/pages/KioskPage.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend/src/styles/app.css'), 'utf8');
for (const token of ["t('kiosk.layouts.title')", 'KioskLayoutEditor', 'kiosk-layout-assignment-grid', 'buildAutomaticKioskLayout']) assert.ok(page.includes(token), `missing ${token}`);
for (const token of ['.kiosk-layout-grid', '.kiosk-layout-dialog', '.kiosk-layout-miniature']) assert.ok(css.includes(token), `missing ${token}`);

console.log(`Kiosk layout smoke test OK: ${KIOSK_LAYOUT_TEMPLATES.length} templates, persistence and focus layouts verified.`);
