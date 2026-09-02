import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_LANGUAGES, normalizeLocale, resolveInitialLocale } from './languages.js';
import { interpolate, messages, translate } from './messages.js';
import { translateLegacyPhrase } from './legacyPhrases.js';

test('ships a large and unique locale list', () => {
  assert.equal(SUPPORTED_LANGUAGES.length, 24);
  assert.equal(new Set(SUPPORTED_LANGUAGES.map((item) => item.code)).size, 24);
  assert.equal(SUPPORTED_LANGUAGES.find((item) => item.code === 'ar')?.direction, 'rtl');
});

test('normalizes common browser locale aliases', () => {
  assert.equal(normalizeLocale('de-DE'), 'de');
  assert.equal(normalizeLocale('pt'), 'pt-BR');
  assert.equal(normalizeLocale('zh-Hant'), 'zh-TW');
  assert.equal(normalizeLocale('no-NO'), 'nb');
  assert.equal(normalizeLocale('xx-ZZ'), null);
});

test('stored locale wins and browser locale falls back to English', () => {
  assert.equal(resolveInitialLocale({ storedLocale: 'fr', browserLocales: ['de-DE'] }), 'fr');
  assert.equal(resolveInitialLocale({ storedLocale: null, browserLocales: ['es-MX'] }), 'es');
  assert.equal(resolveInitialLocale({ storedLocale: null, browserLocales: ['xx-ZZ'] }), 'en');
});

test('all language packs contain core navigation, status and legal labels', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    assert.ok(messages[language.code], `missing pack ${language.code}`);
    assert.notEqual(translate(language.code, 'nav.overview'), 'nav.overview');
    assert.notEqual(translate(language.code, 'common.license'), 'common.license');
    assert.notEqual(translate(language.code, 'license.vendorTitle'), 'license.vendorTitle');
    assert.notEqual(translate(language.code, 'license.title'), 'license.title');
    assert.notEqual(translate(language.code, 'license.fullTextLink'), 'license.fullTextLink');
    assert.notEqual(translate(language.code, 'system.title'), 'system.title');
    assert.notEqual(translate(language.code, 'system.containers.title'), 'system.containers.title');
    assert.notEqual(translate(language.code, 'common.unavailable'), 'common.unavailable');
    assert.equal(translate(language.code, 'system.storage.folderOnly', { label: 'Archive' }).includes('{label}'), false);
  }
});

test('interpolation keeps missing variables visible', () => {
  assert.equal(interpolate('Camera {name} / {id}', { name: 'Gate' }), 'Camera Gate / {id}');
});

test('legacy German screens receive an English fallback', () => {
  assert.equal(translateLegacyPhrase('en', 'System neu starten'), 'Restart system');
  assert.equal(translateLegacyPhrase('fr', 'Aufnahme-Archiv'), 'Recording archive');
  assert.equal(translateLegacyPhrase('de', 'Aufnahme-Archiv'), 'Aufnahme-Archiv');
  assert.equal(translateLegacyPhrase('fr', 'Speichern'), 'Enregistrer');
  assert.equal(translateLegacyPhrase('es', 'Wird verbunden …'), 'Conectando …');
  assert.equal(translateLegacyPhrase('ja', 'Keine Berechtigung'), '権限がありません');
});


test('all 24 packs expose the complete active key set', () => {
  const referenceKeys = Object.keys(messages.en).sort();
  assert.ok(referenceKeys.length >= 190);
  for (const language of SUPPORTED_LANGUAGES) {
    const pack = messages[language.code] || {};
    assert.deepEqual(referenceKeys.filter((key) => !(key in pack)), [], `missing active keys in ${language.code}`);
    assert.equal(/community|communaut|comunit|społecz|topluluk|社区|社群|コミュニティ|커뮤니티/i.test(String(pack['license.vendorTitle'] || '')), false, `stale Community license label in ${language.code}`);
  }
});

test('legacy camera, recording and update dialogs never leak German into non-German locales', () => {
  const examples = [
    ['Kamera „Lobby“ wirklich entfernen? Aufnahmen bleiben als Dateien im Datenordner erhalten, werden aber aus der Verwaltung gelöscht.', 'Really remove camera'],
    ['Update 2.18.21 jetzt installieren?\n\nDie Anwendung wird automatisch gesichert, neu gebaut und kurzzeitig neu gestartet.', 'Install update 2.18.21 now?'],
    ['5 Aufnahme(n) wurden bereinigt; 120 MB freigegeben.', '5 recording(s) cleaned up'],
    ['Intelligente Medienquellen-Suche und Alternative Medienquellen', 'Intelligent media source discovery'],
    ['Speichern und prüfen', 'Save and check'],
    ['Quelle manuell hinzufügen', 'Add source manually'],
  ];
  for (const [source, expected] of examples) {
    assert.equal(translateLegacyPhrase('en', source).includes(expected), true);
  }
});


test('visual refinement controls are present in all 24 native packs', () => {
  const keys = ['nav.group.monitoring', 'nav.group.administration', 'nav.collapse', 'live.moreActions', 'live.fullscreen', 'live.noCamera', 'live.ptzControl', 'live.qualityBalanced', 'live.reconnect'];
  for (const language of SUPPORTED_LANGUAGES) {
    for (const key of keys) assert.notEqual(translate(language.code, key), key, `missing ${key} in ${language.code}`);
    if (language.code !== 'en') assert.notEqual(translate(language.code, 'live.noCamera'), translate('en', 'live.noCamera'), `English visual fallback in ${language.code}`);
  }
});

test('update backup, history and security sections are native in all 24 packs', () => {
  const keys = [
    'update.backups.title', 'update.backups.subtitle', 'update.backups.empty', 'update.backups.includesDatabase',
    'update.history.title', 'update.history.subtitle', 'update.history.empty',
    'update.history.status.installed', 'update.history.status.rolled_back', 'update.history.status.failed',
    'update.history.status.manual_rollback', 'update.history.status.rollback_failed',
    'update.security.title', 'update.security.description',
  ];
  for (const language of SUPPORTED_LANGUAGES) {
    for (const key of keys) assert.notEqual(translate(language.code, key), key, `missing ${key} in ${language.code}`);
  }
  assert.equal(translate('en', 'update.backups.title'), 'Backups');
  assert.equal(translate('en', 'update.history.title'), 'History');
  assert.equal(translate('en', 'update.security.title'), 'Security concept');
  assert.equal(translate('fr', 'update.backups.title'), 'Sauvegardes');
  assert.equal(translate('es', 'update.history.empty'), 'Todavía no se han registrado operaciones de actualización.');
  assert.notEqual(translate('ja', 'update.security.title'), translate('en', 'update.security.title'));
});

test('events page is native in all 24 language packs', () => {
  const keys = [
    'events.title', 'events.subtitle', 'events.socket.connected', 'events.socket.connecting', 'events.socket.fallback',
    'events.live.title', 'events.live.subtitle', 'events.live.empty',
    'events.audit.title', 'events.audit.subtitle', 'events.audit.empty',
    'events.outcome.success', 'events.outcome.denied', 'events.outcome.failed',
  ];
  for (const language of SUPPORTED_LANGUAGES) {
    for (const key of keys) assert.notEqual(translate(language.code, key), key, `missing ${key} in ${language.code}`);
    if (!['de', 'en'].includes(language.code)) {
      assert.notEqual(translate(language.code, 'events.live.title'), translate('de', 'events.live.title'), `German events title leaked into ${language.code}`);
      assert.notEqual(translate(language.code, 'events.audit.empty'), translate('en', 'events.audit.empty'), `English events fallback leaked into ${language.code}`);
    }
  }
});
