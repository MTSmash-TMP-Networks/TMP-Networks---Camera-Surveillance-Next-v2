import test from 'node:test';
import assert from 'node:assert/strict';
import { Go2RtcClient } from '../src/services/media/Go2RtcClient.js';

function okJson(payload) {
  return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
}


test('go2rtc MPEG-TS URL uses the same cached base_path as the Control API', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => okJson({ version: '1.9.14' });
  try {
    const client = new Go2RtcClient({ baseUrl: 'http://go2rtc:1984/media/go2rtc', fallbackUrls: [] });
    await client.info();
    assert.equal(
      client.streamTsUrl('cam video'),
      'http://go2rtc:1984/media/go2rtc/api/stream.ts?src=cam+video',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('go2rtc control API uses configured base_path directly and caches it', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return okJson({ version: '1.9.14' });
  };
  try {
    const client = new Go2RtcClient({ baseUrl: 'http://go2rtc:1984/media/go2rtc', fallbackUrls: [] });
    await client.info();
    await client.paths();
    assert.deepEqual(calls, [
      'http://go2rtc:1984/media/go2rtc/api',
      'http://go2rtc:1984/media/go2rtc/api/streams',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('legacy root endpoint probes base_path first and remembers the working endpoint', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('http://go2rtc:1984/media/go2rtc/')) return okJson({ version: '1.9.14' });
    return { ok: false, status: 404, text: async () => '404 page not found' };
  };
  try {
    const client = new Go2RtcClient({ baseUrl: 'http://go2rtc:1984', fallbackUrls: [] });
    await client.info();
    await client.paths();
    assert.deepEqual(calls, [
      'http://go2rtc:1984/media/go2rtc/api',
      'http://go2rtc:1984/media/go2rtc/api/streams',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('speculative 404 does not hide the configured endpoint connection failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/media/go2rtc/')) {
      const error = new TypeError('fetch failed');
      error.cause = { code: 'ECONNREFUSED', address: 'go2rtc', port: 1984 };
      throw error;
    }
    return { ok: false, status: 404, text: async () => '404 page not found' };
  };
  try {
    const client = new Go2RtcClient({ baseUrl: 'http://go2rtc:1984', fallbackUrls: [] });
    await assert.rejects(client.fetchResponse('/api', {}, { timeoutMs: 50 }), /ECONNREFUSED/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
