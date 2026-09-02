import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveUpdaterEndpoints } from '../src/services/updater/UpdaterEndpointResolver.js';

const settings = {
  updaterUrls: '',
  updaterUrl: '',
  updaterSocketPath: '/data/updates/tmp-camera-updater.sock',
  updaterServiceProtocol: 'http',
  updaterServiceName: 'updater',
  updaterServicePort: 3010,
  updaterServiceBasePath: '',
  updaterFallbackUrls: 'http://tmp-camera-updater:3010,http://updater:3010',
  updaterFallbackUrl: '',
};

test('local updater IPC is resolved before Docker service discovery fallbacks', () => {
  const { endpoints, issues } = resolveUpdaterEndpoints(settings);
  assert.deepEqual(issues, []);
  assert.equal(endpoints[0]?.source, 'local-ipc');
  assert.equal(endpoints[0]?.transport, 'unix');
  assert.equal(endpoints[0]?.socketPath, '/data/updates/tmp-camera-updater.sock');
  assert.equal(endpoints[0]?.safeTarget, 'unix://local-updater');
  assert.equal(endpoints[1]?.source, 'service-discovery');
  assert.ok(endpoints.slice(2).some((endpoint) => endpoint.source === 'fallback'));
});
