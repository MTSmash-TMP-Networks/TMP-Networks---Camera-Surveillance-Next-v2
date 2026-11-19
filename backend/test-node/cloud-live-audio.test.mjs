import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { allowedProxyRequest } from '../src/services/remoteProxyPolicy.js';

test('cloud audio activation is authenticated, opt-in, and only reachable through constrained POST', () => {
  const streamRoute = '/api/streams/cam_123/cloud-audio';
  assert.equal(allowedProxyRequest('POST', streamRoute), true);
  assert.equal(allowedProxyRequest('GET', streamRoute), false);
  assert.equal(allowedProxyRequest('POST', streamRoute + '?token=secret'), false);
  assert.equal(allowedProxyRequest('POST', '/api/streams/cam_123/session'), false);
  assert.equal(allowedProxyRequest('POST', '/api/streams/cam_123/restart'), false);
  const code = readFileSync(new URL('../src/routes/streams.js', import.meta.url), 'utf8');
  const auth = code.indexOf('streamsRouter.use(authenticate)');
  const cloud = code.indexOf("streamsRouter.post('/:id/cloud-audio'");
  assert.ok(auth >= 0 && cloud > auth, 'Audio route must be after normal login authentication');
  assert.match(code, /quality: 'high', viewportWidth: 1280, purpose: 'live-audio'/);
  assert.match(code, /\{ wait: false \}/);
  assert.match(code, /if \(!session\.audioEnabled\)/);
  assert.match(code, /hlsUrl: null/);
});

test('permanent video-only preview stays isolated from user-initiated audio', () => {
  const orchestrator = readFileSync(new URL('../src/services/media/StreamOrchestrator.js', import.meta.url), 'utf8');
  assert.match(orchestrator, /const videoOnlyPreview = session\.permanent/);
  assert.match(orchestrator, /if \(broker\.audioConfigured && !session\.permanent\)/);
  assert.match(orchestrator, /session\.audioEnabled = Boolean\(verifiedAudioCodec\)/);
});
