import { afterEach, describe, expect, it, vi } from 'vitest';
import { Go2RtcClient } from '../src/services/media/Go2RtcClient.js';

afterEach(() => vi.restoreAllMocks());

function okJson(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

describe('go2rtc-API', () => {

  it('baut den MPEG-TS-Medienpfad aus demselben gecachten base_path', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson({ version: '1.9.14' }));
    const client = new Go2RtcClient({ baseUrl: 'http://go2rtc:1984/media/go2rtc', fallbackUrls: [] });
    await client.info();
    expect(client.streamTsUrl('cam video')).toBe('http://go2rtc:1984/media/go2rtc/api/stream.ts?src=cam+video');
  });


  it('prüft Laufzeitpfade über die Liste und erzeugt keine erwartbaren 404-Abfragen', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson({ camera_one: { producers: [{ id: 'ffmpeg' }], tracks: ['H264'] } }));
    const client = new Go2RtcClient({ baseUrl: 'http://go2rtc:1984/media/go2rtc', fallbackUrls: [] });
    const result = await client.waitUntilAnyReady(['camera_one', 'camera_two'], { timeoutMs: 1000, intervalMs: 1 });
    expect(result.ready.camera_one).toBe(true);
    expect(result.ready.camera_two).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://go2rtc:1984/media/go2rtc/api/streams');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('src=camera_one');
  });

  it('verwendet bei konfiguriertem base_path direkt den präfixierten Control-Endpunkt', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson({ version: '1.9.14' }));
    const client = new Go2RtcClient({ baseUrl: 'http://go2rtc:1984/media/go2rtc', fallbackUrls: [] });
    await client.info();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://go2rtc:1984/media/go2rtc/api');
  });

  it('ermittelt bei einer alten unpräfixierten Konfiguration den base_path einmal und merkt ihn sich', async () => {
    const calls = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      calls.push(String(url));
      if (String(url).startsWith('http://go2rtc:1984/media/go2rtc/')) return okJson({ version: '1.9.14' });
      return { ok: false, status: 404, text: async () => '404 page not found' };
    });
    const client = new Go2RtcClient({ baseUrl: 'http://go2rtc:1984', fallbackUrls: [] });
    await client.info();
    await client.paths();
    expect(calls).toEqual([
      'http://go2rtc:1984/media/go2rtc/api',
      'http://go2rtc:1984/media/go2rtc/api/streams',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lässt einen spekulativen 404-Fallback keinen echten Verbindungsfehler überdecken', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/media/go2rtc/')) {
        const error = new TypeError('fetch failed');
        error.cause = { code: 'ECONNREFUSED', address: 'go2rtc', port: 1984 };
        throw error;
      }
      return { ok: false, status: 404, text: async () => '404 page not found' };
    });
    const client = new Go2RtcClient({ baseUrl: 'http://go2rtc:1984', fallbackUrls: [] });
    await expect(client.fetchResponse('/api', {}, { timeoutMs: 50 })).rejects.toThrow(/ECONNREFUSED/);
  });

  it('redigiert Kameraquellen in API-Fehlern, lässt den Control-Endpunkt aber sichtbar', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, text: async () => 'failed' });
    const client = new Go2RtcClient({ baseUrl: 'http://go2rtc:1984/media/go2rtc', fallbackUrls: [] });
    await expect(client.upsertStream('cam', 'rtsp://user:secret@192.168.1.10/stream')).rejects.toThrow(
      /url=http:\/\/go2rtc:1984\/media\/go2rtc\/api\/streams\?src=%5Bredacted-source%5D&name=cam/
    );
  });

  it('beendet die Wartephase sofort, wenn der Medienprozess bereits beendet ist', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const client = new Go2RtcClient({ baseUrl: 'http://go2rtc:1984/media/go2rtc', fallbackUrls: [] });
    const result = await client.waitUntilAnyReady(['missing'], { timeoutMs: 1000, isProcessAlive: () => false });
    expect(result.processExited).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
