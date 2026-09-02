import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_LANGUAGES } from './languages.js';
import { demoModeMessages } from './demoModeMessages.js';
import { translate } from './messages.js';

const keys = ['demo.badge', 'demo.bannerTitle', 'demo.bannerDescription', 'demo.loginNotice', 'demo.readOnly', 'demo.actionBlocked'];

test('demo mode strings are direct and complete in all 24 supported languages', () => {
  assert.equal(SUPPORTED_LANGUAGES.length, 24);
  for (const { code } of SUPPORTED_LANGUAGES) {
    assert.ok(demoModeMessages[code], `missing demo pack ${code}`);
    assert.deepEqual(Object.keys(demoModeMessages[code]).sort(), [...keys].sort(), `${code} demo key set`);
    for (const key of keys) {
      assert.ok(String(demoModeMessages[code][key]).trim(), `${code}:${key}`);
      assert.equal(translate(code, key), demoModeMessages[code][key], `${code}:${key} not materialized`);
    }
  }
});
