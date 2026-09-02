import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cameraSetupAvailability,
  isDiscoveryRunning,
  mergeDiscoveredDevices,
} from '../../frontend/src/services/cameraDiscoveryState.js';

test('startup discovery never blocks manual setup or manual search', () => {
  const startupJob = { id: 'startup', status: 'running', origin: 'startup' };
  assert.equal(isDiscoveryRunning(startupJob), true);
  assert.deepEqual(cameraSetupAvailability({ actionBusy: false, scanStartBusy: false, manualScanJob: null }), {
    setupBusy: false,
    manualSearchBusy: false,
  });
});

test('only an active manual search locks another manual search', () => {
  assert.equal(cameraSetupAvailability({ manualScanJob: { status: 'running' } }).manualSearchBusy, true);
  assert.equal(cameraSetupAvailability({ manualScanJob: { status: 'completed' } }).manualSearchBusy, false);
  assert.equal(cameraSetupAvailability({ scanStartBusy: true }).manualSearchBusy, true);
});

test('camera setup remains independent from discovery work', () => {
  assert.equal(cameraSetupAvailability({ actionBusy: true, manualScanJob: null }).setupBusy, true);
  assert.equal(cameraSetupAvailability({ actionBusy: false, manualScanJob: { status: 'running' } }).setupBusy, false);
});

test('startup and manual results merge without duplicate cameras', () => {
  const merged = mergeDiscoveredDevices(
    [{ ip: '192.168.1.10', port: 80, confidence: 40, discoveryMethods: ['ssdp'], openPorts: [80] }],
    [{ deviceUid: 'urn:uuid:camera-10', ip: '192.168.1.10', port: 8080, confidence: 100, discoveryMethods: ['onvif'], openPorts: [554] }, { ip: '192.168.1.11', port: 80 }],
  );
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].discoveryMethods.sort(), ['onvif', 'ssdp']);
  assert.deepEqual(merged[0].openPorts, [80, 554]);
});
