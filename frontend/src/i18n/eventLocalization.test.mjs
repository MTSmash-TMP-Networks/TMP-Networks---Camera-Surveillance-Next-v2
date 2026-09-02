import test from 'node:test';
import assert from 'node:assert/strict';
import { translate } from './messages.js';
import { eventMetaLabel, eventTypeLabel, localizeEventMessage } from './eventLocalization.js';

const tFor = (locale) => (key, variables) => translate(locale, key, variables);

test('known camera event codes do not leak German into English', () => {
  const item = { type: 'camera.log', source: 'camera-event-log', payload: { level: 'info', component: 'stream', code: 'STREAM_READY', message: 'Live-Stream ist bereit' } };
  assert.equal(localizeEventMessage(item, { locale: 'en', t: tFor('en') }), 'The live stream is ready.');
  assert.equal(eventTypeLabel(item, tFor('en')), 'Camera event');
  assert.equal(eventMetaLabel(item, tFor('en')), 'Info · STREAM_READY');
});

test('unknown German technical events receive a localized generic message outside German', () => {
  const item = { type: 'camera.log', payload: { component: 'recording', level: 'warn', message: 'Die Aufnahme wurde intern neu vorbereitet' } };
  const fr = localizeEventMessage(item, { locale: 'fr', t: tFor('fr') });
  assert.equal(fr, 'Événement Enregistrement reçu.');
  assert.equal(/\b(?:Die|Aufnahme|wurde)\b/.test(fr), false);
});

test('German keeps the original diagnostic message', () => {
  const item = { type: 'camera.log', payload: { component: 'stream', code: 'STREAM_READY', message: 'Live-Stream ist bereit' } };
  assert.equal(localizeEventMessage(item, { locale: 'de', t: tFor('de') }), 'Live-Stream ist bereit');
});
