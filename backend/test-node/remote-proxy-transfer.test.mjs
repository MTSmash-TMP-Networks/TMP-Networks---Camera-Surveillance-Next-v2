import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { encodeRemoteProxyResult, REMOTE_PROXY_MAX_RESPONSE_BYTES, REMOTE_PROXY_BASE64_CHUNK_CHARS } from '../src/services/remoteProxyTransfer.js';

test('small JPEG responses use the original single result endpoint', () => {
  const body = randomBytes(90_000);
  const parts = encodeRemoteProxyResult('a'.repeat(32), 200, 'image/jpeg', body);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].kind, 'result');
  assert.deepEqual(Buffer.from(parts[0].payload.data, 'base64'), body);
});
test('multi-megabyte HLS segments are chunked, ordered and lossless', () => {
  const body = randomBytes(REMOTE_PROXY_MAX_RESPONSE_BYTES);
  const parts = encodeRemoteProxyResult('b'.repeat(32), 200, 'video/mp2t', body);
  assert.ok(parts.length >= 2 && parts.length <= 64);
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    assert.equal(part.kind, 'result-chunk');
    assert.equal(part.payload.part, index);
    assert.equal(part.payload.total, parts.length);
    assert.ok(part.payload.data.length <= REMOTE_PROXY_BASE64_CHUNK_CHARS);
    assert.equal(part.payload.data.length % 4, 0);
  }
  assert.deepEqual(Buffer.from(parts.map((part) => part.payload.data).join(''), 'base64'), body);
});
test('huge segments fail with a bounded response instead of hanging the tunnel', () => {
  assert.throws(() => encodeRemoteProxyResult('c'.repeat(32), 200, 'video/mp2t', Buffer.alloc(REMOTE_PROXY_MAX_RESPONSE_BYTES + 1)), /RESPONSE_TOO_LARGE/);
});
test('the live cloud agent reports failures and retains the stable server identity', () => {
  const source = readFileSync(new URL('../src/services/RemoteProxyService.js', import.meta.url), 'utf8');
  assert.match(source, /encodeRemoteProxyResult\(job\.id, code, type, data\)/);
  assert.match(source, /postPortal\(upload\.kind, identity, upload\.payload/);
  assert.match(source, /CLOUD_MEDIA_RESULT_FAILED/);
  assert.match(source, /readSetting\(ID_KEY\)/);
  assert.match(source, /signal: AbortSignal\.timeout\(25_000\)/);
});
