#!/usr/bin/env node
// Read-only audit: complete key set, placeholders and explicit international license UI.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_LANGUAGES, normalizeLocale } from '../frontend/src/i18n/languages.js';
import { messages } from '../frontend/src/i18n/messages.js';
import { licenseUiIntlKeys, internationalLicenseLabels } from '../frontend/src/i18n/licenseUiIntl.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keys = Object.keys(messages.en).sort();
const placeholders = (text) => [...String(text ?? '').matchAll(/\{([\w.]+)\}/g)].map((m) => m[1]).sort();
const rows = [];

for (const { code, direction } of SUPPORTED_LANGUAGES) {
  const values = messages[code] || {};
  const ownKeys = Object.keys(values).sort();
  assert.deepEqual(ownKeys, keys, `${code} has missing or unexpected translation keys`);
  let sameAsEnglish = 0;
  for (const key of keys) {
    assert.equal(typeof values[key], 'string', `${code}:${key} not a string`);
    assert.deepEqual(placeholders(values[key]), placeholders(messages.en[key]), `${code}:${key} placeholder mismatch`);
    if (code !== 'en' && values[key] === messages.en[key]) sameAsEnglish++;
  }
  if (!['en', 'de'].includes(code)) {
    for (const key of licenseUiIntlKeys) {
      assert.equal(values[key], internationalLicenseLabels[code]?.[key], `${code}:${key} English override`);
    }
  }
  rows.push({ locale: code, direction, keys: keys.length, identicalToEnglish: sameAsEnglish });
}
assert.equal(SUPPORTED_LANGUAGES.length, 24);
assert.equal(normalizeLocale('zh-HK'), 'zh-TW');
assert.equal(normalizeLocale('zh-MO'), 'zh-TW');
assert.equal(normalizeLocale('zh-SG'), 'zh-CN');
assert.equal(SUPPORTED_LANGUAGES.find((l) => l.code === 'ar')?.direction, 'rtl');

const expectedVersion = readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
for (const p of ['README.md', 'INSTALLATION.md', 'INSTALLATION_DE.md', 'docs/TRANSLATIONS.md']) {
  const fullPath = path.join(root, p);
  assert.ok(existsSync(fullPath), `Missing documentation file ${p}`);
  const body = readFileSync(fullPath, 'utf8');
  assert.ok(body.includes(expectedVersion), `${p} does not describe version ${expectedVersion}`);
  const base = path.dirname(fullPath);
  const relativeLinks = [...body.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1].split('#')[0].trim())
    .filter((link) => link && !/^(?:https?:|mailto:|\/|#)/i.test(link));
  for (const link of relativeLinks) {
    assert.ok(existsSync(path.join(base, link)), `Broken relative link in ${p}: ${link}`);
  }
}
console.log('Localization audit: '+SUPPORTED_LANGUAGES.length+' locales, '+keys.length+' message keys per locale.');
console.table(rows);
console.log('Identical-to-English counts are informational: shared technical names and historical fallbacks remain possible.');
console.log('Documentation version and relative links: OK ('+expectedVersion+').');
