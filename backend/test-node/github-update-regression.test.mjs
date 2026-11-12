import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const service = readFileSync(new URL('../src/services/UpdateService.js', import.meta.url), 'utf8');
const route = readFileSync(new URL('../src/routes/system.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../frontend/src/pages/UpdatePage.jsx', import.meta.url), 'utf8');
test('Only official GitHub repo is used; update remains pinned to commit and inspected via ZIP path', () => {
  assert.match(service, /const GITHUB_REPO = 'MTSmash-TMP-Networks\/TMP-Networks---Camera-Surveillance-Next-v2'/);
  assert.match(service, /latest.commit !== expectedSha/);
  assert.match(service, /Readable.fromWeb\(response.body\)/);
  assert.match(service, /updateService.upload\(/);
  assert.match(service, /inspectUpdatePackage\(zipPath\)/);
  assert.match(service, /GITHUB_MAX_REDIRECTS/);
  assert.doesNotMatch(service, /git pull/);
});
test('GitHub prepare requires explicit admin confirmation and leaves install separate', () => {
  assert.match(route, /systemRouter.get\('\/update\/github\/check'/);
  assert.match(route, /systemRouter.post\('\/update\/github\/prepare'/);
  assert.match(route, /confirmation: z.literal\('HERUNTERLADEN'\)/);
  assert.match(page, /Auf GitHub prüfen/);
  assert.match(page, /Herunterladen & prüfen/);
});
