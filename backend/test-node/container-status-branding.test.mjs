import assert from 'node:assert/strict';
import test from 'node:test';
import { publicContainerImage } from '../src/utils/containerBranding.js';

test('go2rtc image is branded as TMP-Encoder in public container status', () => {
  assert.equal(publicContainerImage({ service: 'mediamtx', image: 'alexxit/go2rtc:1.9.14' }), 'TMP-Encoder');
  assert.equal(publicContainerImage({ service: 'other', image: 'alexxit/go2rtc:1.9.14' }), 'TMP-Encoder');
});

test('media service stays branded even if the underlying image changes', () => {
  assert.equal(publicContainerImage({ service: 'mediamtx', image: 'vendor/media:2.0' }), 'TMP-Encoder');
});

test('unrelated container images remain unchanged', () => {
  assert.equal(publicContainerImage({ service: 'frontend', image: 'nginx:1.29.8-alpine' }), 'nginx:1.29.8-alpine');
});
