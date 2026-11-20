import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
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


test('release contract remains pinned to v2.20.32 and preserves runtime state', () => {
  const root = resolve(import.meta.dirname, '../..');
  const manifest = JSON.parse(readFileSync(resolve(root, 'UPDATE_PACKAGE.json'), 'utf8'));
  for (const key of ['minimumVersion', 'minVersion', 'compatibleFrom', 'fromVersion']) {
    assert.equal(manifest[key], '2.20.32', `${key} must remain compatible with 2.20.32`);
  }
  assert.deepEqual([...manifest.preserve].sort(), ['.env', '.git', 'data']);
  assert.equal(manifest.product, 'tmp-camera-surveillance-next');
  assert.equal(manifest.allowReinstall, true);
});

test('the update contract uses one supported changelog instead of historical note files', () => {
  const root = resolve(import.meta.dirname, '../..');
  const manifest = JSON.parse(readFileSync(resolve(root, 'UPDATE_PACKAGE.json'), 'utf8'));
  assert.equal(manifest.changelogFile, 'CHANGELOG.md');
  assert.equal(manifest.changelog, 'CHANGELOG.md');
  const lines = readFileSync(resolve(root, 'MANIFEST.txt'), 'utf8').trim().split(/\r?\n/);
  assert.ok(lines.includes('CHANGELOG.md'));
  assert.equal(lines.some((item) => /^UPDATE_NOTES_\d+\.\d+\.\d+\.md$/.test(item)), false);
  const content = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
  assert.ok(content.includes(manifest.version), 'changelog must mention the current release');
});
