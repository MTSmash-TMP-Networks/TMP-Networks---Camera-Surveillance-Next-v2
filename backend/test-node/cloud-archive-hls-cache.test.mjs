import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectArchiveWindow, ARCHIVE_HLS_WINDOW_SECONDS } from '../src/services/recording/CloudArchiveHlsCache.js';
import { allowedProxyRequest } from '../src/services/remoteProxyPolicy.js';

test('archive selection never misses media at recording block boundaries', () => {
  assert.equal(ARCHIVE_HLS_WINDOW_SECONDS, 30);
  const recording = { id: 34463, archiveFormat: 'block_archive_v1', endedAt: '2026-11-19T22:00:00Z' };
  const blocks = [
    { segmentIndex: 1, playable: true, durationSeconds: 35, sizeBytes: 123 },
    { segmentIndex: 2, playable: true, durationSeconds: 30, sizeBytes: 456 },
  ];
  const a = selectArchiveWindow(recording, blocks, 0);
  const b = selectArchiveWindow(recording, blocks, 1);
  const c = selectArchiveWindow(recording, blocks, 2);
  assert.deepEqual([a.blockIndex, a.offsetSeconds, a.durationSeconds], [1, 0, 30]);
  assert.deepEqual([b.blockIndex, b.offsetSeconds, b.durationSeconds], [1, 30, 5]);
  assert.deepEqual([c.blockIndex, c.offsetSeconds, c.durationSeconds], [2, 0, 30]);
  assert.equal(c.totalWindows, 3);
  assert.equal(selectArchiveWindow(recording, blocks, 3), null);
  assert.equal(selectArchiveWindow(recording, blocks, -1), null);
});

test('archive proxy accepts only tiny VOD file names, never arbitrary files or writes', () => {
  const allowed = [
    '/api/recordings/34463/cloud-hls/0/index.m3u8',
    '/api/recordings/34463/cloud-hls/12/seg_0001.ts',
    '/api/recordings/34463/cloud-hls/4095/seg_12345.ts',
  ];
  for (const url of allowed) assert.equal(allowedProxyRequest('GET', url), true, url);
  for (const url of [
    '/api/recordings/34463/cloud-hls/0/seg_1.ts',
    '/api/recordings/34463/cloud-hls/0/../../secret',
    '/api/recordings/34463/cloud-hls/0/manifest.json',
    '/api/recordings/34463/cloud-hls/0/index.m3u8?token=secret',
    '/api/recordings/34463/cloud-hls/99999/seg_0001.ts',
    '/api/recordings/34463/file',
  ]) assert.equal(allowedProxyRequest('GET', url), false, url);
  assert.equal(allowedProxyRequest('POST', allowed[0]), false);
  assert.equal(allowedProxyRequest('DELETE', allowed[1]), false);
});

test('archive route enforces normal bearer authentication and bounded file responses', () => {
  const source = readFileSync(new URL('../src/routes/recordings.js', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../src/services/recording/CloudArchiveHlsCache.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf("recordingsRouter.get('/:id/cloud-hls/:window/:file'") > source.indexOf('recordingsRouter.use(authenticate)'));
  assert.match(source, /cloudArchiveHlsCache\.status\(/);
  assert.match(source, /cloudArchiveHlsCache\.segment\(/);
  assert.match(service, /const MAX_ACTIVE = 2/);
  assert.match(service, /CACHE_MAX_BYTES = 384 \* 1024 \* 1024/);
  assert.match(service, /SEGMENT_MAX_BYTES = 3_400_000/);
  assert.match(service, /await cached\(spec\)/);
});
