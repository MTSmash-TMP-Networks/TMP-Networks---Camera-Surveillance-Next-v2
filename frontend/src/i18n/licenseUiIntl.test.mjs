import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_LANGUAGES, normalizeLocale } from './languages.js';
import { messages, translate } from './messages.js';
import { getLicenseSections } from './licenseContent.js';
import { internationalLicenseLabels, licenseUiIntlKeys, licenseUiIntlRows } from './licenseUiIntl.js';

const all = SUPPORTED_LANGUAGES.map(({ code }) => code);
const international = all.filter((code) => !['en', 'de'].includes(code));

test('all 24 language packs expose native license UI copy and correct placeholders', () => {
  assert.equal(all.length, 24);
  assert.equal(international.length, 22);
  assert.deepEqual(Object.keys(licenseUiIntlRows).sort(), international.sort());
  for (const code of international) {
    const row = licenseUiIntlRows[code];
    assert.equal(row.length, licenseUiIntlKeys.length, `${code}: incomplete license row`);
    const entries = internationalLicenseLabels[code];
    for (const key of licenseUiIntlKeys) {
      assert.equal(typeof entries[key], 'string', `${code}:${key} missing`);
      assert.equal(messages[code][key], entries[key], `${code}:${key} overwritten`);
      assert.ok(entries[key].trim().length >= 2, `${code}:${key} blank`);
      assert.ok(!/\{[a-z][a-z0-9_]*\}/i.test(entries[key]), `${code}:${key} unexpected placeholder`);
    }
    for (const key of ['license.eyebrow', 'license.title', 'license.subtitle', 'license.vendorText', 'license.bindingLanguage', 'license.fullTextLink', 'license.englishSectionsNotice']) {
      assert.notEqual(translate(code, key), translate('en', key), `${code}:${key} English fallback`);
    }
  }
});

test('all locales expose a complete key catalog after international license overrides', () => {
  const englishKeys = Object.keys(messages.en).sort();
  for (const code of all) {
    assert.deepEqual(Object.keys(messages[code]).sort(), englishKeys, `${code} missing message keys`);
    assert.notEqual(translate(code, 'license.title'), 'license.title');
    assert.notEqual(translate(code, 'license.englishSectionsNotice'), 'license.englishSectionsNotice');
  }
});

test('legal section content fallback is declared honestly for non-DE/EN locales', () => {
  for (const code of international) {
    assert.deepEqual(getLicenseSections(code), getLicenseSections('en'), `${code}: English legal detail fallback changed`);
    assert.ok(translate(code, 'license.englishSectionsNotice').length > 24, `${code}: fallback disclosure absent`);
  }
  assert.notDeepEqual(getLicenseSections('de'), getLicenseSections('en'));
});

test('regional Chinese variants choose the expected writing system', () => {
  assert.equal(normalizeLocale('zh-HK'), 'zh-TW');
  assert.equal(normalizeLocale('zh-MO'), 'zh-TW');
  assert.equal(normalizeLocale('zh-SG'), 'zh-CN');
  assert.equal(normalizeLocale('zh-Hant-HK'), 'zh-TW');
  assert.equal(normalizeLocale('ar-EG'), 'ar');
  assert.equal(SUPPORTED_LANGUAGES.find(({ code }) => code === 'ar').direction, 'rtl');
});
