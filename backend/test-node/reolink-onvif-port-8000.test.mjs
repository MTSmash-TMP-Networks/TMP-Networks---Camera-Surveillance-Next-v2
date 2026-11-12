import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { cameraPortDefinition, DEFAULT_CAMERA_SCAN_PORTS, CAMERA_PRIMARY_SCAN_PORTS, CAMERA_WEB_PORTS, CAMERA_ONVIF_PROBE_PORTS } from '../src/services/media/CameraPortCatalog.js';
import { onvifProbeCandidates } from '../src/services/onvif/setupProbePlan.js';
import { onvifConnectionOptions } from '../src/services/onvif/connectionOptions.js';
import { probeOnvifHttpDeviceService } from '../src/services/onvif/OnvifHttpProbe.js';
import { isConfirmedOnvifServicePage, classifyHostFingerprint } from '../src/services/media/CameraHostClassifier.js';

const soap = '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><s:Fault xmlns:tds="http://www.onvif.org/ver10/device/wsdl"/></s:Body></s:Envelope>';

test('port 8000 is scanned by default but retains Hikvision SDK compatibility', () => {
  assert.ok(DEFAULT_CAMERA_SCAN_PORTS.includes(8000));
  assert.ok(CAMERA_PRIMARY_SCAN_PORTS.includes(8000));
  assert.ok(CAMERA_ONVIF_PROBE_PORTS.includes(8000));
  assert.equal(CAMERA_WEB_PORTS.includes(8000), false);
  assert.equal(cameraPortDefinition(8000).service, 'vendor');
  assert.ok(cameraPortDefinition(8000).vendors.includes('Hikvision'));
  assert.ok(cameraPortDefinition(8000).vendors.includes('Reolink'));
});

test('Reolink ONVIF setup can try port 8000 even if an older web scan omitted it', () => {
  const candidates = onvifProbeCandidates({ ip: '192.0.2.77', manufacturer: 'Reolink', port: 80, openPorts: [80, 554, 8080] });
  assert.ok(candidates.some((x) => x.port === 8000 && !x.xaddr));
  assert.equal(candidates.some((x) => x.port === 554), false);
  const selected = onvifProbeCandidates({ ip: '192.0.2.77', port: 8000, openPorts: [80, 8000] });
  assert.equal(selected[0].port, 8000);
  const options = onvifConnectionOptions({ onvif: { ip: '192.0.2.77', port: 8000 }, username: 'user', password: 'secret' });
  assert.equal(options.port, 8000);
  assert.equal(options.useSecure, undefined);
});

test('generic login and Hikvision SDK on 8000 do not falsely verify ONVIF', () => {
  const page = { url: 'http://192.0.2.23:8000/onvif/device_service', statusCode: 401, headers: { 'www-authenticate': 'Basic realm="Administration"' }, body: '<html>Login</html>' };
  assert.equal(isConfirmedOnvifServicePage(page), false);
  const result = classifyHostFingerprint({ openPorts: [8000], pages: [page] });
  assert.equal(result.onvifEvidence, false);
  assert.equal(result.candidate, false);
});

test('ONVIF SOAP or Reolink-specific HTTP auth challenge confirms port 8000', () => {
  const page = { url: 'http://192.0.2.77:8000/onvif/device_service', statusCode: 400, headers: { 'content-type': 'application/soap+xml' }, body: soap };
  assert.equal(isConfirmedOnvifServicePage(page), true);
  const c = classifyHostFingerprint({ openPorts: [8000], pages: [page] });
  assert.equal(c.onvifEvidence, true);
  assert.equal(c.verified, true);
  const challenge = { url: page.url, statusCode: 401, headers: { 'www-authenticate': 'Digest realm="Reolink"' }, body: '' };
  assert.equal(isConfirmedOnvifServicePage(challenge), true);
});

test('ONVIF detector sends a read-only SOAP POST and checks the camera response', async () => {
  let requestedPath = null;
  let method = null;
  let requestBody = '';
  const server = http.createServer((req, res) => {
    requestedPath = req.url;
    method = req.method;
    req.on('data', (chunk) => { requestBody += String(chunk); });
    req.on('end', () => { res.writeHead(400, { 'content-type': 'application/soap+xml' }); res.end(soap); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await probeOnvifHttpDeviceService('127.0.0.1', server.address().port, 1200);
    assert.equal(method, 'POST');
    assert.equal(requestedPath, '/onvif/device_service');
    assert.match(requestBody, /GetSystemDateAndTime/);
    assert.equal(isConfirmedOnvifServicePage(response), true);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('the real manual-IP discovery checks an ONVIF HTTP endpoint on port 8000', async (t) => {
  // This full discovery integration test needs runtime dependencies (pino,
  // onvif etc.). The pure decision/verification tests above still run with
  // the lean release ZIP, while deployed CI/npm installs exercise this path.
  let NetworkCameraDiscovery;
  let preferredCameraPort;
  try {
    ({ NetworkCameraDiscovery, preferredCameraPort } = await import('../src/services/NetworkCameraDiscovery.js'));
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') { t.skip('Backend runtime dependencies are not installed'); return; }
    throw error;
  }
  assert.equal(preferredCameraPort([80, 8000], 8000), 8000);
  const server = http.createServer((req, res) => {
    if (req.url === '/onvif/device_service' && req.method === 'POST') {
      res.writeHead(400, { 'content-type': 'application/soap+xml' });
      res.end(soap);
    } else { res.writeHead(404); res.end(); }
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8000, '127.0.0.1', resolve); });
  } catch (error) {
    server.close();
    if (error.code === 'EADDRINUSE' || error.code === 'EACCES') { t.skip('Port 8000 cannot be bound in this environment'); return; }
    throw error;
  }
  try {
    const result = await NetworkCameraDiscovery.inspectHost('127.0.0.1', { ports: [8000], timeoutMs: 450 });
    assert.equal(result.reachable, true);
    assert.equal(result.onvifAvailable, true);
    assert.equal(result.onvifPort, 8000);
    assert.equal(result.port, 8000);
    assert.equal(result.xaddr, 'http://127.0.0.1:8000/onvif/device_service');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
