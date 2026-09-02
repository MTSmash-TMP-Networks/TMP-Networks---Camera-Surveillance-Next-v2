import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_LANGUAGES } from './languages.js';
import { networkStreamMessages } from './networkStreamMessages.js';
import { translate } from './messages.js';

const codes = SUPPORTED_LANGUAGES.map((item) => item.code);
const englishKeys = Object.keys(networkStreamMessages.en).sort();
const placeholders = (value) => [...String(value ?? '').matchAll(/\{([\w.]+)\}/g)].map((match) => match[1]).sort();

test('direct network stream UI ships native complete packs for all 24 locales', () => {
  assert.equal(codes.length, 24);
  assert.ok(englishKeys.length >= 15);
  for (const locale of codes) {
    const pack = networkStreamMessages[locale];
    assert.ok(pack, `missing stream pack ${locale}`);
    assert.deepEqual(Object.keys(pack).sort(), englishKeys, `${locale} stream key set differs from English`);
    for (const key of englishKeys) {
      assert.equal(typeof pack[key], 'string', `${locale}:${key} is not text`);
      assert.ok(pack[key].trim(), `${locale}:${key} is empty`);
      assert.deepEqual(placeholders(pack[key]), placeholders(networkStreamMessages.en[key]), `${locale}:${key} placeholder mismatch`);
      assert.equal(translate(locale, key), pack[key], `${locale}:${key} did not resolve directly`);
    }
  }
});
