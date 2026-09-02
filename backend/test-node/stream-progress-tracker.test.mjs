import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamProgressTracker, consumeFfmpegProgress } from '../src/services/media/StreamProgressTracker.js';

test('identical FFmpeg progress values do not keep a frozen stream healthy', () => {
  const tracker = createStreamProgressTracker();
  assert.equal(consumeFfmpegProgress(tracker, ['frame=10', 'out_time_us=400000']), true);
  assert.equal(consumeFfmpegProgress(tracker, ['frame=10', 'out_time_us=400000', 'progress=continue']), false);
  assert.equal(consumeFfmpegProgress(tracker, ['frame=11', 'out_time_us=440000']), true);
});

test('non numeric and backwards values cannot fake progress', () => {
  const tracker = createStreamProgressTracker();
  assert.equal(consumeFfmpegProgress(tracker, ['frame=N/A', 'out_time_us=N/A']), false);
  assert.equal(consumeFfmpegProgress(tracker, ['frame=20']), true);
  assert.equal(consumeFfmpegProgress(tracker, ['frame=19']), false);
});
