import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const read = (relative) => readFileSync(resolve(root, relative), 'utf8');
test('Linux desktop client is available in the frontend download directory', () => {
  const page = read('frontend/src/pages/DesktopClientPage.jsx');
  assert.match(page, /\/downloads\/TMP-Camera-Desktop-Linux-x64\.zip/);
  const zip = statSync(resolve(root, 'frontend/public/downloads/TMP-Camera-Desktop-Linux-x64.zip'));
  assert.ok(zip.size > 2000);
  assert.match(read('frontend/src/App.jsx'), /path="\/desktop-client"/);
  assert.match(read('frontend/src/config/navigation.js'), /nav\.desktopClient/);
});
test('Electron client is sandboxed and restricted to configured server origin', () => {
  const main = read('desktop-client/main.cjs');
  assert.match(main, /sandbox: true/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /candidate\.origin === server/);
  assert.match(main, /setWindowOpenHandler/);
  assert.doesNotMatch(main, /ignoreCertificateErrors|certificate-error/);
  assert.match(read('desktop-client/install-linux.sh'), /npm install --omit=dev/);
});

test('Linux installer bootstraps Node/npm locally, checks SHA-256, and diagnoses Electron libraries', () => {
  const script = read('desktop-client/install-linux.sh');
  assert.match(script, /latest-v24\.x/);
  assert.match(script, /sha256sum -c/);
  assert.match(script, /install_local_node/);
  assert.match(script, /check_electron_dependencies/);
  assert.match(script, /sudo apt-get install/);
  assert.match(script, /id -u/);
  const page = read('frontend/src/pages/DesktopClientPage.jsx');
  assert.match(page, /automatisch im Benutzerverzeichnis/);
});
