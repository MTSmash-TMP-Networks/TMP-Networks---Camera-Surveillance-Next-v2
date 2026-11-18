import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAMERA_PORT_DEFINITIONS, CAMERA_WEB_PORTS,
  DEFAULT_CAMERA_SCAN_PORTS, CAMERA_PRIMARY_SCAN_PORTS,
  CAMERA_ONVIF_PROBE_PORTS, CAMERA_ONVIF_HTTP_VENDOR_PORTS,
  cameraPortDefinition,
} from '../src/services/media/CameraPortCatalog.js';
import { onvifProbeCandidates } from '../src/services/onvif/setupProbePlan.js';
import { onvifConnectionOptions } from '../src/services/onvif/connectionOptions.js';
import { probeOnvifHttpDeviceService } from '../src/services/onvif/OnvifHttpProbe.js';
import { isConfirmedOnvifServicePage, classifyHostFingerprint } from '../src/services/media/CameraHostClassifier.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sources = {
  discovery: readFileSync(resolve(root, 'backend/src/services/NetworkCameraDiscovery.js'), 'utf8'),
  config: readFileSync(resolve(root, 'backend/src/config.js'), 'utf8'),
  start: readFileSync(resolve(root, 'start.sh'), 'utf8'),
  env: readFileSync(resolve(root, '.env.example'), 'utf8'),
};
const soap = '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><s:Fault xmlns:tds="http://www.onvif.org/ver10/device/wsdl"/></s:Body></s:Envelope>';

test('Voscam ONVIF 888 participates in automatic discovery and targeted ONVIF probing', () => {
  assert.equal(cameraPortDefinition(888)?.service, 'onvif');
  assert.ok(cameraPortDefinition(888).vendors.includes('Voscam'));
  assert.ok(CAMERA_PORT_DEFINITIONS.some((entry) => entry.port === 888));
  for (const ports of [DEFAULT_CAMERA_SCAN_PORTS, CAMERA_PRIMARY_SCAN_PORTS, CAMERA_ONVIF_PROBE_PORTS, CAMERA_ONVIF_HTTP_VENDOR_PORTS]) {
    assert.ok(ports.includes(888));
  }
  assert.ok(!CAMERA_WEB_PORTS.includes(888), 'ONVIF 888 must not be falsely marked as a generic web server');
});

test('Voscam setup honors ONVIF 888 without changing the discovered XAddr or trying RTSP ports', () => {
  const xaddr = 'http://192.0.2.88:888/onvif/device_service';
  const onvif = onvifProbeCandidates({
    ip: '192.0.2.88', manufacturer: 'Voscam',
    port: 888, xaddr, openPorts: [554, 888],
  });
  assert.equal(onvif[0].probeSource, 'discovery-xaddr');
  assert.equal(onvif[0].port, 888);
  assert.ok(onvif.some((item) => item.port === 888));
  assert.ok(!onvif.some((item) => item.port === 554));
  const options = onvifConnectionOptions({ onvif: { ip: '192.0.2.88', port: 888, xaddr } });
  assert.equal(options.port, 888);
  assert.equal(options.path, '/onvif/device_service');
  assert.equal(options.useSecure, false);
});

test('confirmed SOAP on port 888 identifies the camera; generic login does not', () => {
  const url = 'http://192.0.2.88:888/onvif/device_service';
  const soapPage = { url, statusCode: 400, headers: { 'content-type': 'application/soap+xml' }, body: soap };
  assert.equal(isConfirmedOnvifServicePage(soapPage), true);
  const result = classifyHostFingerprint({ openPorts: [888], pages: [soapPage] });
  assert.equal(result.verified, true);
  assert.equal(result.onvifEvidence, true);
  const fake = { url, statusCode: 401, headers: { 'www-authenticate': 'Basic realm="Admin"' }, body: 'Login' };
  assert.equal(isConfirmedOnvifServicePage(fake), false);
  const falsePositive = classifyHostFingerprint({ openPorts: [888], pages: [fake] });
  assert.equal(falsePositive.verified, false);
  assert.equal(falsePositive.candidate, false);
});

test('SOAP proof is fetched with a read-only ONVIF request on port 888', async () => {
  let method = null;
  let requestPath = null;
  const server = http.createServer((req, res) => {
    method = req.method;
    requestPath = req.url;
    req.resume();
    req.on('end', () => {
      res.writeHead(400, { 'content-type': 'application/soap+xml' });
      res.end(soap);
    });
  });
  // Ephemeral local port keeps the test runnable without privileges or conflicts.
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await probeOnvifHttpDeviceService('127.0.0.1', server.address().port, 1000);
    assert.equal(method, 'POST');
    assert.equal(requestPath, '/onvif/device_service');
    assert.equal(isConfirmedOnvifServicePage(response), true);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('host discovery includes 888 when old .env still lists only old ports', () => {
  assert.match(sources.discovery, /const defaults = \[80, 443, 554, 8000, 8080, 888,/);
  assert.match(sources.discovery, /new Set\(\[\.\.\.preferred, 888\]\.map\(Number\)\)/);
  assert.match(sources.env, /DISCOVERY_HOST_DISCOVERY_PORTS=[^\n]*888/);
  assert.match(sources.config, /DISCOVERY_HOST_DISCOVERY_PORTS[^\n]*888/);
  assert.match(sources.start, /DISCOVERY_HOST_DISCOVERY_PORTS=[^\n]*888/);
  assert.match(sources.discovery, /for \(const port of CAMERA_ONVIF_HTTP_VENDOR_PORTS\)/);
});
