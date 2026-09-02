import assert from 'node:assert/strict';
import test from 'node:test';
import { enhancedMessages } from '../src/i18n/enhancedMessages.js';

test('all language packs expose the stream service as TMP-Encoder', () => {
  const entries = Object.entries(enhancedMessages);
  assert.equal(entries.length, 24);
  for (const [locale, messages] of entries) {
    assert.equal(messages['system.containers.service.mediamtx'], 'TMP-Encoder', locale);
  }
});
