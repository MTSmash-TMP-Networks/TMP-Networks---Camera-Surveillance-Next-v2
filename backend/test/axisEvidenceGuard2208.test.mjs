import test from 'node:test';
import assert from 'node:assert/strict';
import { isVerifiedAxisIdentity, sanitizeAxisHints } from '../src/axisEvidenceGuard.js';

test('probe URLs, redirects, login pages and generic HTTP responses are not Axis evidence', () => {
  const cases = [
    { manufacturer:'Axis', driver:'axis', url:'http://host/axis-cgi/basicdeviceinfo.cgi', status:200, title:'Login' },
    { vendor:'axis', endpoint:'/axis-cgi/param.cgi', status:401, body:'Unauthorized' },
    { brand:'Axis', requestUrl:'/axis-cgi/com/ptz.cgi', status:403, title:'Forbidden' },
    { adapter:'axis', path:'/axis-cgi/', status:404, body:'Document Error: Not Found' },
    { provider:'axis', detectionMethods:['vapix'], status:302, location:'/login' }
  ];
  for (const value of cases) assert.equal(isVerifiedAxisIdentity(value), false);
});

test('a weak Axis hint cannot override authenticated ONVIF or remove PTZ', () => {
  const value = { manufacturer:'Axis', driver:'axis', onvifVerified:true, ptz:true, profileToken:'profile_1' };
  sanitizeAxisHints(value);
  assert.equal(value.manufacturer, null);
  assert.equal(value.driver, 'onvif');
  assert.equal(value.ptz, true);
  assert.equal(value.axisHintRejected, true);
});

test('concrete VAPIX and Axis device identity is retained', () => {
  const cases = [
    { manufacturer:'Axis', body:'root.Brand.Brand=AXIS\nroot.Properties.System.ProdFullName=AXIS P3265-LV' },
    { vendor:'Axis', body:'{"manufacturer":"AXIS Communications","prodFullName":"AXIS Q6315-LE"}' },
    { driver:'axis', body:'VAPIX API response', headers:{server:'AXIS/11.11'} }
  ];
  for (const value of cases) {
    assert.equal(isVerifiedAxisIdentity(value), true);
    sanitizeAxisHints(value);
    assert.equal(value.axisVerified, true);
  }
});
