import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoModePolicyAllowsRequest } from '../src/services/DemoModePolicy.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = Object.freeze({ demoMode: true, readOnly: true, allowExports: false });
const appSource = readFileSync(resolve(root, 'backend/src/app.js'), 'utf8');
const authSource = readFileSync(resolve(root, 'backend/src/routes/auth.js'), 'utf8');
const systemSource = readFileSync(resolve(root, 'backend/src/routes/system.js'), 'utf8');
const settingsSource = readFileSync(resolve(root, 'backend/src/services/DemoModeSettingsService.js'), 'utf8');
const demoUserSource = readFileSync(resolve(root, 'backend/src/services/DemoUserService.js'), 'utf8');
const configSource = readFileSync(resolve(root, 'backend/src/config.js'), 'utf8');
const envExample = readFileSync(resolve(root, '.env.example'), 'utf8');
const startSource = readFileSync(resolve(root, 'start.sh'), 'utf8');
const shellSource = readFileSync(resolve(root, 'frontend/src/components/AppShell.jsx'), 'utf8');
const loginSource = readFileSync(resolve(root, 'frontend/src/pages/LoginPage.jsx'), 'utf8');
const statusPageSource = readFileSync(resolve(root, 'frontend/src/pages/SystemStatusPage.jsx'), 'utf8');

function allows(method, path, override = runtime) {
  return demoModePolicyAllowsRequest(method, path, override);
}

test('demo mode policy keeps playback available and permits only the protected admin settings mutation', () => {
  const allowed = [
    ['GET', '/api/cameras'], ['GET', '/api/system/status'], ['GET', '/api/system/demo-mode'],
    ['POST', '/api/auth/login'], ['POST', '/api/auth/ws-token'],
    ['POST', '/api/streams/camera-1/session'], ['POST', '/api/streams/camera-1/heartbeat'], ['POST', '/api/streams/camera-1/client-event'],
    ['POST', '/api/recordings/42/token'], ['POST', '/api/recordings/cameras/camera-1/plans/preview'], ['POST', '/api/recordings/export/preview'],
    ['POST', '/internal/go2rtc-auth'], ['PUT', '/api/system/demo-mode'],
  ];
  for (const [method, path] of allowed) assert.equal(allows(method, path), true, `${method} ${path}`);
});

test('demo mode still blocks configuration, destructive, PTZ, notification and updater actions', () => {
  const blocked = [
    ['POST', '/api/auth/change-password'], ['POST', '/api/auth/users'], ['PATCH', '/api/auth/users/user-1'],
    ['POST', '/api/cameras/discover'], ['POST', '/api/cameras'], ['PATCH', '/api/cameras/camera-1'], ['DELETE', '/api/cameras/camera-1'],
    ['POST', '/api/ptz/camera-1/move'], ['POST', '/api/streams/camera-1/restart'], ['POST', '/api/recordings'], ['DELETE', '/api/recordings/42'],
    ['PUT', '/api/recordings/cameras/camera-1/planning'], ['POST', '/api/recordings/cleanup'], ['POST', '/api/recordings/export'],
    ['PUT', '/api/system/notifications/email'], ['POST', '/api/system/notifications/email/test'], ['PUT', '/api/system/notifications/ai'], ['POST', '/api/system/notifications/ai/test'],
    ['POST', '/api/system/restart'], ['POST', '/api/system/update/upload'], ['POST', '/api/system/update/install'], ['POST', '/api/system/update/rollback'], ['DELETE', '/api/system/update/packages/123'],
  ];
  for (const [method, path] of blocked) assert.equal(allows(method, path), false, `${method} ${path}`);
  assert.equal(allows('POST', '/api/recordings/export', { ...runtime, allowExports: true }), true);
});

test('demo mode is database-managed and no longer configured through .env', () => {
  assert.match(settingsSource, /public_demo_mode_v2/);
  assert.match(settingsSource, /system_settings/);
  assert.match(settingsSource, /initializeFromLegacyEnv/);
  assert.match(systemSource, /get\('\/demo-mode'/);
  assert.match(systemSource, /put\('\/demo-mode'/);
  assert.match(systemSource, /authorize\('admin'\)/);
  assert.match(settingsSource, /demoUserService\.enable\(\)/);
  assert.match(settingsSource, /demoUserService\.disable\(\)/);
  assert.match(demoUserSource, /DEMO_USERNAME = 'demo'/);
  assert.match(demoUserSource, /DEMO_PASSWORD = 'demo'/);
  assert.match(demoUserSource, /DEMO_ROLE = 'viewer'/);
  assert.doesNotMatch(configSource, /demoMode:\s*boolean\('DEMO_MODE'/);
  assert.doesNotMatch(envExample, /^DEMO_MODE=/m);
  assert.doesNotMatch(envExample, /^DEMO_MODE_ALLOW_EXPORTS=/m);
  assert.doesNotMatch(startSource, /ensure_env_key DEMO_MODE/);
});

test('demo guard remains before audit logging while admin UI can refresh runtime immediately', () => {
  assert.ok(appSource.indexOf('app.use(demoModeGuard)') < appSource.indexOf('app.use(auditTrail)'), 'demo guard must run before audit trail');
  assert.match(authSource, /demoModeStatus/);
  assert.match(statusPageSource, /saveDemoModeSettings/);
  assert.match(statusPageSource, /loadRuntime/);
  assert.match(statusPageSource, /demo\.adminEnabled/);
});

test('frontend advertises demo mode on login and inside the authenticated shell', () => {
  assert.match(loginSource, /demo-login-notice/);
  assert.match(loginSource, /demo\.loginNotice/);
  assert.match(loginSource, /username: 'demo', password: 'demo'/);
  assert.match(loginSource, /demo-login-credentials/);
  assert.match(shellSource, /demo-mode-banner/);
  assert.match(shellSource, /demo\.bannerTitle/);
});
