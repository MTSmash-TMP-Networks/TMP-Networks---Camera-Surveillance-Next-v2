import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestPage } from '../src/services/NetworkCameraDiscovery.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('stalled camera HTTP fingerprint never blocks forever when device sends partial bytes', async () => {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.write('partial camera header');
    // Pretend a broken camera never finishes its response.
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const started = Date.now();
    const result = await requestPage(`http://127.0.0.1:${server.address().port}/`, 300);
    assert.equal(result, null);
    assert.ok(Date.now() - started < 1500, 'absolute deadline must finish the hanging probe');
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('progressive device discovery keeps already qualified results readable while scan is running', () => {
  const service = read('backend/src/services/DiscoveryJobService.js');
  const scanner = read('backend/src/services/NetworkCameraDiscovery.js');
  const frontend = read('frontend/src/pages/AddCameraPage.jsx');
  assert.match(service, /items: job\.items \|\| \[\]/);
  assert.match(service, /onDevice: \(device\) =>/);
  assert.match(service, /cameraRepository\.findDiscoveryDuplicate\(device\)/);
  assert.match(scanner, /onDevice: \(device\) => onDevice\?\.\(applyFinalCameraDiscoveryPolicy\(device\)\)/);
  assert.match(scanner, /fingerprintDeadline = Date\.now\(\) \+ config\.discoveryFingerprintMaxMs/);
  assert.match(frontend, /if \(\(job\.items \|\| \[\]\)\.length\) setDevices/);
});

test('patched broker uses native Go target architecture with classic Docker builder', () => {
  const dockerfile = read('mediamtx/Dockerfile');
  assert.match(dockerfile, /FROM golang:1\.25-alpine AS build/);
  assert.match(dockerfile, /CGO_ENABLED=1 go test -race/);
  assert.match(dockerfile, /CGO_ENABLED=0 go build/);
  assert.doesNotMatch(dockerfile, /\$BUILDPLATFORM|\$TARGETARCH|\$TARGETOS|--mount=type=cache/);
});
