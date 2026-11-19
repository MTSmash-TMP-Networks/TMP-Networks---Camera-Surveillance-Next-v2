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

test('cloud recording archive allows only read-only, bounded metadata and short clips', () => {
  for (const route of [
    '/api/recordings?limit=100',
    '/api/recordings?cameraId=cam_A-1&limit=100',
    '/api/recordings/57/segments',
    '/api/recordings/57/cloud/file/clip/0.ts',
    '/api/recordings/57/cloud/3/clip/1800.ts',
  ]) assert.equal(allowedProxyRequest('GET', route), true, route);
  for (const route of [
    '/api/recordings',
    '/api/recordings?limit=500',
    '/api/recordings/57/playlist.m3u8',
    '/api/recordings/57/file',
    '/api/recordings/57/token',
    '/api/recordings/57/cloud/file/clip/2.ts?token=secret',
    '/api/recordings/57/cloud/file/clip/99999.ts',
    '/api/recordings?cameraId=x&limit=100&admin=1',
    '/api/recordings/57/segments?token=abc',
  ]) assert.equal(allowedProxyRequest('GET', route), false, route);
  assert.equal(allowedProxyRequest('POST', '/api/recordings/57/cloud/file/clip/0.ts'), false);
  assert.equal(allowedProxyRequest('DELETE', '/api/recordings/57'), false);
});
