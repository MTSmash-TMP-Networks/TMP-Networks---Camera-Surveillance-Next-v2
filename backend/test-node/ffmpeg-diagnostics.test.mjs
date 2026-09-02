import assert from 'node:assert/strict';
import test from 'node:test';
import { isBenignFfmpegDiagnostic } from '../src/services/media/FfmpegDiagnostics.js';

test('timestamp correction is not treated as a connection failure', () => {
  assert.equal(isBenignFfmpegDiagnostic('[tee] Non-monotonous DTS in output stream 0:1; previous: 10, current: 9; changing to 11. This may result in incorrect timestamps in the output file.'), true);
  assert.equal(isBenignFfmpegDiagnostic('Connection refused'), false);
  assert.equal(isBenignFfmpegDiagnostic('401 Unauthorized'), false);
});
