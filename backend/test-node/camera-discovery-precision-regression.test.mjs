import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHostFingerprint } from '../src/services/media/CameraHostClassifier.js';

function assertRejected(openPorts, extra = {}) {
  const result = classifyHostFingerprint({ openPorts, ...extra });
  assert.equal(result.candidate, false);
  assert.equal(result.likelyCamera, false);
  assert.equal(result.verified, false);
  assert.equal(result.confidence, 0);
  return result;
}

test('camera discovery accepts Web + RTSP + RTMP appliance signature', () => {
  const result = classifyHostFingerprint({ openPorts: [80, 554, 1935, 8080] });
  assert.equal(result.candidate, true);
  assert.equal(result.likelyCamera, true);
  assert.equal(result.strongPortCombinationEvidence, true);
  assert.ok(result.confidence >= 88);
});

test('camera discovery accepts Hikvision WebSocket + SDK + RTSP signature', () => {
  const result = classifyHostFingerprint({ openPorts: [80, 443, 554, 7681, 8000, 8443] });
  assert.equal(result.candidate, true);
  assert.equal(result.likelyCamera, true);
  assert.equal(result.manufacturer, 'Hikvision');
  assert.equal(result.strongPortCombinationEvidence, true);
  assert.ok(result.confidence >= 94);
});

test('camera discovery rejects generic HTTP + HTTPS devices', () => {
  const result = assertRejected([80, 443]);
  assert.equal(result.genericWebOnly, true);
});

test('camera discovery rejects generic HTTPS + alternate web devices', () => {
  const result = assertRejected([443, 8888]);
  assert.equal(result.genericWebOnly, true);
});

test('camera-looking HTML alone no longer turns a web appliance into a camera', () => {
  const result = assertRejected([80, 443], {
    pages: [{
      statusCode: 200,
      url: 'http://192.0.2.50:80/',
      headers: { server: 'nginx' },
      body: '<html><title>Camera Management</title><p>Live View IP Camera</p></html>',
    }],
  });
  assert.equal(result.genericWebOnly, true);
});

test('a concrete camera API can still validate a web-only camera', () => {
  const result = classifyHostFingerprint({
    openPorts: [80],
    pages: [
      {
        statusCode: 200,
        url: 'http://192.0.2.60:80/',
        headers: {},
        body: '<html><title>Hikvision Network Camera</title></html>',
      },
      {
        statusCode: 200,
        url: 'http://192.0.2.60:80/ISAPI/System/deviceInfo',
        headers: { 'content-type': 'application/xml' },
        body: '<DeviceInfo><deviceName>Hikvision Network Camera</deviceName><model>DS-2CD2385FWD-I</model><serialNumber>ABC123</serialNumber></DeviceInfo>',
      },
    ],
  });
  assert.equal(result.candidate, true);
  assert.equal(result.likelyCamera, true);
  assert.equal(result.verified, true);
  assert.equal(result.vendorEndpointEvidence, true);
});

test('HPE iLO with only 80/443 is rejected even when camera probe paths echo generic hardware XML', () => {
  const result = classifyHostFingerprint({
    openPorts: [80, 443],
    pages: [
      {
        statusCode: 200,
        url: 'https://192.0.2.215:443/',
        headers: { server: 'HPE-iLO/5' },
        body: '<html><title>HPE Integrated Lights-Out 5</title><p>Integrated Remote Console</p></html>',
      },
      {
        statusCode: 200,
        url: 'https://192.0.2.215:443/cgi-bin/magicBox.cgi?action=getSystemInfo',
        headers: { 'content-type': 'application/xml' },
        body: '<Response><Message>Request /cgi-bin/magicBox.cgi?action=getSystemInfo</Message><Model>ProLiant DL380 Gen10</Model><SerialNumber>CZ1234</SerialNumber><FirmwareVersion>3.10</FirmwareVersion></Response>',
      },
    ],
  });
  assert.equal(result.nonCameraDevice, true);
  assert.equal(result.vendorEndpointEvidence, false);
  assert.equal(result.manufacturer, null);
  assert.equal(result.candidate, false);
  assert.equal(result.likelyCamera, false);
});

test('generic XML with Model/SerialNumber on a camera probe path is not a Dahua API response', () => {
  const result = assertRejected([80, 443], {
    pages: [{
      statusCode: 200,
      url: 'https://192.0.2.216:443/cgi-bin/magicBox.cgi?action=getSystemInfo',
      headers: { 'content-type': 'application/xml' },
      body: '<Response><Model>Generic Server</Model><SerialNumber>ABC</SerialNumber><FirmwareVersion>1.2</FirmwareVersion></Response>',
    }],
  });
  assert.equal(result.vendorEndpointEvidence, false);
  assert.equal(result.manufacturer, null);
});

test('real Dahua magicBox key-value response still verifies a web-only camera', () => {
  const result = classifyHostFingerprint({
    openPorts: [80, 443],
    pages: [{
      statusCode: 200,
      url: 'http://192.0.2.217:80/cgi-bin/magicBox.cgi?action=getSystemInfo',
      headers: { 'content-type': 'text/plain' },
      body: 'deviceType=IPC-HDW3849H-AS-PV\nserialNumber=8D0123456\nsoftwareVersion=V3.140.0000000.0.R\nhardwareVersion=1.00\nprocessor=SSC338Q',
    }],
  });
  assert.equal(result.vendorEndpointEvidence, true);
  assert.equal(result.manufacturer, 'Dahua');
  assert.equal(result.candidate, true);
  assert.equal(result.verified, true);
});
