import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const agent = readFileSync(new URL('../src/services/RemoteProxyService.js', import.meta.url), 'utf8');
const system = readFileSync(new URL('../src/routes/system.js', import.meta.url), 'utf8');

test('camera cloud registration needs no human-entered portal pairing secret', () => {
  assert.match(agent, /AUTO_REGISTRATION_PROTOCOL\s*=\s*2/);
  assert.match(agent, /crypto\.randomUUID\(\)/);
  assert.match(agent, /crypto\.randomBytes\(32\)/);
  assert.match(agent, /encryptSecret/);
  assert.match(agent, /id, key, protocol: AUTO_REGISTRATION_PROTOCOL/);
  assert.doesNotMatch(agent, /await postPortal\('register',[\s\S]*?\{\s*id, code,/);
  assert.match(agent, /enabled:\s*state\.enabled\s*!==\s*false/);
  assert.match(agent, /this\.shuttingDown\s*=\s*true/);
});

test('camera system administration no longer accepts pairingCode', () => {
  assert.match(system, /remoteProxySettingsSchema\s*=\s*z\.object\(\{\s*enabled:\s*z\.boolean\(\)/);
  assert.doesNotMatch(system, /pairingCode:/);
});

test('auto-registration preserves an existing identity and encrypted secret', () => {
  assert.match(agent, /if \(state\.autoRegistrationV2 === true && state\.agentKeyEncrypted\) return state/);
  assert.match(agent, /if \(!state\.agentKeyEncrypted\)/);
  assert.match(agent, /readSetting\(ID_KEY\)/);
  assert.match(agent, /if \(\/[\^].+\.test\(id\)\) return id/);
});
