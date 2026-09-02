import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SUPPORTED_LANGUAGES } from './languages.js';
import { kioskMessages } from './kioskMessages.js';
import { updateCenterMessages } from './updateCenterMessages.js';
import { translate } from './messages.js';

const locales = SUPPORTED_LANGUAGES.map((item) => item.code);
const placeholders = (value) => [...String(value).matchAll(/\{([\w.]+)\}/g)].map((match) => match[1]).sort();

function verifyPack(name, pack) {
  assert.deepEqual(Object.keys(pack).sort(), [...locales].sort(), `${name}: locale parity`);
  const englishKeys = Object.keys(pack.en).sort();
  for (const locale of locales) {
    assert.deepEqual(Object.keys(pack[locale]).sort(), englishKeys, `${name}:${locale}: key parity`);
    for (const key of englishKeys) {
      assert.ok(String(pack[locale][key] || '').trim(), `${name}:${locale}:${key} empty`);
      assert.deepEqual(placeholders(pack[locale][key]), placeholders(pack.en[key]), `${name}:${locale}:${key} placeholder mismatch`);
      assert.notEqual(translate(locale, key), key, `${name}:${locale}:${key} leaked key`);
    }
  }
}

test('kiosk has complete native packs for every supported language', () => verifyPack('kiosk', kioskMessages));
test('update center supplement has complete native packs for every supported language', () => verifyPack('update-center', updateCenterMessages));

test('kiosk and update pages no longer contain German UI literals', async () => {
  const [kiosk, update] = await Promise.all([
    readFile(new URL('../pages/KioskPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../pages/UpdatePage.jsx', import.meta.url), 'utf8'),
  ]);
  for (const [name, source] of [['kiosk', kiosk], ['update', update]]) {
    for (const phrase of ['Keine Kamera', 'Schließen', 'Raster verwalten', 'Update-Center wird geladen', 'Installierte Version', 'Änderungen anzeigen', 'Paket löschen', 'Vollbild verlassen']) {
      assert.equal(source.includes(phrase), false, `${name} still contains German UI literal: ${phrase}`);
    }
  }
});
