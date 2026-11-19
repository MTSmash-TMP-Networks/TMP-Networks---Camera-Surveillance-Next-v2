import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { cloudWebAppLink } from '../src/services/cloudWebAppLink.js';

const uuid = '12345678-1234-1234-1234-123456789abc';
test('per-installation iPhone WebApp link preselects the permanent UUID only', () => {
  assert.equal(cloudWebAppLink(uuid), 'https://support.tmp-networks.de/cam/index.php?server=' + uuid);
  assert.equal(cloudWebAppLink(uuid.toUpperCase()), cloudWebAppLink(uuid));
  assert.equal(cloudWebAppLink('  ' + uuid + '  '), cloudWebAppLink(uuid));
  for (const invalid of ['', 'abc', null, {}, uuid + '?token=secret', 'javascript:alert(1)']) assert.equal(cloudWebAppLink(invalid), '');
});
test('system status offers copy/open buttons without generating camera credentials', () => {
  const page = readFileSync(new URL('../src/pages/SystemStatusPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /cloudWebAppLink\(proxyStatus\?\.installationId\)/);
  assert.match(page, /Link kopieren/);
  assert.match(page, /Zum Home-Bildschirm/);
  assert.match(page, /Als Web-App öffnen/);
  assert.match(page, /navigator\.clipboard\?\.writeText/);
  assert.match(page, /document\.execCommand\('copy'\)/);
  assert.doesNotMatch(page, /webAppUrl\s*=.*(?:accessToken|password)/);
});

test('conditional iPhone WebApp block closes before the next sibling JSX node', () => {
  const page = readFileSync(new URL('../src/pages/SystemStatusPage.jsx', import.meta.url), 'utf8');
  const start = page.indexOf('{webAppUrl && <div className="remote-proxy-webapp">');
  const next = page.indexOf('<div className="remote-proxy-id"><strong>Portalstatus</strong>', start);
  assert.ok(start >= 0 && next > start, 'WebApp block and portal status must exist');
  const boundary = page.slice(start, next);
  assert.match(boundary, /<\/div>\s*\}\s*$/, 'conditional JSX block must be closed before the next section');
});
