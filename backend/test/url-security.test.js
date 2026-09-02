import { describe, expect, it } from 'vitest';
import { cameraMediaUriCandidates, injectCredentials, normalizeCameraUri, safeMediaEndpoint } from '../src/utils/url.js';

describe('Medien-URI-Sicherheit', () => {
  it('ersetzt eingebettete Zugangsdaten durch die gespeicherten ONVIF-Daten', () => {
    const uri = injectCredentials('rtsp://foreign:secret@192.0.2.10/live', 'camera-user', 'camera-pass');
    const parsed = new URL(uri);
    expect(parsed.username).toBe('camera-user');
    expect(parsed.password).toBe('camera-pass');
  });

  it('entfernt fremde eingebettete Zugangsdaten wenn keine gespeichert sind', () => {
    const parsed = new URL(injectCredentials('rtsp://foreign:secret@192.0.2.10/live', '', ''));
    expect(parsed.username).toBe('');
    expect(parsed.password).toBe('');
  });

  it('akzeptiert nur Kamera-Medienprotokolle und korrigiert Platzhalter-Hosts', () => {
    expect(normalizeCameraUri('rtsp://0.0.0.0/live', '192.0.2.10')).toContain('192.0.2.10');
    expect(() => normalizeCameraUri('file:///etc/passwd', '192.0.2.10')).toThrow('Nicht erlaubtes Medienprotokoll');
  });

  it('erzwingt fuer ONVIF-Medienadressen die gespeicherte Kamera-IP', () => {
    const normalized = normalizeCameraUri('rtsp://alte-kamera.local:8554/live', '192.0.2.25');
    const parsed = new URL(normalized);
    expect(parsed.hostname).toBe('192.0.2.25');
    expect(parsed.port).toBe('8554');
  });

  it('erzeugt bei einem auffaelligen RTSP-Port einen sicheren Port-554-Fallback', () => {
    const candidates = cameraMediaUriCandidates('rtsp://interner-host:80/Streaming/Channels/101', '192.0.2.25', 'TCP');
    expect(candidates.map((item) => new URL(item.uri).host)).toEqual([
      '192.0.2.25:80',
      '192.0.2.25:554',
    ]);
    expect(candidates[1].reason).toBe('rtsp-standard-port-fallback');
  });

  it('protokolliert Medienendpunkte ohne Zugangsdaten', () => {
    expect(safeMediaEndpoint('rtsp://user:secret@192.0.2.25:554/live?channel=1')).toEqual({
      scheme: 'rtsp', host: '192.0.2.25', port: '554', path: '/live', queryKeys: ['channel'],
    });
  });


  it('wandelt eine faelschlich als HTTP gemeldete Medienadresse in einen echten RTSP-Fallback um', () => {
    const candidates = cameraMediaUriCandidates('http://camera-intern:80/Streaming/Channels/101?token=secret', '192.0.2.25', 'TCP');
    expect(candidates.map((item) => item.uri)).toEqual([
      'http://192.0.2.25/Streaming/Channels/101?token=secret',
      'rtsp://192.0.2.25:554/Streaming/Channels/101?token=secret',
    ]);
  });

});
