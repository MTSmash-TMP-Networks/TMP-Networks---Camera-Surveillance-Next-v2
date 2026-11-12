import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('../../', import.meta.url).pathname;
test('GitHub distributable contains both dotfiles and no non-manifested LICENSE', () => {
  const manifest = readFileSync(join(root, 'FILES.sha256'), 'utf8');
  assert.match(manifest, /  \.env\.example/m);
  assert.match(manifest, /  \.gitignore/m);
  assert.ok(existsSync(join(root, '.env.example')));
  assert.ok(existsSync(join(root, '.gitignore')));
  assert.equal(existsSync(join(root, 'LICENSE')), false);
});
