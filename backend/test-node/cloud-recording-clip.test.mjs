import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { CLOUD_CLIP_MAX_BYTES, CLOUD_CLIP_SECONDS, renderCloudRecordingClip } from '../src/services/recording/CloudRecordingClip.js';

test('cloud recording playback enforces short, bounded video transfers', async () => {
  assert.equal(CLOUD_CLIP_SECONDS, 4);
  assert.ok(CLOUD_CLIP_MAX_BYTES < 4 * 1024 * 1024);
  await assert.rejects(
    renderCloudRecordingClip({ filePath: '/not/used.ts', part: 99999, durationSeconds: 100000 }),
    /INVALID_CLOUD_CLIP/,
  );
  await assert.rejects(
    renderCloudRecordingClip({ filePath: '/not/used.ts', part: 2, durationSeconds: 7 }),
    /CLOUD_CLIP_OUT_OF_RANGE/,
  );
});

test('camera recording playback route preserves authentication and rejects full downloads', () => {
  const routes = readFileSync(new URL('../src/routes/recordings.js', import.meta.url), 'utf8');
  const policy = readFileSync(new URL('../src/services/remoteProxyPolicy.js', import.meta.url), 'utf8');
  assert.match(routes, /recordingsRouter\.use\(authenticate\)/);
  assert.match(routes, /recordingsRouter\.get\('\/:id\/cloud\/:block\/clip\/:part\.ts'/);
  assert.match(routes, /renderCloudRecordingClip\(/);
  assert.match(routes, /segment\.playable === true/);
  assert.match(policy, /recordings\?limit=100/);
  assert.doesNotMatch(policy, /return path === '\/api\/recordings\/.*file'/);
});
