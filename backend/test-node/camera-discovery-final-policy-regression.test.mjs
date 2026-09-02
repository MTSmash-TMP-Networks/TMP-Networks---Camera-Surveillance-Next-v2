import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFinalCameraDiscoveryPolicy } from '../src/services/media/CameraDiscoveryPolicy.js';
import { classifyDiscoveredDevice } from '../src/services/media/OnvifDiscoveryClassifier.js';
import { classifyHostFingerprint } from '../src/services/media/CameraHostClassifier.js';

test('plain 80/443 web appliance stays out even when generic ONVIF discovery mentions camera', () => {
  const ws = classifyDiscoveredDevice({
    hostname: '192.0.2.10',
    port: 80,
    name: 'Camera Management',
    scopes: ['onvif://www.onvif.org/name/Camera'],
    uri: { device: 'http://192.0.2.10/onvif/device_service' },
  });
  assert.equal(ws.likelyCamera, false);
  const final = applyFinalCameraDiscoveryPolicy({
    ...ws.device,
    openPorts: [80, 443],
    discoveryMethods: ['onvif', 'ip-range'],
    cameraCandidate: Boolean(ws.device?.verified),
    confidence: ws.device?.verified ? 100 : 25,
  });
  assert.equal(final.likelyCamera, false);
  assert.equal(final.verified, false);
  assert.equal(final.genericWebOnly, true);
  assert.equal(final.onvifAvailable, false);
});

test('443/8888 redirects and login pages stay out of the camera list', () => {
  const fingerprint = classifyHostFingerprint({
    openPorts: [443, 8888],
    pages: [
      { statusCode: 302, url: 'https://192.0.2.20:443/', headers: { location: '/login' }, body: '<title>302 Found</title>' },
      { statusCode: 403, url: 'http://192.0.2.20:8888/', headers: {}, body: '<title>Login</title>' },
    ],
  });
  const final = applyFinalCameraDiscoveryPolicy({
    ip: '192.0.2.20', openPorts: [443, 8888], discoveryMethods: ['ip-range'],
    likelyCamera: fingerprint.likelyCamera, cameraCandidate: fingerprint.candidate,
    verified: fingerprint.verified, confidence: fingerprint.confidence,
  });
  assert.equal(final.likelyCamera, false);
  assert.equal(final.cameraCandidate, false);
  assert.equal(final.verified, false);
});

test('80/554/1935/8080 is a camera even with a generic management page and no RTSP handshake', () => {
  const fingerprint = classifyHostFingerprint({
    openPorts: [80, 554, 1935, 8080],
    pages: [{ statusCode: 200, url: 'http://192.0.2.30:80/', headers: {}, body: '<title>Network Management Login</title>' }],
    rtspServices: [{ port: 554, confirmed: false }],
  });
  assert.equal(fingerprint.strongPortCombinationEvidence, true);
  assert.equal(fingerprint.likelyCamera, true);
  const final = applyFinalCameraDiscoveryPolicy({
    ip: '192.0.2.30', openPorts: [80, 554, 1935, 8080], discoveryMethods: ['ip-range'],
    likelyCamera: fingerprint.likelyCamera, cameraCandidate: fingerprint.candidate,
    verified: fingerprint.verified, confidence: fingerprint.confidence,
    strongPortCombinationEvidence: fingerprint.strongPortCombinationEvidence,
    rtspConfirmed: fingerprint.rtspConfirmed,
  });
  assert.equal(final.likelyCamera, true);
  assert.equal(final.cameraCandidate, true);
  assert.equal(final.strongPortCombinationEvidence, true);
  assert.ok(final.confidence >= 88);
});

test('Hikvision 80/443/554/7681/8000/8443 remains a camera without HTTP-title evidence', () => {
  const final = applyFinalCameraDiscoveryPolicy({
    ip: '192.0.2.40', openPorts: [80, 443, 554, 7681, 8000, 8443], discoveryMethods: ['ip-range'], confidence: 0,
  });
  assert.equal(final.likelyCamera, true);
  assert.equal(final.cameraCandidate, true);
  assert.equal(final.strongPortCombinationEvidence, true);
  assert.ok(final.confidence >= 94);
});

test('standard ONVIF video type requires an additional video/camera network port in final policy', () => {
  const ws = classifyDiscoveredDevice({
    hostname: '192.0.2.50',
    port: 80,
    scopes: ['onvif://www.onvif.org/type/Network_Video_Transmitter'],
    uri: { device: 'http://192.0.2.50/onvif/device_service' },
  });
  assert.equal(ws.likelyCamera, true);
  const webOnly = applyFinalCameraDiscoveryPolicy({ ...ws.device, openPorts: [80, 443], discoveryMethods: ['onvif'] });
  assert.equal(webOnly.likelyCamera, false);
  const withRtsp = applyFinalCameraDiscoveryPolicy({ ...ws.device, openPorts: [80, 554], discoveryMethods: ['onvif', 'ip-range'] });
  assert.equal(withRtsp.likelyCamera, true);
  assert.equal(withRtsp.onvifAvailable, true);
});

test('structured ONVIF SOAP response can still verify a web-only camera endpoint', () => {
  const fingerprint = classifyHostFingerprint({
    openPorts: [80],
    pages: [{
      statusCode: 400,
      url: 'http://192.0.2.60:80/onvif/device_service',
      headers: { 'content-type': 'application/soap+xml; charset=utf-8' },
      body: '<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><s:Body><s:Fault/></s:Body></s:Envelope>',
    }],
  });
  assert.equal(fingerprint.onvifEvidence, true);
  assert.equal(fingerprint.candidate, true);
  const final = applyFinalCameraDiscoveryPolicy({
    ip: '192.0.2.60', openPorts: [80], discoveryMethods: ['ip-range'],
    cameraCandidate: fingerprint.candidate, likelyCamera: fingerprint.likelyCamera,
    verified: fingerprint.verified, confidence: fingerprint.confidence,
    directCameraProtocolEvidence: fingerprint.cameraProtocolEvidence,
    onvifHttpEvidence: fingerprint.onvifEvidence,
  });
  assert.equal(final.likelyCamera, true);
  assert.equal(final.verified, true);
  assert.equal(final.onvifAvailable, true);
});

test('generic 401 on an ONVIF-looking path is not camera proof', () => {
  const fingerprint = classifyHostFingerprint({
    openPorts: [80, 443],
    pages: [{
      statusCode: 401,
      url: 'http://192.0.2.61:80/onvif/device_service',
      headers: { 'www-authenticate': 'Basic realm="Administration"', 'content-type': 'text/html' },
      body: '<html><title>Login</title></html>',
    }],
  });
  assert.equal(fingerprint.onvifEvidence, false);
  assert.equal(fingerprint.candidate, false);
});

test('explicit server-management fingerprint wins over stale merged ONVIF/vendor flags', () => {
  const final = applyFinalCameraDiscoveryPolicy({
    ip: '192.0.2.218',
    openPorts: [80, 443],
    discoveryMethods: ['onvif', 'ip-range'],
    manufacturer: 'Dahua',
    likelyCamera: true,
    cameraCandidate: true,
    verified: true,
    confidence: 100,
    onvifDiscoveryVerified: true,
    onvifHttpEvidence: true,
    vendorEndpointEvidence: true,
    directCameraProtocolEvidence: true,
    nonCameraDevice: true,
  });
  assert.equal(final.explicitNonCamera, true);
  assert.equal(final.likelyCamera, false);
  assert.equal(final.cameraCandidate, false);
  assert.equal(final.verified, false);
  assert.equal(final.confidence, 0);
  assert.equal(final.manufacturer, null);
});
