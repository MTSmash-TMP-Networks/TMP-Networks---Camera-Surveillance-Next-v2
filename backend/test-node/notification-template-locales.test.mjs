import test from 'node:test';
import assert from 'node:assert/strict';
import { aiMailText, notificationMailTranslations, renderNotificationMail } from '../src/services/notifications/NotificationTemplates.js';

const EMAIL_LANGUAGES = [
  'de','en','fr','es','it','nl','pl','pt-BR','tr','cs','da','sv','nb','fi','ro','hu','el','uk','ru','ar','zh-CN','zh-TW','ja','ko',
];

test('notification email templates cover every supported notification language', () => {
  assert.deepEqual(Object.keys(notificationMailTranslations).sort(), [...EMAIL_LANGUAGES].sort());
  for (const locale of EMAIL_LANGUAGES) {
    const row = notificationMailTranslations[locale];
    for (const key of ['test','testBody','motion','cameraOffline','cameraOnline','streamFailure','streamRecovered','recordingFailure','recordingRecovered','systemError','update','camera','location','time','event','severity','details','footer']) {
      assert.ok(row[key], `${locale} missing ${key}`);
    }
    const ai = aiMailText(locale);
    for (const key of ['analysis','priority','activity','objects','confidence']) assert.ok(ai[key], `${locale} missing AI mail label ${key}`);
    const mail = renderNotificationMail({ language: locale, kind: 'motion', camera: { name: 'Cam 1', location: 'Gate' }, code: 'MOTION_DETECTED', level: 'info', analysis: { title: 'Person at gate', description: 'A person enters the gate area.', priority: 'normal', activity: 'entering', objects: ['person'], confidence: 0.91 } });
    assert.match(mail.subject, /^\[TMP Camera\]/);
    assert.ok(mail.subject.includes('Person at gate'), `${locale} AI title missing from motion subject`);
    assert.ok(mail.text.includes('MOTION_DETECTED'));
    assert.ok(mail.text.includes('Person at gate'));
    assert.ok(mail.html.includes('Cam 1'));
    assert.ok(mail.html.includes('Person at gate'));
  }
});
