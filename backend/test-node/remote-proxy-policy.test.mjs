import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedProxyRequest } from '../src/services/remoteProxyPolicy.js';

test('proxy permits only camera browser reads and login', () => {
  for (const route of [
    '/api/cameras', '/api/streams/a32f/preview', '/api/cameras/a32f/thumbnail',
    '/live-hls/cam_23_abc/index.m3u8', '/live-hls/cam_23_abc/seg_108.ts',
  ]) assert.equal(allowedProxyRequest('GET', route), true, route);
  assert.equal(allowedProxyRequest('POST', '/api/auth/login'), true);
});

test('proxy rejects admin APIs, SSRF, traversal, recordings and writes by default', () => {
  for (const route of [
    '/api/system/update/install', '/api/auth/me', '/api/system/remote-proxy',
    '/api/cameras/a32f/snapshot', '/api/recordings',
    '/live-hls/../../etc/passwd', '//attacker.invalid/api/cameras',
    '/api/streams/a32f/restart', '/live-hls/test/seg_foo.ts',
    '/api/cameras/a32f/thumbnail%2f../../private',
    '/api/cameras/a32f/thumbnail\\more',
    '/api/streams/a32f/session',
  ]) assert.equal(allowedProxyRequest('GET', route), false, route);
  for (const route of ['/api/cameras', '/api/system/restart', '/api/streams/a32f/preview'])
    assert.equal(allowedProxyRequest('POST', route), false, route);
  assert.equal(allowedProxyRequest('DELETE', '/api/cameras'), false);
});
