import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichProfilesWithPtzSupport,
  ensurePtzServiceUri,
  hasCompatiblePtzConfiguration,
  hasPtzConfigurationsResponse,
  hasPtzNodesResponse,
  hasPtzStatusResponse,
  probePtzProfile,
  probePtzService,
  ptzProbeOperations,
} from '../src/services/onvif/ptzDiscovery.js';
import { normalizeOnvifProfile } from '../src/services/onvif/profileDiscovery.js';

test('embedded PTZ configuration token variants are recognized during profile normalization', () => {
  assert.equal(normalizeOnvifProfile({ $: { token: 'main' }, PTZConfigurationToken: 'ptz-1' }).hasPtz, true);
  assert.equal(normalizeOnvifProfile({ $: { token: 'sub' }, configurations: { PTZConfiguration: { $: { token: 'ptz-2' } } } }).hasPtz, true);
});

test('PTZ service URI is recovered from ONVIF capabilities when node-onvif did not expose cam.uri.ptz', () => {
  const cam = { uri: {}, capabilities: { PTZ: { XAddr: 'http://192.0.2.10/onvif/ptz_service' } } };
  assert.equal(ensurePtzServiceUri(cam), 'http://192.0.2.10/onvif/ptz_service');
  assert.equal(cam.uri.ptz.href, 'http://192.0.2.10/onvif/ptz_service');
  assert.equal(cam.uri.ptz.path, '/onvif/ptz_service');
});



test('PTZ service URI accepts node-onvif URL objects and GetServices arrays', () => {
  const fromUri = { uri: { ptz: { href: 'http://192.0.2.20:8080/onvif/ptz_service', path: '/onvif/ptz_service' } } };
  assert.equal(ensurePtzServiceUri(fromUri), 'http://192.0.2.20:8080/onvif/ptz_service');
  assert.equal(fromUri.uri.ptz.path, '/onvif/ptz_service');

  const fromServices = {
    uri: {},
    services: [
      { namespace: 'http://www.onvif.org/ver10/media/wsdl', XAddr: 'http://192.0.2.20/onvif/media_service' },
      { namespace: 'http://www.onvif.org/ver20/ptz/wsdl', XAddr: 'http://192.0.2.20:8080/onvif/ptz_service' },
    ],
  };
  assert.equal(ensurePtzServiceUri(fromServices), 'http://192.0.2.20:8080/onvif/ptz_service');
  assert.equal(fromServices.uri.ptz.path, '/onvif/ptz_service');
});

test('read-only GetStatus response proves PTZ for a profile without moving the camera', async () => {
  const cam = { uri: { ptz: 'http://camera/onvif/ptz' } };
  const calls = [];
  const supported = await probePtzProfile(cam, 'main-profile', {
    request: async (_cam, service, xml) => {
      calls.push({ service, xml });
      return { data: [{ getStatusResponse: [{}] }] };
    },
  });
  assert.equal(supported, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].service, 'ptz');
  assert.match(calls[0].xml, /GetStatus/);
  assert.doesNotMatch(calls[0].xml, /Move|Preset|Home/i);
});

test('GetCompatibleConfigurations is used as fallback when GetStatus is unavailable', async () => {
  const cam = { uri: { ptz: 'http://camera/onvif/ptz' } };
  let count = 0;
  const supported = await probePtzProfile(cam, 'main-profile', {
    request: async (_cam, _service, xml) => {
      count += 1;
      if (xml.includes('GetStatus')) throw new Error('Action not supported');
      return { data: [{ getCompatibleConfigurationsResponse: [{ PTZConfiguration: [{ $: { token: 'ptz-main' } }] }] }] };
    },
  });
  assert.equal(supported, true);
  assert.equal(count, 2);
});

test('profiles are enriched individually and a rejected profile is not falsely marked as PTZ', async () => {
  const cam = { uri: { ptz: 'http://camera/onvif/ptz' } };
  const enriched = await enrichProfilesWithPtzSupport(cam, [
    { token: 'main', hasPtz: false },
    { token: 'fixed', hasPtz: false },
  ], {
    request: async (_cam, _service, xml) => {
      if (xml.includes('<ProfileToken>main</ProfileToken>') && xml.includes('GetStatus')) {
        return { xml: '<GetStatusResponse xmlns="http://www.onvif.org/ver20/ptz/wsdl" />' };
      }
      throw new Error('not compatible');
    },
  });
  assert.deepEqual(enriched.map((profile) => [profile.token, profile.hasPtz]), [
    ['main', true],
    ['fixed', false],
  ]);
});


test('service-level GetNodes recovers PTZ when profiles omit PTZConfiguration', async () => {
  const cam = {
    uri: { ptz: 'http://camera/onvif/ptz' },
    capabilities: { PTZ: { XAddr: 'http://camera/onvif/ptz' } },
    activeSource: { profileToken: 'main' },
  };
  const enriched = await enrichProfilesWithPtzSupport(cam, [
    { token: 'main', hasPtz: false },
    { token: 'sub', hasPtz: false },
  ], {
    request: async (_cam, _service, xml) => {
      if (xml.includes('GetStatus') || xml.includes('GetCompatibleConfigurations')) throw new Error('profile probe unsupported');
      if (xml.includes('GetNodes')) return { xml: '<GetNodesResponse xmlns="http://www.onvif.org/ver20/ptz/wsdl"><PTZNode token="node-1"/></GetNodesResponse>' };
      throw new Error('unexpected');
    },
  });
  assert.deepEqual(enriched.map((profile) => [profile.token, profile.hasPtz]), [
    ['main', true],
    ['sub', false],
  ]);
});

test('advertised PTZ service remains a compatibility fallback when optional read-only probes are rejected', async () => {
  const cam = {
    uri: { ptz: 'http://camera/onvif/ptz' },
    capabilities: { PTZ: { XAddr: 'http://camera/onvif/ptz' } },
    defaultProfile: { $: { token: 'ptz-main' } },
  };
  const enriched = await enrichProfilesWithPtzSupport(cam, [
    { token: 'fixed', hasPtz: false },
    { token: 'ptz-main', hasPtz: false },
  ], { request: async () => { throw new Error('not supported'); } });
  assert.equal(enriched.find((profile) => profile.token === 'ptz-main').hasPtz, true);
});

test('service-level PTZ response parsers require actual PTZ nodes or configurations', async () => {
  assert.equal(hasPtzNodesResponse({ xml: '<GetNodesResponse><PTZNode token="n1"/></GetNodesResponse>' }), true);
  assert.equal(hasPtzNodesResponse({ data: [{ getNodesResponse: [{}] }] }), false);
  assert.equal(hasPtzConfigurationsResponse({ xml: '<GetConfigurationsResponse><PTZConfiguration token="c1"/></GetConfigurationsResponse>' }), true);
  assert.equal(hasPtzConfigurationsResponse({ data: [{ getConfigurationsResponse: [{}] }] }), false);
  const cam = { uri: { ptz: 'http://camera/onvif/ptz' } };
  assert.equal(await probePtzService(cam, { request: async () => ({ data: [{ unrelated: true }] }) }), false);
});

test('an embedded PTZ profile skips extra SOAP probing', async () => {
  const cam = { uri: { ptz: 'http://camera/onvif/ptz' } };
  let calls = 0;
  const enriched = await enrichProfilesWithPtzSupport(cam, [
    { token: 'main', hasPtz: false },
    { token: 'ptz-profile', hasPtz: true },
  ], { request: async () => { calls += 1; throw new Error('should not run'); } });
  assert.equal(calls, 0);
  assert.equal(enriched.some((profile) => profile.hasPtz), true);
});

test('PTZ response parsers reject unrelated successful SOAP payloads', () => {
  assert.equal(hasPtzStatusResponse({ data: [{ getProfilesResponse: [{}] }] }), false);
  assert.equal(hasCompatiblePtzConfiguration({ data: [{ getCompatibleConfigurationsResponse: [{}] }] }), false);
  const operations = ptzProbeOperations('a&b<c>');
  assert.match(operations[0].xml, /a&amp;b&lt;c&gt;/);
});


test('camera setup and profile refresh persist PTZ capability derived from enriched profiles', async () => {
  const { readFile } = await import('node:fs/promises');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const cameraService = await readFile(resolve(root, 'backend/src/services/cameraService.js'), 'utf8');
  const onvifClient = await readFile(resolve(root, 'backend/src/services/onvif/OnvifClient.js'), 'utf8');
  const setupUi = await readFile(resolve(root, 'frontend/src/pages/AddCameraPage.jsx'), 'utf8');
  assert.match(onvifClient, /enrichProfilesWithPtzSupport/);
  assert.match(cameraService, /ptz:\s*profiles\.some\(\(profile\) => profile\.hasPtz\)/);
  assert.match(cameraService, /generic-camera-onvif-recovered/);
  assert.match(cameraService, /recoveredProfiles\.some\(\(profile\) => profile\.hasPtz\)/);
  assert.match(setupUi, /profile\.hasPtz \? ' · PTZ'/);
  assert.match(setupUi, /connectionModeForDiscoveredCamera\(device\)/);
  assert.doesNotMatch(setupUi, /device\.onvifAvailable \? 'auto' : 'generic'/);
});
