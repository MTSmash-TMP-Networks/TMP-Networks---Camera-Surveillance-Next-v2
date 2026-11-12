import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { assertLegacyPaths, checkRelease, BASELINE } from '../../scripts/check-update-compatibility.mjs';

test('legacy updater v2.20.32 root layout rejects future top-level additions', () => {
  assert.equal(BASELINE, '2.20.32');
  assert.doesNotThrow(() => assertLegacyPaths(['frontend/desktop-client/main.cjs', 'scripts/docker-compose.intel.yml', 'backend/src/server.js']));
  assert.throws(() => assertLegacyPaths(['desktop-client/main.cjs']), /Legacy-Updater/);
  assert.throws(() => assertLegacyPaths(['data/recordings/clip.ts']), /Laufzeitdaten/);
  assert.throws(() => assertLegacyPaths(['.env']), /Geschuetzter/);
});

test('complete GitHub source passes legacy-compatible version/checksum release guard', () => {
  const root = resolve(import.meta.dirname, '../..');
  const result = checkRelease(root);
  assert.equal(result.baseline, BASELINE);
  assert.match(result.version, /^2\.20\.\d+$/);
  assert.ok(result.files > 400);
});
