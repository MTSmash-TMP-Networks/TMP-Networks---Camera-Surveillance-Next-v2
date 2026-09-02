import { describe, expect, it } from 'vitest';
import {
  availableMediaServices,
  media2Protocol,
  profilesForService,
  snapshotUriForService,
  streamUriForService,
} from '../src/services/onvif/mediaSoap.js';

function mockCamera(handler) {
  return {
    uri: { media: { path: '/media' }, media2: { path: '/media2' } },
    _envelopeHeader: () => '<Envelope><Body>',
    _envelopeFooter: () => '</Body></Envelope>',
    _request(options, callback) {
      try { handler(options, callback); } catch (error) { callback(error); }
    },
  };
}

describe('dienstspezifische ONVIF-Medienabfragen', () => {
  it('liest Media2-Profile und ergaenzt H.265-Metadaten ueber den Encoder-Token', async () => {
    const requests = [];
    const cam = mockCamera(({ service, body }, callback) => {
      requests.push({ service, body });
      if (body.includes('GetVideoEncoderConfigurations')) {
        callback(null, [{ getVideoEncoderConfigurationsResponse: [{ configurations: [{
          $: { token: 'enc-h265', Encoding: 'H265', Profile: 'Main' },
          resolution: [{ $: { Width: '2560', Height: '1440' } }],
        }] }] }]);
        return;
      }
      callback(null, [{ getProfilesResponse: [{ profiles: [{
        $: { token: 'profile-h265' },
        name: ['HEVC Main'],
        configurations: [{ videoEncoder: [{ $: { token: 'enc-h265' } }] }],
      }] }] }]);
    });

    const profiles = await profilesForService(cam, 'media2');
    expect(requests.every((request) => request.service === 'media2')).toBe(true);
    expect(requests[0].body).toContain('<Type>All</Type>');
    expect(profiles).toEqual([expect.objectContaining({
      token: 'profile-h265',
      videoCodec: 'H265',
      videoProfile: 'Main',
      width: 2560,
      height: 1440,
      mediaService: 'media2',
    })]);
  });

  it('fragt Media2-Stream und Snapshot mit dem Profil-Token ueber Media2 ab', async () => {
    const requests = [];
    const cam = mockCamera(({ service, body }, callback) => {
      requests.push({ service, body });
      if (body.includes('GetStreamUri')) {
        callback(null, [{ getStreamUriResponse: [{ uri: [{ _: 'rtsp://192.0.2.8/hevc' }] }] }]);
        return;
      }
      callback(null, [{ getSnapshotUriResponse: [{ uri: ['http://192.0.2.8/hevc.jpg'] }] }]);
    });

    expect(await streamUriForService(cam, 'media2', 'profile&h265', 'TCP')).toBe('rtsp://192.0.2.8/hevc');
    expect(await snapshotUriForService(cam, 'media2', 'profile&h265')).toBe('http://192.0.2.8/hevc.jpg');
    expect(requests.every((request) => request.service === 'media2')).toBe(true);
    expect(requests[0].body).toContain('<Protocol>RTSP</Protocol>');
    expect(requests[0].body).toContain('<ProfileToken>profile&amp;h265</ProfileToken>');
  });

  it('kennt vorhandene Dienste und Media2-Transportabbildungen', () => {
    expect(availableMediaServices({ uri: { media2: {} } })).toEqual(['media2']);
    expect(media2Protocol('TCP')).toBe('RTSP');
    expect(media2Protocol('HTTP')).toBe('RtspOverHttp');
    expect(media2Protocol('UDP')).toBe('RtspUnicast');
  });
});
