import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_LANGUAGES } from './languages.js';
import { addCameraMessages, ADD_CAMERA_MESSAGE_KEYS } from './addCameraMessages.js';
import { translate } from './messages.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const page = readFileSync(resolve(root, 'frontend/src/pages/AddCameraPage.jsx'), 'utf8');

test('Add Camera translations are complete in every supported language', () => {
  const locales = SUPPORTED_LANGUAGES.map(({ code }) => code);
  assert.deepEqual(Object.keys(addCameraMessages).sort(), [...locales].sort());
  for (const locale of locales) {
    assert.deepEqual(Object.keys(addCameraMessages[locale]).sort(), [...ADD_CAMERA_MESSAGE_KEYS].sort(), `${locale} key parity`);
    for (const key of ADD_CAMERA_MESSAGE_KEYS) {
      const value = String(addCameraMessages[locale][key] || '').trim();
      assert.ok(value, `${locale}:${key} is empty`);
      assert.equal(translate(locale, key), addCameraMessages[locale][key], `${locale}:${key} is not materialized`);
    }
  }
});

test('Add Camera UI does not render German backend diagnostics as interface copy', () => {
  assert.doesNotMatch(page, /device\.discoveryEvidence\s*&&/);
  assert.doesNotMatch(page, /inspection\?\.warnings[^\n]*join/);
  assert.doesNotMatch(page, />\s*Codec\s*</);
  assert.doesNotMatch(page, />\s*Stream\s*</);
  assert.match(page, /useState\('CAM-1'\)/);
});
