import { describe, expect, it } from 'vitest';
import { classifyDiscoveredDevice } from '../src/services/onvif/OnvifClient.js';

describe('ONVIF-Kamerafilter', () => {
  it('erkennt Video-Encoder als Kamera', () => {
    const result = classifyDiscoveredDevice({
      hostname: '192.0.2.10', port: 80, name: 'Eingang',
      scopes: ['onvif://www.onvif.org/type/video_encoder'],
      uri: { device: 'http://192.0.2.10/onvif/device_service' },
    });
    expect(result.likelyCamera).toBe(true);
    expect(result.device.verified).toBe(true);
  });

  it('filtert Drucker und allgemeine WS-Discovery-Geraete aus', () => {
    const result = classifyDiscoveredDevice({
      hostname: '192.0.2.20', port: 80, name: 'Office Printer',
      scopes: ['wsdp:Device Printer'],
      uri: { device: 'http://192.0.2.20/wsd/device' },
    });
    expect(result.likelyCamera).toBe(false);
  });

  it('ordnet einen allgemeinen ONVIF Device Service ohne Videosignal nur als unbestaetigt ein', () => {
    const result = classifyDiscoveredDevice({
      hostname: '192.0.2.30', port: 8899,
      uri: { device: 'http://192.0.2.30:8899/onvif/device_service' },
    });
    expect(result.likelyCamera).toBe(false);
    expect(result.device.evidence).toContain('Device Service');
  });
});
