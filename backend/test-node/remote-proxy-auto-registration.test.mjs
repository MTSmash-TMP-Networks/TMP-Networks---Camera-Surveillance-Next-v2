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
  assert.match(agent, /if \(state\.autoRegistrationV2 !== true\)/);
  assert.match(agent, /if \(!state\.agentKeyEncrypted\)/);
  assert.match(agent, /readSetting\(ID_KEY\)/);
  assert.match(agent, /if \(\/[\^].+\.test\(id\)\) return id/);
});

const bootstrap = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

test('backend bootstrap correctly assigns cloud agent and PTZ services', () => {
  const expectedBinding = '{ recordingEventDispatcher }, { remoteProxyService }, { ptzService }, { cameraRuntimeCoordinator }';
  const expectedImport = [
    "import('./services/recording/RecordingEventDispatcher.js')",
    "import('./services/RemoteProxyService.js')",
    "import('./services/ptz/PtzService.js')",
    "import('./services/runtime/CameraRuntimeCoordinator.js')",
  ];
  assert.ok(bootstrap.includes(expectedBinding), 'cloud and PTZ binding order must match import order');
  let last = -1;
  for (const statement of expectedImport) {
    const current = bootstrap.indexOf(statement);
    assert.ok(current > last, 'missing or misordered startup import: ' + statement);
    last = current;
  }
});

const backendApp = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const browserApi = readFileSync(new URL('../../frontend/src/services/api.js', import.meta.url), 'utf8');
const browserSystem = readFileSync(new URL('../../frontend/src/pages/SystemStatusPage.jsx', import.meta.url), 'utf8');
const updater = readFileSync(new URL('../../updater/src/server.js', import.meta.url), 'utf8');

test('cloud auto-enrollment migrates older OFF settings exactly once', () => {
  assert.match(agent, /CLOUD_AUTO_ENABLE_MIGRATION = 1/);
  assert.match(agent, /state\.cloudAutoEnableMigration !== CLOUD_AUTO_ENABLE_MIGRATION/);
  assert.match(agent, /state\.enabled = true/);
  assert.match(agent, /if \(changed\) writeSetting\(SETTINGS_KEY/);
  assert.match(agent, /if \(state\.enabled === false\) return/);
});
test('cloud proxy backend route and frontend contract stay compatible', () => {
  assert.match(system, /systemRouter\.get\('\/remote-proxy'/);
  assert.match(backendApp, /app\.use\('\/api\/system', systemRouter\)/);
  assert.match(browserApi, /remoteProxyStatus:\s*\(\) => request\('\/system\/remote-proxy'/);
  assert.match(backendApp, /features: \{ remoteProxy: true/);
  assert.match(updater, /backendPayload\.features\?\.remoteProxy !== true/);
  assert.match(browserSystem, /NICHT VERFÜGBAR/);
  assert.match(browserSystem, /reason\?\.status === 404/);
});
