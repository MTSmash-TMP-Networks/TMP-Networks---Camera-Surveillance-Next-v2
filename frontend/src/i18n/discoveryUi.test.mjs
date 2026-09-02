import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_LANGUAGES } from './languages.js';
import { discoveryUiMessages } from './discoveryUiMessages.js';
import { translate } from './messages.js';

const keys = ['discovery.results','discovery.expandAll','discovery.collapseAll','discovery.expand','discovery.collapse','discovery.useCamera','discovery.services','discovery.methods','discovery.unknownVendor'];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const addCameraSource = readFileSync(resolve(root, 'frontend/src/pages/AddCameraPage.jsx'), 'utf8');

test('collapsible discovery controls are native in all 24 supported languages', () => {
  for (const { code } of SUPPORTED_LANGUAGES) {
    assert.ok(discoveryUiMessages[code], `missing discovery pack ${code}`);
    assert.deepEqual(Object.keys(discoveryUiMessages[code]).sort(), [...keys].sort(), `${code} discovery key set`);
    for (const key of keys) assert.equal(translate(code, key), discoveryUiMessages[code][key], `${code}:${key} not materialized`);
  }
});

test('camera discovery results start compact and expose per-address expandable details', () => {
  assert.match(addCameraSource, /expandedDevices/);
  assert.match(addCameraSource, /aria-expanded=\{expanded\}/);
  assert.match(addCameraSource, /network-device-summary/);
  assert.match(addCameraSource, /network-device-details/);
  assert.match(addCameraSource, /discovery\.expandAll/);
  assert.match(addCameraSource, /discovery\.collapseAll/);
  assert.match(addCameraSource, /discovery\.useCamera/);
});
