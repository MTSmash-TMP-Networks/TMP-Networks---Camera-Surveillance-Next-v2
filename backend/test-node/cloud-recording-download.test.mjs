import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLOUD_MP4_SECONDS, renderCloudMp4Download } from '../src/services/recording/CloudRecordingDownload.js';
import { allowedProxyRequest } from '../src/services/remoteProxyPolicy.js';

test('download endpoint only supports explicit, read-only 15-second MP4 clips', async () => {
  assert.equal(CLOUD_MP4_SECONDS, 15);
  assert.equal(allowedProxyRequest('GET','/api/recordings/34463/cloud/download/0.mp4'), true);
  assert.equal(allowedProxyRequest('GET','/api/recordings/34463/cloud/download/12.mp4'), true);
  for (const path of [
    '/api/recordings/34463/file',
    '/api/recordings/34463/cloud/download/0.mp4?token=secret',
    '/api/recordings/34463/cloud/download/999999.mp4',
    '/api/recordings/34463/cloud/download/../file',
    '/api/recordings/34463/cloud/download/0.mp4?download=1',
  ]) assert.equal(allowedProxyRequest('GET',path),false,path);
  assert.equal(allowedProxyRequest('DELETE','/api/recordings/34463/cloud/download/0.mp4'),false);
  await assert.rejects(
    renderCloudMp4Download({filePath:'',offsetSeconds:0,durationSeconds:20}),
    /CLOUD_MP4_INVALID_RANGE/,
  );
});

test('MP4 route requires normal camera authentication and does not accept a recording token in the URL', () => {
  const source=readFileSync(new URL('../src/routes/recordings.js',import.meta.url),'utf8');
  assert.ok(source.indexOf("recordingsRouter.get('/:id/cloud/download/:part.mp4'")>source.indexOf('recordingsRouter.use(authenticate)'));
  assert.match(source,/Content-Disposition.*attachment/);
  assert.match(source,/renderCloudMp4Download/);
});
