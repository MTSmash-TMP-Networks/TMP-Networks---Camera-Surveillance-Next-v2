import { describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createUpdaterClient } from '../src/services/updater/UpdaterClient.js';
import { resolveUpdaterEndpoints } from '../src/services/updater/UpdaterEndpointResolver.js';

function settings(overrides = {}) {
  return {
    updaterUrls: [], updaterUrl: '', updaterServiceProtocol: 'http', updaterServiceName: 'updater', updaterServicePort: 3010,
    updaterServiceBasePath: '', updaterFallbackUrls: [], updaterFallbackUrl: '', updaterToken: 'x'.repeat(48),
    updaterHealthTimeoutMs: 1000, updaterRequestTimeoutMs: 1000, updaterHealthRetries: 1, updaterRequestRetries: 1,
    updaterRetryDelayMs: 0, ...overrides,
  };
}

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('UpdaterEndpointResolver', () => {
  it('priorisiert explizite URLs, Service Discovery und danach Fallbacks', () => {
    const result = resolveUpdaterEndpoints(settings({
      updaterUrls: ['https://updates.internal/base'],
      updaterFallbackUrls: ['http://host.docker.internal:3010'],
    }));
    expect(result.endpoints.map((item) => item.source)).toEqual(['configured', 'service-discovery', 'fallback']);
    expect(result.endpoints[1].baseUrl).toBe('http://updater:3010');
  });

  it('verwirft unsichere Protokolle und Zugangsdaten in URLs', () => {
    const result = resolveUpdaterEndpoints(settings({ updaterUrls: ['file:///tmp/updater', 'http://user:secret@updater:3010'], updaterServiceName: '' }));
    expect(result.endpoints).toHaveLength(0);
    expect(result.issues).toHaveLength(2);
    expect(JSON.stringify(result.issues)).not.toContain('secret');
  });

  it('verwirft Service-Namen mit Pfaden oder URL-Steuerzeichen', () => {
    const result = resolveUpdaterEndpoints(settings({ updaterServiceName: 'updater/internal' }));
    expect(result.endpoints).toHaveLength(0);
    expect(result.issues[0].code).toBe('UPDATER_CONFIGURATION_INVALID');
  });
});

describe('UpdaterClient', () => {

  it('bevorzugt den lokalen Unix-IPC-Kanal und benötigt dafür kein Docker-DNS', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tmp-camera-updater-ipc-'));
    const socketPath = path.join(dir, 'updater.sock');
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ service: 'tmp-camera-updater', status: 'ok', installReady: true, busy: false, version: '2.20.16' }));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    const fetchImpl = vi.fn(() => { throw new Error('TCP fallback must not be used'); });
    try {
      const client = createUpdaterClient({ settings: settings({ updaterSocketPath: socketPath }), log: logger(), fetchImpl, wait: vi.fn() });
      const result = await client.health({ requestId: 'ipc-health-test-1234' });
      expect(result.status).toBe('ok');
      expect(result.version).toBe('2.20.16');
      expect(result.connection.source).toBe('local-ipc');
      expect(result.connection.method).toBe('Lokaler IPC-Kanal');
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('liefert bei DNS-Fehlern eine sichere Diagnose ohne interne URL oder Rohfehler', async () => {
    const fetchError = new TypeError('fetch failed at http://updater:3010');
    fetchError.cause = { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND updater' };
    const client = createUpdaterClient({ settings: settings(), log: logger(), fetchImpl: vi.fn().mockRejectedValue(fetchError), wait: vi.fn() });
    const result = await client.health({ requestId: 'test-request-1234' });
    expect(result.status).toBe('offline');
    expect(result.diagnosticId).toBe('test-request-1234');
    expect(result.attempts[0].code).toBe('UPDATER_DNS_ERROR');
    expect(JSON.stringify(result)).not.toContain('http://updater:3010');
    expect(JSON.stringify(result)).not.toContain('fetch failed');
  });

  it('wiederholt einen vorübergehenden Health-Fehler und akzeptiert danach den Dienst', async () => {
    const fetchError = new TypeError('temporär');
    fetchError.cause = { code: 'ECONNREFUSED' };
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(fetchError)
      .mockResolvedValueOnce(new Response(JSON.stringify({ service: 'tmp-camera-updater', status: 'ok', installReady: true, busy: false, version: '2.8.3' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const client = createUpdaterClient({ settings: settings(), log: logger(), fetchImpl, wait: vi.fn() });
    const result = await client.health();
    expect(result.status).toBe('ok');
    expect(result.connection.method).toBe('Interne Service Discovery');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('unterscheidet einen erreichbaren, aber eingeschränkten Dienst von offline', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      service: 'tmp-camera-updater', status: 'degraded', installReady: false, busy: false,
      issueCodes: ['DOCKER_SOCKET_UNAVAILABLE'], version: '2.8.3',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const client = createUpdaterClient({ settings: settings(), log: logger(), fetchImpl, wait: vi.fn() });
    const result = await client.health({ requestId: 'degraded-test-123' });
    expect(result.reachable).toBe(true);
    expect(result.installReady).toBe(false);
    expect(result.status).toBe('degraded');
    expect(result.issueCodes).toContain('DOCKER_SOCKET_UNAVAILABLE');
  });



  it('gibt einen erreichbaren, aber nicht installierbereiten Dienst als spezifischen Fehler zurück', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      service: 'tmp-camera-updater', error: 'UPDATER_NOT_READY', issueCodes: ['DOCKER_SOCKET_UNAVAILABLE'], diagnosticId: 'not-ready-test-1234',
    }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    const client = createUpdaterClient({ settings: settings(), log: logger(), fetchImpl, wait: vi.fn() });
    await expect(client.post('/install', { packageId: 'package' }, { requestId: 'install-request-5678' })).rejects.toMatchObject({
      code: 'UPDATER_NOT_READY',
      details: { diagnosticId: 'not-ready-test-1234', issueCodes: ['DOCKER_SOCKET_UNAVAILABLE'] },
    });
  });

  it('akzeptiert keine erfolgreiche Antwort eines fremden HTTP-Dienstes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { 'Content-Type': 'application/json' } }));
    const client = createUpdaterClient({ settings: settings({ updaterRequestRetries: 0 }), log: logger(), fetchImpl, wait: vi.fn() });
    await expect(client.post('/install', { packageId: 'package' }, { requestId: 'foreign-service-1234' })).rejects.toMatchObject({ code: 'UPDATER_UNAVAILABLE' });
  });

  it('liest den authentifizierten Containerstatus per GET', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      service: 'tmp-camera-updater', status: 'ok', summary: { total: 4, running: 4 }, items: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const client = createUpdaterClient({ settings: settings(), log: logger(), fetchImpl, wait: vi.fn() });
    const result = await client.get('/runtime/containers', { requestId: 'container-status-1234' });
    expect(result.status).toBe('ok');
    expect(result.summary.running).toBe(4);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://updater:3010/runtime/containers');
    const options = fetchImpl.mock.calls[0][1];
    expect(options.method).toBe('GET');
    expect(options.headers['X-Updater-Request-ID']).toBe('container-status-1234');
    expect(options.headers['X-Updater-Token']).toBe('x'.repeat(48));
  });

  it('übermittelt für POST-Wiederholungen dieselbe idempotente Diagnose-ID', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ service: 'tmp-camera-updater', accepted: true, diagnosticId: 'install-request-1234' }), { status: 202, headers: { 'Content-Type': 'application/json' } }));
    const client = createUpdaterClient({ settings: settings(), log: logger(), fetchImpl, wait: vi.fn() });
    const result = await client.post('/install', { packageId: 'package' }, { requestId: 'install-request-1234' });
    expect(result.accepted).toBe(true);
    const options = fetchImpl.mock.calls[0][1];
    expect(options.headers['X-Updater-Request-ID']).toBe('install-request-1234');
    expect(options.headers['X-Updater-Token']).toBe('x'.repeat(48));
  });
});
