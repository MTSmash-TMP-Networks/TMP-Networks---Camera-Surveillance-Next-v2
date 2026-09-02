import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  calculateFilesystemUsagePercent,
  filesystemCapacityMatches,
} from '../src/services/systemMetricsParsers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const projectRoot = path.resolve(backendRoot, '..');

test('filesystem usage follows df semantics for the reported host sample', () => {
  const used = 5_907_312 * 1024;
  const available = 8_786_668 * 1024;
  const total = 15_503_296 * 1024;
  assert.equal(calculateFilesystemUsagePercent(used, available, total), 40.2);
});

test('host filesystem identity uses stable total capacity, not stale used/free values', () => {
  const total = 15_503_296 * 1024;
  assert.equal(filesystemCapacityMatches(total, total), true);
  assert.equal(filesystemCapacityMatches(total, 100 * 1024 ** 3), false);
});

test('SystemMetricsService prefers live statfs and never returns the startup snapshot directly', async () => {
  const source = await readFile(path.join(backendRoot, 'src/services/SystemMetricsService.js'), 'utf8');
  assert.match(source, /stat\.source = 'host-statfs'/);
  assert.doesNotMatch(source, /configuredHostDisk\.recordingsUsedBytes/);
  assert.doesNotMatch(source, /return \{ values: \[configuredHostDisk\]/);
});

test('start refreshes the fallback disk snapshot after Docker pre-build cleanup', async () => {
  const source = await readFile(path.join(projectRoot, 'start.sh'), 'utf8');
  const cleanup = source.indexOf('docker-cache-cleanup.sh pre-build');
  const refresh = source.indexOf('refresh_host_disk_snapshot', cleanup);
  assert.ok(cleanup >= 0);
  assert.ok(refresh > cleanup);
});

test('frontend labels live host statfs measurements as host filesystem', async () => {
  const source = await readFile(path.join(projectRoot, 'frontend/src/pages/SystemStatusPage.jsx'), 'utf8');
  assert.match(source, /startsWith\('host-'\)/);
});
