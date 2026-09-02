import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('standalone edition has no runtime license-server dependency', () => {
  assert.equal(fs.existsSync(path.join(root, 'backend/src/services/license')), false);
  assert.equal(fs.existsSync(path.join(root, 'backend/src/routes/license.js')), false);
  assert.doesNotMatch(source('backend/src/app.js'), /\/api\/license/);
  assert.doesNotMatch(source('backend/src/config.js'), /LICENSE_SERVER|licenseServer/);
  assert.doesNotMatch(source('docker-compose.yml'), /LICENSE_SERVER|VITE_LICENSE_PORTAL/);
  assert.doesNotMatch(source('.env.example'), /LICENSE_SERVER|VITE_LICENSE_PORTAL/);
});

test('license page builds against the exported content API', () => {
  const page = source('frontend/src/pages/LicensePage.jsx');
  const content = source('frontend/src/i18n/licenseContent.js');
  assert.match(page, /import \{ getLicenseSections \}/);
  assert.match(page, /getLicenseSections\(legalLocale\)/);
  assert.match(content, /export function getLicenseSections/);
  assert.doesNotMatch(page, /getLicenseContent|license\/manage|licensePortalUrl/);
});

test('standalone capabilities are never gated by activation state', () => {
  assert.doesNotMatch(source('backend/src/routes/cameras.js'), /requireLicenseCapability/);
  assert.doesNotMatch(source('backend/src/routes/system.js'), /requireLicenseCapability/);
  assert.doesNotMatch(source('backend/src/services/DiscoveryJobService.js'), /licenseService/);
  const update = source('backend/src/services/UpdateService.js');
  assert.doesNotMatch(update, /licenseService/);
  assert.match(update, /installationAttemptAllowed:\s*!publicUpdaterHealth\.restarting/);
});
