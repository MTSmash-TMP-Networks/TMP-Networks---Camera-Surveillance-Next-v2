import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

test('docker cleanup removes disposable cache without dangerous prune modes', async () => {
  const script = await readFile(path.join(root, 'scripts/docker-cache-cleanup.sh'), 'utf8');
  assert.match(script, /image prune --force/);
  assert.match(script, /builder prune --all --force/);
  assert.match(script, /buildx prune --all --force/);
  assert.doesNotMatch(script, /system prune/);
  assert.doesNotMatch(script, /volume prune/);
  assert.doesNotMatch(script, /image prune --all/);
});

test('docker cleanup executes image and builder pruning through the Docker CLI', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tmp-camera-docker-cleanup-'));
  try {
    const bin = path.join(dir, 'bin');
    await mkdir(bin);
    const calls = path.join(dir, 'calls.log');
    const fakeDocker = path.join(bin, 'docker');
    await writeFile(fakeDocker, `#!/bin/sh\nprintf '%s\\n' "$*" >> "$DOCKER_CALL_LOG"\nexit 0\n`);
    await chmod(fakeDocker, 0o755);
    const result = spawnSync('sh', [path.join(root, 'scripts/docker-cache-cleanup.sh'), 'test'], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH || ''}`,
        DOCKER_CALL_LOG: calls,
        TMP_CAMERA_CLEANUP_LOG: path.join(dir, 'cleanup.log'),
        UPDATER_DOCKER_CACHE_CLEANUP: 'true',
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const logged = await readFile(calls, 'utf8');
    assert.match(logged, /image prune --force/);
    assert.match(logged, /builder prune --all --force/);
    assert.match(logged, /buildx prune --all --force/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('updater and host startup both invoke automatic cleanup', async () => {
  const server = await readFile(path.join(root, 'updater/src/server.js'), 'utf8');
  const start = await readFile(path.join(root, 'start.sh'), 'utf8');
  assert.match(server, /runDockerCacheCleanup\('pre-update-build'\)/);
  assert.match(server, /runDockerCacheCleanup\('post-update'\)/);
  assert.match(start, /docker-cache-cleanup\.sh pre-build/);
  assert.match(start, /docker-cache-cleanup\.sh post-start/);
});
