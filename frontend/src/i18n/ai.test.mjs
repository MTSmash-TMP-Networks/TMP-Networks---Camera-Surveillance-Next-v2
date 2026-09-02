import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SUPPORTED_LANGUAGES } from './languages.js';
import { aiMessages } from './aiMessages.js';
import { translate } from './messages.js';

const sourceFiles = [
  new URL('../pages/NotificationsPage.jsx', import.meta.url),
  new URL('../pages/EventsPage.jsx', import.meta.url),
  new URL('../pages/RecordingsPage.jsx', import.meta.url),
  new URL('./eventLocalization.js', import.meta.url),
];

const referencedKeys = [...new Set(sourceFiles.flatMap((url) => {
  const source = fs.readFileSync(url, 'utf8');
  return [...source.matchAll(/["'](ai\.[A-Za-z0-9_.-]+)["']/g)].map((match) => match[1]);
}))].sort();

test('AI event analysis UI defines native German and English strings for every referenced key', () => {
  assert.ok(referencedKeys.length > 30, 'expected a substantial AI translation surface');
  for (const locale of ['de', 'en']) {
    assert.ok(aiMessages[locale], `missing AI locale ${locale}`);
    for (const key of referencedKeys) {
      assert.equal(typeof aiMessages[locale][key], 'string', `${locale} missing ${key}`);
      assert.notEqual(aiMessages[locale][key], '', `${locale} empty ${key}`);
    }
  }
});

test('AI event analysis UI resolves every referenced key in all supported languages', () => {
  for (const { code } of SUPPORTED_LANGUAGES) {
    for (const key of referencedKeys) {
      const value = translate(code, key);
      assert.equal(typeof value, 'string', `${code} invalid ${key}`);
      assert.notEqual(value, key, `${code} unresolved ${key}`);
      assert.notEqual(value, '', `${code} empty ${key}`);
    }
  }
});

test('AI event analysis ships a complete native pack for all 24 supported languages', () => {
  const english = aiMessages.en;
  const nativeKeys = [
    'ai.title','ai.description','ai.enabled','ai.configured','ai.notConfigured','ai.provider.compatible',
    'ai.apiKeyStored','ai.apiKeyPlaceholder','ai.reasoning','ai.imageDetail','ai.frames','ai.frameInterval',
    'ai.language','ai.languageAuto','ai.cooldown','ai.timeout','ai.sources.title','ai.sources.motion','ai.sources.manual',
    'ai.sources.continuous','ai.includeInEmail','ai.onlyRelevant','ai.onlyRelevantHelp','ai.privacy.title','ai.privacy.body',
    'ai.test.title','ai.test.description','ai.test.selectCamera','ai.test.run','ai.test.running','ai.test.success','ai.test.failed',
    'ai.test.noCamera','ai.runtime.active','ai.runtime.pending','ai.runtime.success','ai.runtime.failed','ai.recommended',
    'ai.notRecommended','ai.saved',
  ];
  assert.equal(Object.keys(aiMessages).length, SUPPORTED_LANGUAGES.length);
  for (const { code } of SUPPORTED_LANGUAGES) {
    const pack = aiMessages[code];
    assert.ok(pack, `missing direct AI pack ${code}`);
    assert.deepEqual(Object.keys(english).filter((key) => !Object.prototype.hasOwnProperty.call(pack, key)), [], `AI pack ${code} uses inherited/fallback keys`);
    if (code === 'en') continue;
    for (const key of nativeKeys) assert.notEqual(pack[key], english[key], `English AI fallback leaked into ${code}: ${key}`);
  }
});
