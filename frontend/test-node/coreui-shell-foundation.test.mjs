import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const main = readFileSync(resolve(root, 'src/main.jsx'), 'utf8');
const shell = readFileSync(resolve(root, 'src/components/AppShell.jsx'), 'utf8');
const navigation = readFileSync(resolve(root, 'src/config/navigation.js'), 'utf8');
const css = readFileSync(resolve(root, 'src/styles/app.css'), 'utf8');

const expectedRoutes = [
  '/', '/live', '/kiosk', '/recordings', '/cameras/add', '/users', '/events',
  '/system/status', '/system/notifications', '/system/update',
];

test('CoreUI is pinned as an MIT shell dependency with its Popper peer', () => {
  assert.equal(packageJson.dependencies['@coreui/coreui'], '5.9.0');
  assert.equal(packageJson.dependencies['@popperjs/core'], '2.11.8');
  assert.equal(packageLock.packages['node_modules/@coreui/coreui'].version, '5.9.0');
  assert.equal(packageLock.packages['node_modules/@coreui/coreui'].license, 'MIT');
  assert.equal(packageLock.packages['node_modules/@popperjs/core'].version, '2.11.8');
});

test('CoreUI CSS is a base layer and TMP product CSS remains the final override', () => {
  const coreui = main.indexOf("@coreui/coreui/dist/css/coreui.min.css");
  const product = main.indexOf("./styles/app.css");
  assert.ok(coreui >= 0, 'CoreUI stylesheet import is missing');
  assert.ok(product > coreui, 'TMP stylesheet must be imported after CoreUI');
  assert.match(css, /v2\.20\.24 - CoreUI application-shell foundation/);
});

test('application shell uses CoreUI-compatible structural classes without replacing surveillance pages', () => {
  assert.match(shell, /sidebar sidebar-dark tmp-sidebar/);
  assert.match(shell, /sidebar-nav/);
  assert.match(shell, /nav-link/);
  assert.match(shell, /header tmp-app-header/);
  assert.match(shell, /wrapper d-flex flex-column/);
  assert.match(shell, /<Outlet \/>/);
});

test('role-aware navigation is centralized and keeps every established route', () => {
  assert.match(navigation, /adminOnly: true/);
  for (const route of expectedRoutes) assert.ok(navigation.includes(`to: '${route}'`), `missing ${route}`);
});
