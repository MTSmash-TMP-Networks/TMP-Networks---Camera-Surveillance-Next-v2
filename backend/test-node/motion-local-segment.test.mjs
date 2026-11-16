import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { selectFreshMotionSegment } from '../src/services/recording/MotionLocalSegmentSource.js';

function withRing(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-motion-ring-'));
  try { fn(dir, pathToFileURL(path.join(dir, 'index.m3u8')).href); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('motion takes newest complete local HLS segment, without opening RTSP', () => withRing((dir, uri) => {
  fs.writeFileSync(path.join(dir, 'index.m3u8'), '#EXTM3U\n#EXTINF:1,\nseg_000001.ts\n#EXTINF:1,\nseg_000002.ts\n');
  fs.writeFileSync(path.join(dir, 'seg_000001.ts'), Buffer.alloc(3760, 1));
  fs.writeFileSync(path.join(dir, 'seg_000002.ts'), Buffer.alloc(5640, 2));
  const selected = selectFreshMotionSegment(uri, { maxAgeMs: 8000 });
  assert.equal(selected?.name, 'seg_000002.ts');
  assert.equal(selected?.uri, pathToFileURL(path.join(dir, 'seg_000002.ts')).href);
}));

test('missing and stale segments fall back safely to legacy readers', () => withRing((dir, uri) => {
  fs.writeFileSync(path.join(dir, 'index.m3u8'), '#EXTM3U\nseg_000001.ts\n');
  assert.equal(selectFreshMotionSegment(uri), null);
  const segment = path.join(dir, 'seg_000001.ts');
  fs.writeFileSync(segment, Buffer.alloc(5640, 1));
  const old = new Date(Date.now() - 30000);
  fs.utimesSync(segment, old, old);
  assert.equal(selectFreshMotionSegment(uri, { maxAgeMs: 8000 }), null);
}));

test('unsafe segment names and non-file protocols are ignored', () => withRing((dir, uri) => {
  fs.writeFileSync(path.join(dir, 'index.m3u8'), '#EXTM3U\n../sensitive.ts\nseg_evil.ts\n');
  assert.equal(selectFreshMotionSegment(uri), null);
  assert.equal(selectFreshMotionSegment('rtsp://example.test/media'), null);
}));
