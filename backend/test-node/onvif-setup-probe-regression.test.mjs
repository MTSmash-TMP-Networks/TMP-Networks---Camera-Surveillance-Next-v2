import test from 'node:test';
import assert from 'node:assert/strict';
import { onvifConnectionOptions, onvifEndpointLabel } from '../src/services/onvif/connectionOptions.js';
import { onvifProbeCandidates } from '../src/services/onvif/setupProbePlan.js';

test('exact discovery XAddr preserves ONVIF path and port', () => {
  const camera = {
    onvif: { ip: '192.168.1.215', port: 80, xaddr: 'http://192.168.1.215:8080/custom/onvif/device_service?wsdl=1' },
    username: 'admin', password: 'secret',
  };
  const options = onvifConnectionOptions(camera, 7000);
  assert.equal(options.hostname, '192.168.1.215');
  assert.equal(options.port, 8080);
  assert.equal(options.path, '/custom/onvif/device_service?wsdl=1');
  assert.equal(options.useSecure, false);
  assert.equal(onvifEndpointLabel(camera), 'http://192.168.1.215:8080/custom/onvif/device_service?wsdl=1');
});

test('HTTPS ONVIF XAddr enables secure transport without requiring a trusted camera certificate', () => {
  const options = onvifConnectionOptions({ onvif: { ip: '10.0.0.9', xaddr: 'https://10.0.0.9:8443/onvif/device_service' } });
  assert.equal(options.port, 8443);
  assert.equal(options.useSecure, true);
  assert.equal(options.secureOpts.rejectUnauthorized, false);
});

test('authenticated setup probes all plausible web/ONVIF ports but skips RTSP and RTMP media ports', () => {
  const candidates = onvifProbeCandidates({
    ip: '192.168.1.50', port: 80, xaddr: 'http://192.168.1.50:8080/onvif/device_service',
    openPorts: [80, 554, 1935, 8080], username: 'admin', password: 'secret',
  });
  assert.equal(candidates[0].probeSource, 'discovery-xaddr');
  assert.equal(candidates[0].port, 8080);
  assert.ok(candidates.some((candidate) => candidate.port === 80));
  assert.ok(candidates.some((candidate) => candidate.port === 8080));
  assert.equal(candidates.some((candidate) => candidate.port === 554), false);
  assert.equal(candidates.some((candidate) => candidate.port === 1935), false);
});

test('camera setup UI keeps XAddr and exposes ONVIF/PTZ probe progress and result', async () => {
  const { readFile } = await import('node:fs/promises');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const ui = await readFile(resolve(root, 'frontend/src/pages/AddCameraPage.jsx'), 'utf8');
  const schema = await readFile(resolve(root, 'backend/src/routes/cameras.js'), 'utf8');
  const discovery = await readFile(resolve(root, 'backend/src/services/NetworkCameraDiscovery.js'), 'utf8');
  assert.match(ui, /xaddr:\s*device\.xaddr/);
  assert.match(ui, /probe\.runningTitle/);
  assert.match(ui, /inspection\.diagnostics\.ptz\?\.detected/);
  assert.match(ui, /inspection\.diagnostics\.onvif\?\.attempts/);
  assert.match(schema, /xaddr:\s*z\.string\(\)\.max\(2000\)/);
  assert.match(discovery, /xaddr:\s*onvifPage\?\.url/);
});
