import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const base = resolve(import.meta.dirname,'../..');
const read = (p) => readFileSync(resolve(base,p),'utf8');
test('Intel device is opt-in with render-only passthrough and never privileged', () => {
  const overrides = read('scripts/docker-compose.intel.yml');
  assert.match(overrides,/renderD128/);
  assert.match(overrides,/group_add:/);
  assert.doesNotMatch(overrides,/privileged:\s*true/);
  const shell = read('scripts/intel-vaapi.sh');
  assert.match(shell,/h264_vaapi/);
  assert.match(shell,/--device/);
  assert.match(shell,/--group-add/);
  assert.match(shell,/ENABLE_INTEL_GPU_COMPOSE true/);
  assert.match(shell,/GO2RTC_FFMPEG_HARDWARE vaapi/);
  assert.match(shell,/--disable/);
});
test('both host and update agent retain Intel compose override',()=>{
  assert.match(read('scripts/docker-compose.sh'),/docker-compose\.intel\.yml/);
  assert.match(read('updater/src/server.js'),/INTEL_GPU_COMPOSE_ENABLED/);
  assert.match(read('updater/src/server.js'),/scripts\/docker-compose\.intel\.yml/);
  assert.match(read('backend/src/services/media/StreamOrchestrator.js'),/INTEL_VAAPI_CPU_FALLBACK/);
});
