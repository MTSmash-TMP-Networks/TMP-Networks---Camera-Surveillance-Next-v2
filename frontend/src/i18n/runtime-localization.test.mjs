import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_LANGUAGES, normalizeLocale } from './languages.js';
import { messages, translate } from './messages.js';
import { recordingMessages } from './recordingMessages.js';
import { aiMessages } from './aiMessages.js';
import { globalIntlKeys, globalIntlRows } from './globalIntlSupplement.js';
import { runtimeLocaleFixes } from './runtimeLocaleFixes.js';

const codes = SUPPORTED_LANGUAGES.map((item) => item.code);
const placeholders = (value) => [...String(value ?? '').matchAll(/\{([\w.]+)\}/g)].map((match) => match[1]).sort();

const highSignalKeys = [
  'recordings.workflow.archive.description',
  'recordings.timeline.description',
  'recordings.export.description',
  'recordings.guide.typeDescription',
  'recordings.retention.description',
  'recordings.player.networkError',
  'recordings.error.API_NETWORK_ERROR',
  'ai.title',
  'ai.description',
  'ai.privacy.body',
  'ai.test.description',
  'system.diagnostic.CPU_METRICS_UNAVAILABLE',
  'system.diagnostic.STORAGE_PATH_FALLBACK',
  'update.service.warning.degraded',
  'update.service.warning.unreachable',
  'license.docsLink',
];

test('all 24 supported locales resolve the complete message catalog', () => {
  assert.equal(codes.length, 24);
  const englishKeys = Object.keys(messages.en).sort();
  for (const locale of codes) {
    assert.ok(messages[locale], `missing locale ${locale}`);
    assert.deepEqual(Object.keys(messages[locale]).sort(), englishKeys, `${locale} key set differs from English`);
    for (const key of englishKeys) {
      assert.deepEqual(placeholders(messages[locale][key]), placeholders(messages.en[key]), `${locale}:${key} placeholder mismatch`);
      assert.notEqual(translate(locale, key), key, `${locale}:${key} leaked raw key`);
    }
  }
});

test('recordings and AI use complete direct locale packs instead of English inheritance', () => {
  const recordingKeys = Object.keys(recordingMessages.en);
  const aiKeys = Object.keys(aiMessages.en);
  for (const locale of codes) {
    assert.ok(recordingMessages[locale], `missing recording pack ${locale}`);
    assert.ok(aiMessages[locale], `missing AI pack ${locale}`);
    assert.equal(Object.keys(recordingMessages[locale]).length, recordingKeys.length, `${locale} recording key count`);
    assert.equal(Object.keys(aiMessages[locale]).length, aiKeys.length, `${locale} AI key count`);
    for (const key of recordingKeys) assert.ok(Object.prototype.hasOwnProperty.call(recordingMessages[locale], key), `${locale} recording key inherited: ${key}`);
    for (const key of aiKeys) assert.ok(Object.prototype.hasOwnProperty.call(aiMessages[locale], key), `${locale} AI key inherited: ${key}`);
  }
});

test('global runtime supplemental translations are present for every non-DE/EN locale', () => {
  const internationalCodes = codes.filter((locale) => !['de', 'en'].includes(locale));
  assert.equal(Object.keys(globalIntlRows).length, internationalCodes.length);
  for (const locale of internationalCodes) {
    assert.equal(globalIntlRows[locale]?.length, globalIntlKeys.length, `${locale} global runtime row incomplete`);
    for (const key of globalIntlKeys) assert.ok(Object.prototype.hasOwnProperty.call(messages[locale], key), `${locale}:${key} not materialized`);
  }
});

test('high-signal user-facing strings no longer silently fall back to English', () => {
  for (const locale of codes.filter((item) => !['en', 'de'].includes(item))) {
    for (const key of highSignalKeys) {
      assert.notEqual(messages[locale][key], messages.en[key], `${locale}:${key} still equals English fallback`);
    }
  }
});

test('runtime locale fixes cover every supported language and remove known German leftovers', () => {
  for (const locale of codes) {
    assert.ok(runtimeLocaleFixes[locale], `missing runtime fix pack ${locale}`);
    assert.equal(messages[locale]['common.version'], runtimeLocaleFixes[locale]['common.version'], `${locale}: common.version`);
    assert.equal(messages[locale]['language.fallbackNotice'], runtimeLocaleFixes[locale]['language.fallbackNotice'], `${locale}: fallback notice`);
  }
  const germanExpected = {
    'nav.events': 'Ereignisse',
    'nav.systemStatus': 'Systemstatus',
    'nav.updates': 'Update-Center',
    'nav.logout': 'Abmelden',
    'overview.eyebrow': 'ÜBERWACHUNGSZENTRALE',
    'events.eyebrow': 'EREIGNISZENTRALE',
  };
  for (const [key, expected] of Object.entries(germanExpected)) {
    assert.equal(messages.de[key], expected, `de:${key}`);
    assert.notEqual(messages.de[key], messages.en[key], `de:${key} still equals English`);
  }
});

test('runtime locale aliases resolve to their canonical language packs', () => {
  const aliases = {
    'fr-FR': 'fr', 'es-MX': 'es', 'pt': 'pt-BR', 'pt_BR': 'pt-BR', no: 'nb',
    zh: 'zh-CN', 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW', 'zh_TW': 'zh-TW', 'de-AT': 'de', 'en-GB': 'en',
  };
  for (const [input, expected] of Object.entries(aliases)) {
    assert.equal(normalizeLocale(input), expected, input);
    assert.equal(translate(input, 'recordings.title'), messages[expected]['recordings.title'], `translate(${input})`);
    assert.equal(translate(input, 'ai.title'), messages[expected]['ai.title'], `AI translate(${input})`);
  }
});
