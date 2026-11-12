import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cameraSavePayload, cameraSetupError } from '../src/utils/cameraValidation.js';

test('ONVIF scanner data cannot make valid camera save fail on long passive metadata', () => {
  const input = { ip: '192.168.0.35', port: 80, preferredProfile: 'SecondStreamProfile"',
    discoveryEvidence: 'found '.repeat(1200), manufacturer: 'x'.repeat(200),
    deviceUid: 'x'.repeat(300), connectionMode: 'onvif' };
  const result = cameraSavePayload(input, 'CAM-3 IP35');
  assert.equal(result.preferredProfile, 'SecondStreamProfile"'); // Never modify actual ONVIF token.
  assert.equal(result.discoveryEvidence.length, 4000);
  assert.equal(result.manufacturer.length, 160);
  assert.equal(result.deviceUid, '');
  assert.equal(result.ip, '192.168.0.35');
});

test('Validation errors tell operator which field failed, without leaking credentials', () => {
  const msg = cameraSetupError({ code: 'VALIDATION_ERROR', details: [{ path: ['preferredProfile'], code: 'too_big', maximum: 300, message: 'Too big' }] });
  assert.match(msg, /ONVIF-Profil/);
  assert.match(msg, /300/);
  assert.doesNotMatch(msg, /password/i);
});

test('Camera frontend uses diagnostics for inspect and save', () => {
  const src = readFileSync(new URL('../src/pages/AddCameraPage.jsx', import.meta.url), 'utf8');
  assert.match(src, /cameraSavePayload\(form, effectiveCameraName\(\), isDirectStream\)/);
  assert.match(src, /cameraSetupError\(e, locale\)/);
});
