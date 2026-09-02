import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const editor = readFileSync(resolve(root, 'src/components/MotionZoneEditor.jsx'), 'utf8');
const cameraPage = readFileSync(resolve(root, 'src/pages/EditCameraPage.jsx'), 'utf8');
const css = readFileSync(resolve(root, 'src/styles/app.css'), 'utf8');

test('camera editor persists a per-camera motion zone and offers a snapshot based drag selector', () => {
  assert.match(cameraPage, /motionZone: result\.camera\.motionZone \|\| null/);
  assert.match(cameraPage, /motionZone: form\.motionZone \|\| null/);
  assert.match(cameraPage, /<MotionZoneEditor cameraId=\{id\}/);
  assert.match(editor, /api\.snapshot\(cameraId\)/);
  assert.match(editor, /onPointerDown=\{pointerDown\}/);
  assert.match(editor, /Motion-Bereich begrenzen/);
  assert.match(editor, /Gesamtes Bild verwenden/);
  assert.match(css, /v2\.20\.28 - per-camera motion detection region/);
  assert.match(css, /\.motion-zone-selection/);
});
