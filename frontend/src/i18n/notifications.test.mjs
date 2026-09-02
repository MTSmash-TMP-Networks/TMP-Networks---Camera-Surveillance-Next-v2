import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_LANGUAGES } from './languages.js';
import { notificationMessages } from './notificationMessages.js';
import { translate } from './messages.js';

const required = [
  'nav.notifications','notifications.title','notifications.description','notifications.smtp.title','notifications.enabled','notifications.host','notifications.security','notifications.password',
  'notifications.recipients','notifications.language','notifications.rules.title','notifications.rule.motion','notifications.rule.cameraStatus','notifications.rule.streamFailures','notifications.rule.recordingFailures','notifications.rule.systemErrors','notifications.rule.updateOperations',
  'notifications.test.title','notifications.test','notifications.save','notifications.history.title','notifications.status.pending','notifications.securityNote.title',
];

test('notification center has native entries for all supported UI languages', () => {
  assert.equal(Object.keys(notificationMessages).length, SUPPORTED_LANGUAGES.length);
  for (const { code } of SUPPORTED_LANGUAGES) {
    assert.ok(notificationMessages[code], `missing notification locale ${code}`);
    for (const key of required) {
      assert.equal(typeof notificationMessages[code][key], 'string', `${code} missing ${key}`);
      assert.notEqual(notificationMessages[code][key], '', `${code} empty ${key}`);
      assert.notEqual(translate(code, key), key, `${code} unresolved ${key}`);
    }
  }
});
