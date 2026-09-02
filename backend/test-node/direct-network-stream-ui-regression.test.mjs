import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const text = async (relative) => readFile(new URL(relative, root), 'utf8');

test('camera wizard exposes direct network streams as a first-class setup mode', async () => {
  const page = await text('frontend/src/pages/AddCameraPage.jsx');
  assert.match(page, /connectionMode:\s*'stream'/);
  assert.match(page, /stream\.addCardTitle/);
  assert.match(page, /RTSP \/ RTSPS/);
  assert.match(page, /HLS \/ M3U8/);
  assert.match(page, /RTMP \/ RTMPS/);
  assert.match(page, /\['srt', 'SRT'\]/);
  assert.match(page, /api\.inspect\(payload\)/);
});

test('direct stream cameras bypass ONVIF in ingest and snapshot paths', async () => {
  const orchestrator = await text('backend/src/services/media/StreamOrchestrator.js');
  const snapshots = await text('backend/src/services/media/SnapshotService.js');
  const service = await text('backend/src/services/cameraService.js');
  assert.match(orchestrator, /camera\.connectionType === 'stream'/);
  assert.match(orchestrator, /directStream \? null : new OnvifClient/);
  assert.match(snapshots, /directStream \? null : new OnvifClient/);
  assert.match(service, /inspectDirectStream/);
  assert.match(service, /findStreamDuplicate/);
  assert.match(service, /allowExternalHost: true/);
});

test('direct stream editor removes ONVIF-only discovery controls', async () => {
  const page = await text('frontend/src/pages/EditCameraPage.jsx');
  assert.match(page, /connectionType === 'stream'/);
  assert.match(page, /!directStream &&/);
  assert.match(page, /stream\.editTitle/);
  assert.match(page, /mediaSources/);
});
