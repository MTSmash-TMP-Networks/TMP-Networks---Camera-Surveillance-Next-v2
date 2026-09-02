import { describe, expect, it } from 'vitest';
import { buildCatalogCandidates, cameraFingerprint, rankCatalogFamilies } from '../src/services/media/CameraPathCatalog.js';

function camera({ manufacturer = 'Hikvision', model = 'DS-2CD2043G2-I', ip = '192.0.2.10', port = 80 } = {}) {
  return {
    name: 'Testkamera',
    onvif: { ip, port },
    capabilities: { device: { manufacturer, model, firmwareVersion: 'V5.7.1', hardwareId: 'HW-1' } },
  };
}

describe('Hersteller- und Modellpfadkatalog', () => {
  it('erkennt Bindestrichmodelle anhand Hersteller und Modellfamilie', () => {
    const fingerprint = cameraFingerprint(camera());
    expect(fingerprint.modelSearch).toBe('ds-2cd2043g2-i');
    expect(rankCatalogFamilies(fingerprint)[0]).toMatchObject({
      family: { id: 'hikvision-family' },
      manufacturerMatch: true,
      modelMatch: true,
    });
  });

  it('liefert modelltypische Haupt- und Substream-Pfade vor generischen Pfaden', () => {
    const result = buildCatalogCandidates(camera(), { openPorts: [554], maxCandidates: 20 });
    expect(result.candidates[0].url).toBe('rtsp://192.0.2.10:554/Streaming/Channels/101');
    expect(result.candidates.some((item) => item.url.endsWith('/Streaming/Channels/102'))).toBe(true);
    expect(result.catalogMatches[0]).toMatchObject({ id: 'hikvision-family', matchedBy: 'Hersteller und Modell' });
  });

  it('verwendet auf Port 443 HTTPS statt HTTP', () => {
    const result = buildCatalogCandidates(camera({ manufacturer: 'Axis', model: 'M2035-LE' }), { openPorts: [443], maxCandidates: 30 });
    const webCandidates = result.candidates.filter((item) => ['mjpeg', 'snapshot', 'http', 'hls'].includes(item.kind));
    expect(webCandidates.length).toBeGreaterThan(0);
    expect(webCandidates.every((item) => item.url.startsWith('https://'))).toBe(true);
    expect(webCandidates.some((item) => item.url.startsWith('http://') && item.url.includes(':443'))).toBe(false);
  });

  it('gibt keine Zugangsdaten in erzeugten URLs aus', () => {
    const result = buildCatalogCandidates(camera(), { openPorts: [554] });
    expect(result.candidates.every((item) => !item.url.includes('@') && !item.url.includes('password'))).toBe(true);
  });
});

describe('Synology-Kamerapfade', () => {
  it('kennt die offiziell dokumentierten nummerierten Streams', () => {
    const result = buildCatalogCandidates(camera({ manufacturer: 'Synology', model: 'BC500' }), { openPorts: [554], maxCandidates: 10 });
    expect(result.candidates.slice(0, 2).map((item) => item.url)).toEqual([
      'rtsp://192.0.2.10:554/1',
      'rtsp://192.0.2.10:554/2',
    ]);
    expect(result.catalogMatches[0]).toMatchObject({ id: 'synology-camera-family', matchedBy: 'Hersteller und Modell' });
  });
});
