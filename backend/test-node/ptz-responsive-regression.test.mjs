import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const pool = read('backend/src/services/ptz/PtzClientPool.js');
const service = read('backend/src/services/ptz/PtzService.js');
const routes = read('backend/src/routes/ptz.js');
const front = read('frontend/src/components/PtzControls.jsx');
const player = read('frontend/src/services/hlsPlayer.js');
const live = read('frontend/src/services/liveStreamPool.js');
const config = read('backend/src/config.js');

test('PTZ prepare remains a permission-gated nonmovement operation', () => {
  assert.match(routes, /ptzRouter.use\(authenticate, authorize\('operator'\)\)/);
  assert.match(routes, /post\('\/:id\/prepare'/);
  assert.match(routes, /ptzService.prepare\(req.params.id, input\)/);
  assert.match(service, /ptzClientPool.prewarm\(camera\)/);
  assert.match(pool, /for \(const channel of \['move', 'stop'\]\)/);
  assert.match(pool, /await client.open\(\)/);
  assert.match(pool, /this.invalidate\(cameraId, channel\)/);
  assert.match(config, /PTZ_PREWARM_ENABLED', true/);
});
test('PTZ requests continue to prioritize physical safety stops and reject stale UI responses', () => {
  assert.match(front, /MOVE_PULSE_MS = 700/);
  assert.match(front, /api.ptzPrepare\(camera.id/);
  assert.match(front, /if \(interaction.ended \|\| activeRef.current !== interaction\) return/);
  assert.match(service, /ptzCommandRuntime.stop\(/);
  assert.match(service, /recoveryStop\(cameraId/);
});
test('interactive live nudges latency without touching kiosk or the central publisher', () => {
  assert.match(player, /targetLiveDelaySeconds = TARGET_LIVE_DELAY_SECONDS/);
  assert.match(player, /const liveDelay = Math.max\(2.5/);
  assert.match(player, /ptzSeekers.set\(video, nudgeForControl\)/);
  assert.match(live, /targetLiveDelaySeconds: entry.purpose === 'live' \? 3 : 8/);
  assert.match(live, /entry.purpose === 'live' && reason === 'ptz-move'/);
  assert.match(live, /nudgeHlsForPtz\(entry.video\)/);
});
