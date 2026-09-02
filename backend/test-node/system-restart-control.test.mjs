import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { serviceRestartObserved, waitForSystemRestart } from '../../frontend/src/services/systemRestart.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

test('service uptime reset confirms a restart even when the outage is very short', () => {
  assert.equal(serviceRestartObserved({
    baselineUptime: 500,
    currentStatus: { system: { serviceUptimeSeconds: 4 } },
    observedOffline: false,
  }), true);
});

test('an observed outage followed by a healthy status confirms recovery', async () => {
  const responses = [new Error('offline'), { system: { serviceUptimeSeconds: 30 } }];
  const result = await waitForSystemRestart({
    baselineUptime: 200,
    fetchStatus: async () => {
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    initialDelayMs: 0,
    intervalMs: 0,
    wait: async () => {},
  });
  assert.equal(result.observedOffline, true);
});

test('system restart is admin-only, confirmed and delegated to the updater', () => {
  const route = readFileSync(resolve(root, 'backend/src/routes/system.js'), 'utf8');
  const service = readFileSync(resolve(root, 'backend/src/services/SystemControlService.js'), 'utf8');
  const updater = readFileSync(resolve(root, 'updater/src/server.js'), 'utf8');
  assert.match(route, /systemRouter\.use\(authenticate, authorize\('admin'\)\)/);
  assert.match(route, /post\('\/restart'/);
  assert.match(route, /z\.literal\('NEUSTART'\)/);
  assert.match(service, /updaterClient\.post\('\/restart'/);
  assert.match(updater, /performSystemRestart/);
  assert.match(updater, /body\.confirmation !== 'NEUSTART'/);
  assert.doesNotMatch(updater, /compose\(\['down'/);
});
