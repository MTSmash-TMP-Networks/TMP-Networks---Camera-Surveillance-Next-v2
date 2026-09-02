import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_LANGUAGES } from './languages.js';
import { recordingStorageMessages, RECORDING_STORAGE_MESSAGE_KEYS } from './recordingStorageMessages.js';
import { translate } from './messages.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sources = [
  resolve(root, 'frontend/src/components/RecordingStorageSettings.jsx'),
  resolve(root, 'frontend/src/pages/RecordingsPage.jsx'),
];

test('recording storage UI is translated in all supported languages', () => {
  const locales = SUPPORTED_LANGUAGES.map(({ code }) => code);
  assert.deepEqual(Object.keys(recordingStorageMessages).sort(), [...locales].sort());
  for (const locale of locales) {
    assert.deepEqual(Object.keys(recordingStorageMessages[locale]).sort(), [...RECORDING_STORAGE_MESSAGE_KEYS].sort(), `${locale} key parity`);
    let localizedCount = 0;
    for (const key of RECORDING_STORAGE_MESSAGE_KEYS) {
      const value = String(recordingStorageMessages[locale][key] || '').trim();
      assert.ok(value, `${locale}:${key} is empty`);
      assert.equal(translate(locale, key), value, `${locale}:${key} is not materialized`);
      if (locale !== 'en' && value !== recordingStorageMessages.en[key]) localizedCount += 1;
    }
    if (locale !== 'en') {
      // Technical labels such as SMB/CIFS, SFTP/SSH or Port are intentionally
      // identical in many languages. Requiring a strong majority of localized
      // strings still detects accidental English fallbacks without rejecting
      // industry-standard protocol names.
      assert.ok(localizedCount >= 30, `${locale}: too many English fallback strings (${localizedCount}/${RECORDING_STORAGE_MESSAGE_KEYS.length} localized)`);
    }
  }
});

test('recording storage React sources only use materialized storage i18n keys', () => {
  const referenced = new Set();
  for (const file of sources) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/['"`](recordings\.(?:storage\.[A-Za-z0-9_.]+|tabs\.storage))['"`]/g)) referenced.add(match[1]);
  }
  assert.deepEqual([...referenced].sort(), [...RECORDING_STORAGE_MESSAGE_KEYS].sort());
});
