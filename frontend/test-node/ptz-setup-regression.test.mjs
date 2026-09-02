import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionModeForDiscoveredCamera } from '../src/utils/cameraSetup.js';
import { cameraSupportsPtz } from '../src/utils/cameraCapabilities.js';

test('discovered cameras always retry ONVIF after credentials are entered', () => {
  assert.equal(connectionModeForDiscoveredCamera({ onvifAvailable: false, openPorts: [80, 554, 1935, 8080] }), 'auto');
  assert.equal(connectionModeForDiscoveredCamera({ onvifAvailable: true }), 'auto');
});

test('raw ONVIF PTZ service capability recovers older stored cameras', () => {
  assert.equal(cameraSupportsPtz({ capabilities: { ptz: false, PTZ: { XAddr: 'http://camera/onvif/ptz_service' } } }), true);
  assert.equal(cameraSupportsPtz({ capabilities: { ptz: false, device: { capabilities: { PTZ: { XAddr: 'http://camera/onvif/ptz' } } } } }), true);
  assert.equal(cameraSupportsPtz({ capabilities: { ptz: false } }), false);
});
