import { describe, expect, it } from 'vitest';
import { parseWebFingerprint } from '../src/services/media/CameraWebFingerprint.js';
import { buildDeepRtspCandidates } from '../src/services/media/DeepCameraPaths.js';

describe('Kamera-Weboberflächen-Fingerprint', () => {
  it('erkennt Hersteller und eingebettete Medienpfade', () => {
    const result = parseWebFingerprint({
      body: '<title>Hikvision Network Camera</title><script>const main="rtsp://192.0.2.10:554/Streaming/Channels/101"; const hls="/live/main.m3u8";</script>',
      headers: { server: 'webs' },
      baseUrl: 'http://192.0.2.10:80/',
      cameraIp: '192.0.2.10',
    });
    expect(result.manufacturerHint).toBe('hikvision');
    expect(result.candidates.some((item) => item.url === 'rtsp://192.0.2.10:554/Streaming/Channels/101')).toBe(true);
    expect(result.candidates.some((item) => item.url === 'http://192.0.2.10/live/main.m3u8' && item.kind === 'hls')).toBe(true);
  });

  it('ignoriert fremde Hosts und normale Web-Assets', () => {
    const result = parseWebFingerprint({
      body: '<script src="/app.js"></script><script>const x="rtsp://198.51.100.2/live";</script>',
      headers: {}, baseUrl: 'http://192.0.2.10/', cameraIp: '192.0.2.10',
    });
    expect(result.candidates).toHaveLength(0);
  });
});

describe('RTSP-Tiefensuche', () => {
  it('erzeugt OEM-, ONVIF- und Kanalpfade nur auf offenen RTSP-Ports', () => {
    const camera = { onvif: { ip: '192.0.2.10' } };
    const items = buildDeepRtspCandidates(camera, [80, 554], { aggressive: false });
    expect(items.some((item) => item.url === 'rtsp://192.0.2.10:554/11')).toBe(true);
    expect(items.some((item) => item.url.endsWith('/Streaming/Channels/101'))).toBe(true);
    expect(items.some((item) => item.url.includes(':80/') && item.probeTransport === 'http')).toBe(true);
    expect(items.every((item) => item.url.includes(':554/') || item.url.includes(':80/'))).toBe(true);
  });
});
