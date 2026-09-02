import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecordingCompressionArgs, normalizeRecordingCompressionPreset } from '../src/services/recording/RecordingCompressionCommand.js';

test('recording compression keeps MPEG-TS/H.264 compatibility and drops data tracks', () => {
  const args = buildRecordingCompressionArgs({ inputPath: '/in.ts', outputPath: '/out.ts', crf: 29, threads: 1 });
  assert.equal(args.at(args.indexOf('-c:v') + 1), 'libx264');
  assert.equal(args.at(args.indexOf('-f') + 1), 'mpegts');
  assert.ok(args.includes('0:v:0'));
  assert.ok(args.includes('0:a:0?'));
  assert.ok(args.includes('-dn'));
  assert.equal(args.at(-1), '/out.ts');
});

test('recording compression clamps unsafe values and presets', () => {
  const args = buildRecordingCompressionArgs({ inputPath: 'a', outputPath: 'b', crf: 100, threads: 0, audioBitrateKbps: 2, preset: 'unknown' });
  assert.equal(args.at(args.indexOf('-crf') + 1), '40');
  assert.equal(args.at(args.indexOf('-threads:v') + 1), '1');
  assert.equal(args.at(args.indexOf('-b:a') + 1), '24k');
  assert.equal(normalizeRecordingCompressionPreset('unknown'), 'veryfast');
});
