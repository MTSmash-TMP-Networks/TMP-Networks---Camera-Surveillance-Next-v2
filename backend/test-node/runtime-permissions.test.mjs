import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const backendRoot = fileURLToPath(new URL('../', import.meta.url));
const entrypoint = resolve(backendRoot, 'docker-entrypoint.sh');

test('backend entrypoint repairs root-created live bind mount and drops privileges', { skip: process.getuid?.() !== 0 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'tmp-camera-permissions-'));
  try {
    const result = spawnSync('sh', [entrypoint, 'sh', '-c', 'printf "%s:%s" "$(id -u)" "$(id -g)" > "$APP_DATA_DIR/runtime-id"; touch "$APP_DATA_DIR/live/write-ok"'], {
      cwd: backendRoot,
      env: { ...process.env, APP_DATA_DIR: root, RECORDINGS_DIR: join(root, 'recordings'), UPDATES_DIR: join(root, 'updates'), PUID: '65534', PGID: '65534' },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(readFileSync(join(root, 'runtime-id'), 'utf8'), '65534:65534');
    assert.equal(statSync(join(root, 'live')).uid, 65534);
    assert.equal(statSync(join(root, 'live', 'write-ok')).uid, 65534);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('compose starts backend through privilege-dropping runtime entrypoint', () => {
  const dockerfile = readFileSync(resolve(backendRoot, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /gosu/);
  assert.match(dockerfile, /docker-entrypoint\.sh/);
  assert.match(dockerfile, /chmod -R a\+rX \/app/);
  assert.doesNotMatch(dockerfile, /^USER camera$/m);
});
