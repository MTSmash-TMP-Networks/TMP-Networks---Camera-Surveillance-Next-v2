import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_LANGUAGES } from './languages.js';
import { demoAdminMessages } from './demoAdminMessages.js';
import { translate } from './messages.js';

const keys = ['demo.adminTitle','demo.adminDescription','demo.adminEnabled','demo.adminExports','demo.adminSave','demo.adminSaved','demo.adminWarning'];

test('admin demo controls are direct and complete in all 24 supported languages', () => {
  assert.equal(SUPPORTED_LANGUAGES.length, 24);
  for (const { code } of SUPPORTED_LANGUAGES) {
    assert.ok(demoAdminMessages[code], `missing demo admin pack ${code}`);
    assert.deepEqual(Object.keys(demoAdminMessages[code]).sort(), [...keys].sort(), `${code} demo admin key set`);
    for (const key of keys) {
      assert.ok(String(demoAdminMessages[code][key]).trim(), `${code}:${key}`);
      assert.equal(translate(code, key), demoAdminMessages[code][key], `${code}:${key} not materialized`);
    }
  }
});
