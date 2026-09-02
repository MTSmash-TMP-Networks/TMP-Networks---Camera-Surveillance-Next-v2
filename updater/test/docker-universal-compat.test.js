import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (file) => readFileSync(resolve(root, file), 'utf8');

test('Updater vermeidet docker:27-cli und nutzt kompatible Docker-Werkzeuge', () => {
  const dockerfile = source('updater/Dockerfile');
  assert.doesNotMatch(dockerfile, /FROM docker:/);
  assert.match(dockerfile, /FROM node:24\.18\.0-bookworm-slim/);
  assert.match(dockerfile, /docker\.io docker-compose/);
});

test('Start erzwingt keine Registry-Pulls und startet ohne optionalen Updater', () => {
  const start = source('start.sh');
  assert.match(start, /FORCE_IMAGE_PULL=false/);
  assert.match(start, /UPDATER_OPTIONAL=true/);
  assert.match(start, /build backend frontend/);
  assert.match(start, /up -d backend mediamtx frontend/);
  assert.match(start, /prepare-offline-images\.sh/);
  assert.match(start, /docker_image_exists/);
  assert.doesNotMatch(start, /docker-compose\.sh build --pull\s*$/m);
});

test('Updater unterstützt Compose v1 und v2', () => {
  const server = source('updater/src/server.js');
  assert.match(server, /docker-compose/);
  assert.match(server, /flavor: 'v1'/);
  assert.match(server, /flavor: 'v2'/);
  assert.match(server, /status=\$\{args\[index \+ 1\]\}/);
  assert.match(server, /composeBuildArgs/);
});

test('Backend hängt beim Start nicht vom optionalen Updater ab', () => {
  const compose = source('docker-compose.yml');
  const backend = compose.split(/\n  backend:/)[1].split(/\n  mediamtx:/)[0];
  assert.doesNotMatch(backend, /depends_on:[\s\S]*updater/);
});

test('Startskript bewahrt den aktiven Compose-v1-Projektnamen', () => {
  const start = source('start.sh');
  const envExample = source('.env.example');
  assert.match(start, /active_compose_project_name/);
  assert.match(start, /com\.docker\.compose\.project/);
  assert.match(start, /ensure_env_key COMPOSE_PROJECT_NAME/);
  assert.match(envExample, /COMPOSE_PROJECT_NAME=tmp-camera-surveillance-next/);
});
