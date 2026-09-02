import test from 'node:test';
import assert from 'node:assert/strict';
import { onvifPtzProbeMessages } from './onvifPtzProbeMessages.js';

const locales = ['de','en','fr','es','it','nl','pl','pt-BR','tr','cs','da','sv','nb','fi','ro','hu','el','uk','ru','ar','zh-CN','zh-TW','ja','ko'];
const keys = Object.keys(onvifPtzProbeMessages.en).sort();

test('ONVIF/PTZ setup status is complete in all 24 locales', () => {
  assert.deepEqual(Object.keys(onvifPtzProbeMessages).sort(), [...locales].sort());
  for (const locale of locales) {
    assert.deepEqual(Object.keys(onvifPtzProbeMessages[locale]).sort(), keys, `${locale} key parity`);
    for (const key of keys) assert.ok(String(onvifPtzProbeMessages[locale][key] || '').trim(), `${locale}:${key}`);
  }
});
