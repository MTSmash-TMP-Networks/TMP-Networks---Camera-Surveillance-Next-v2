import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const read = (relative) => readFileSync(resolve(root, relative), 'utf8');

test('the desktop keeps its sandbox, origin lock and persistent browser profile', () => {
  const electron = read('frontend/desktop-client/main.cjs');
  assert.match(electron, /contextIsolation: true/);
  assert.match(electron, /sandbox: true/);
  assert.match(electron, /nodeIntegration: false/);
  assert.match(electron, /partition: 'persist:tmp-camera-desktop'/);
  assert.match(electron, /candidate\.origin === server/);
  assert.doesNotMatch(electron, /ignoreCertificateErrors|certificate-error|no-sandbox/);
});

test('a Linux desktop starts one fullscreen kiosk, retries failures without clearing server settings', () => {
  const electron = read('frontend/desktop-client/main.cjs');
  const installer = read('frontend/desktop-client/install-linux.sh');
  assert.match(electron, /requestSingleInstanceLock/);
  assert.match(electron, /process\.argv\.includes\('--kiosk'\)/);
  assert.match(electron, /loadURL\(server \+ '\/kiosk'\)/);
  assert.match(electron, /did-fail-load/);
  assert.match(electron, /render-process-gone/);
  assert.match(electron, /Math\.min\(30000/);
  assert.match(installer, /\.config}\/autostart/);
  assert.match(installer, /tmp-camera-kiosk\.desktop/);
  assert.match(installer, /TMP_CAMERA_AUTOSTART:-1/);
  assert.match(installer, /--kiosk/);
});

test('device session is hashed, revocable, opted-in, and safely refreshed', () => {
  const backend = read('backend/src/services/DesktopDeviceSessionService.js');
  const router = read('backend/src/routes/auth.js');
  const api = read('frontend/src/services/api.js');
  const auth = read('frontend/src/features/auth/authSlice.js');
  assert.match(backend, /createHash\('sha256'\)/);
  assert.match(backend, /DESKTOP_IDLE_DAYS = 90/);
  assert.match(backend, /HttpOnly; SameSite=Strict/);
  assert.match(backend, /DESKTOP_ORIGIN_FORBIDDEN/);
  assert.match(router, /rememberDevice: z\.literal\(true\)/);
  assert.match(router, /desktopDeviceSessionService\.revoke/);
  assert.match(router, /setDesktopCookie\(req, res, grant\.token, grant\.maxAgeSeconds\)/);
  assert.match(api, /desktopRenewFlight/);
  assert.match(api, /15_000/);
  assert.match(auth, /restoreDesktopSession\.rejected/);
  assert.doesNotMatch(read('frontend/desktop-client/main.cjs'), /password\s*:/);
});

test('normal web sessions and user revocation remain intact', () => {
  const auth = read('frontend/src/features/auth/authSlice.js');
  const api = read('frontend/src/services/api.js');
  const login = read('frontend/src/pages/LoginPage.jsx');
  const shell = read('frontend/src/components/AppShell.jsx');
  assert.match(auth, /api\.login\(username, password\)/);
  assert.match(auth, /rememberDevice = false/);
  assert.match(api, /hasDesktopGrant/);
  assert.match(login, /setRememberDevice/);
  assert.match(shell, /revokeDesktopSession\(\)/);
  assert.match(shell, /clearLocalDeviceGrant\(\)/);
});
