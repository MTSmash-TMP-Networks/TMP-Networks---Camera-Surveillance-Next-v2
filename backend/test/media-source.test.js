import { describe, expect, it } from 'vitest';
import { inferMediaSourceKind, normalizeMediaSourceUrl } from '../src/services/media/MediaSource.js';
import { buildDiscoveryCandidates, buildServiceTargets, manualStreamAttempts, normalizeMediaSources, sortMediaAttempts, summarizeServices } from '../src/services/media/MediaSourceService.js';

describe('Alternative Medienquellen', () => {
  it('erkennt HLS, MJPEG, RTSP, RTMP und SRT', () => {
    expect(inferMediaSourceKind('http://192.0.2.10/live.m3u8')).toBe('hls');
    expect(inferMediaSourceKind('http://192.0.2.10/video.mjpg')).toBe('mjpeg');
    expect(inferMediaSourceKind('rtsp://192.0.2.10/live')).toBe('rtsp');
    expect(inferMediaSourceKind('rtmp://192.0.2.10/live/cam')).toBe('rtmp');
    expect(inferMediaSourceKind('srt://192.0.2.10:9000')).toBe('srt');
  });

  it('entfernt Zugangsdaten und begrenzt Quellen auf die Kamera-IP', () => {
    expect(normalizeMediaSourceUrl('http://user:pass@192.0.2.10/live.m3u8', '192.0.2.10')).toBe('http://192.0.2.10/live.m3u8');
    expect(() => normalizeMediaSourceUrl('http://198.51.100.20/live.m3u8', '192.0.2.10')).toThrow(/Kamera-IP/);
  });

  it('expandiert RTSP in TCP, HTTP-Tunnel und UDP und laesst Snapshots aus der Videopipeline', () => {
    const sources = normalizeMediaSources([
      { label: 'RTSP', kind: 'rtsp', url: 'rtsp://192.0.2.10/live', priority: 10, enabled: true },
      { label: 'Standbild', kind: 'snapshot', url: 'http://192.0.2.10/snapshot.jpg', priority: 20, enabled: true },
    ], '192.0.2.10');
    const attempts = manualStreamAttempts(sources);
    expect(attempts.map((attempt) => attempt.candidate.transport)).toEqual(['tcp', 'http', 'udp']);
    expect(attempts.every((attempt) => attempt.candidate.sourceType === 'rtsp')).toBe(true);
  });

  it('bevorzugt im stabilen Modus HLS vor RTSP', () => {
    const attempts = [
      { profileIndex: 0, candidate: { sourceType: 'rtsp', transport: 'tcp', priority: 0 } },
      { profileIndex: 1, candidate: { sourceType: 'hls', transport: 'hls', priority: 10 } },
    ];
    expect(sortMediaAttempts(attempts, 'stable')[0].candidate.sourceType).toBe('hls');
    expect(sortMediaAttempts(attempts, 'low-latency')[0].candidate.sourceType).toBe('rtsp');
  });

  it('bevorzugt eine bekannte funktionierende Quelle und verschiebt Fehler nach hinten', () => {
    const attempts = [
      { profileIndex: 0, candidate: { sourceType: 'rtsp', transport: 'tcp', priority: 0, healthRank: 2 } },
      { profileIndex: 1, candidate: { sourceType: 'hls', transport: 'hls', priority: 50, healthRank: 0 } },
      { profileIndex: 2, candidate: { sourceType: 'http', transport: 'http', priority: 20, healthRank: 1 } },
    ];
    expect(sortMediaAttempts(attempts, 'auto').map((item) => item.candidate.sourceType)).toEqual(['hls', 'http', 'rtsp']);
  });


  it('erkennt RTMP-Port 1935 auch dann als Dienst, wenn kein Standardpfad bestätigt wurde', () => {
    const camera = { onvif: { ip: '192.0.2.10', port: 80 } };
    const targets = buildServiceTargets(camera);
    const services = summarizeServices(targets, [
      { port: 80, open: true },
      { port: 554, open: true },
      { port: 1935, open: true },
    ], []);
    expect(services.find((item) => item.protocol === 'http' && item.port === 80)).toMatchObject({ reachable: true, status: 'service-only' });
    expect(services.find((item) => item.protocol === 'rtmp' && item.port === 1935)).toMatchObject({ reachable: true, status: 'service-only' });
  });

  it('zeigt einen protokollseitig bestätigten RTSP-Pfad getrennt von einem vollständig nutzbaren Stream', () => {
    const camera = { onvif: { ip: '192.0.2.10', port: 80 } };
    const targets = buildServiceTargets(camera);
    const services = summarizeServices(targets, [{ port: 554, open: true }], [
      { url: 'rtsp://192.0.2.10:554/11', lastStatus: 'path-confirmed' },
    ]);
    expect(services.find((item) => item.protocol === 'rtsp' && item.port === 554)).toMatchObject({
      status: 'path-confirmed', pathConfirmed: true, streamFound: false, confirmedCount: 1,
    });
  });

  it('erzeugt RTMP-Kandidaten nur auf einem erreichbaren RTMP-Port', () => {
    const camera = { onvif: { ip: '192.0.2.10', port: 80 } };
    const candidates = buildDiscoveryCandidates(camera, [1935]);
    expect(candidates.some((item) => item.url.startsWith('rtmp://192.0.2.10:1935/'))).toBe(true);
    expect(candidates.some((item) => item.url.startsWith('http://'))).toBe(false);
  });

  it('sucht Medienpfade nur auf erreichbaren Web- und RTSP-Ports', () => {
    const camera = { onvif: { ip: '192.0.2.10', port: 8899 } };
    const candidates = buildDiscoveryCandidates(camera, [80, 443, 554]);
    expect(candidates.some((item) => item.url.startsWith('http://192.0.2.10:80/'))).toBe(true);
    expect(candidates.some((item) => item.url.startsWith('https://192.0.2.10:443/'))).toBe(true);
    expect(candidates.some((item) => item.url.startsWith('rtsp://192.0.2.10:554/'))).toBe(true);
    expect(candidates.some((item) => item.url.includes(':8899/'))).toBe(false);
  });
});
