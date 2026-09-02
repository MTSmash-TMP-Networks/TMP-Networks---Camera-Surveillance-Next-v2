import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compactComposeError,
  isComposeQuietUnsupported,
  parseComposeVersion,
  quoteComposeEnvValue,
  renderComposeEnv,
} from '../src/composePreflight.js';

test('macOS-Hostpfade werden als literale dotenv-Werte geschrieben', () => {
  const path = "/Users/Marek/Library/Application Support/TMP's Camera/$Archive#1";
  assert.equal(quoteComposeEnvValue(path), "'/Users/Marek/Library/Application Support/TMP\\'s Camera/$Archive#1'");
  const rendered = renderComposeEnv({ PROJECT_HOST_PATH: path, PROJECT_DIR: '/tmp/staging tree' });
  assert.match(rendered, /PROJECT_HOST_PATH='\/Users\/Marek\/Library\/Application Support\/TMP\\'s Camera\/\$Archive#1'/);
  assert.match(rendered, /PROJECT_DIR='\/tmp\/staging tree'/);
});

test('Compose-Versionen werden aus Docker Desktop-Ausgaben erkannt', () => {
  assert.equal(parseComposeVersion('2.23.3'), '2.23.3');
  assert.equal(parseComposeVersion('Docker Compose version v2.40.3-desktop.1'), '2.40.3');
  assert.equal(parseComposeVersion('unbekannt'), null);
});

test('nicht unterstütztes config --quiet wird als kompatibler Fallback erkannt', () => {
  assert.equal(isComposeQuietUnsupported(new Error('unknown flag: --quiet')), true);
  assert.equal(isComposeQuietUnsupported(new Error('services.backend.env_file.0 must be a string')), false);
});

test('Compose-Fehler werden kompakt und ohne Secrets protokolliert', () => {
  const message = compactComposeError(new Error('first line\npassword=supersecret\nservices.backend.env_file must be a string'));
  assert.doesNotMatch(message, /supersecret/);
  assert.match(message, /password=\[REDACTED\]/);
  assert.match(message, /env_file must be a string/);
});
