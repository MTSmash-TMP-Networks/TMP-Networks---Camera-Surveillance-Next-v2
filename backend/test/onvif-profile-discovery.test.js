import { describe, expect, it } from 'vitest';
import {
  mediaServiceCandidates,
  mergeOnvifProfiles,
  profilesFromSoap,
} from '../src/services/onvif/profileDiscovery.js';

function media1Response(profiles) {
  return [{ getProfilesResponse: [{ profiles }] }];
}

function media2Response(profiles) {
  return [{ getProfilesResponse: [{ profiles }] }];
}

function encoderResponse(configurations) {
  return [{ getVideoEncoderConfigurationsResponse: [{ configurations }] }];
}

describe('vollstaendige ONVIF-Profilermittlung', () => {
  it('behaelt alle unterschiedlichen Media1- und Media2-Profile einschliesslich H.265', () => {
    const media1 = profilesFromSoap(media1Response([
      {
        $: { token: 'MainStreamProfileToken' },
        name: ['MainStreamProfile'],
        videoEncoderConfiguration: [{
          $: { token: 'H264MainEncoder' },
          encoding: ['H264'],
          resolution: [{ width: ['1920'], height: ['1080'] }],
          H264: [{ H264Profile: ['Main'] }],
        }],
      },
      {
        $: { token: 'SecondStreamProfileToken' },
        name: ['SecondStreamProfile'],
        videoEncoderConfiguration: [{
          $: { token: 'H264SubEncoder' },
          encoding: ['H264'],
          resolution: [{ width: ['640'], height: ['352'] }],
          H264: [{ H264Profile: ['Main'] }],
        }],
      },
    ]), 'media');

    const media2 = profilesFromSoap(media2Response([
      {
        $: { token: 'H265MainProfileToken' },
        name: ['H265MainProfile'],
        configurations: [{ videoEncoder: [{ $: { token: 'H265MainEncoder' } }] }],
      },
    ]), 'media2', encoderResponse([
      {
        $: { token: 'H265MainEncoder', Encoding: 'H265', Profile: 'Main', GovLength: '50' },
        resolution: [{ $: { Width: '2688', Height: '1520' } }],
        rateControl: [{ $: { FrameRateLimit: '25', BitrateLimit: '4096' } }],
      },
    ]));

    const merged = mergeOnvifProfiles(media1, media2);
    expect(merged.map((profile) => profile.token)).toEqual([
      'MainStreamProfileToken',
      'SecondStreamProfileToken',
      'H265MainProfileToken',
    ]);
    expect(merged.at(-1)).toMatchObject({
      videoCodec: 'H265',
      videoProfile: 'Main',
      width: 2688,
      height: 1520,
      fps: 25,
      bitrate: 4096,
      mediaService: 'media2',
    });
  });

  it('akzeptiert singulaere Herstellerfelder und fuehrt unterschiedlich geschriebene Encoderobjekte zusammen', () => {
    const profiles = profilesFromSoap(
      [{ GetProfilesResponse: [{ Profile: [{
        $: { Token: 'vendor-hevc' },
        Name: ['Vendor HEVC'],
        Configurations: [{ VideoEncoder: [{
          $: { Token: 'vendor-encoder' },
          Resolution: [{ $: { Width: '2304' } }],
        }] }],
      }] }] }],
      'media2',
      [{ GetVideoEncoderConfigurationResponse: [{ Configuration: [{
        $: { Token: 'vendor-encoder', Encoding: 'HEVC', Profile: 'Main10' },
        resolution: [{ $: { Width: '1920', Height: '1296' } }],
      }] }] }],
    );

    expect(profiles).toEqual([expect.objectContaining({
      token: 'vendor-hevc',
      videoCodec: 'H265',
      videoProfile: 'Main 10',
      width: 2304,
      height: 1296,
      mediaService: 'media2',
    })]);
  });

  it('entfernt nur echte Token-Duplikate und nicht Profile mit gleicher Aufloesung', () => {
    const merged = mergeOnvifProfiles(
      [{ token: 'h264-token', name: 'Main', videoCodec: 'H264', width: 1920, height: 1080, mediaService: 'media' }],
      [{ token: 'h265-token', name: 'Main', videoCodec: 'H265', width: 1920, height: 1080, mediaService: 'media2' }],
    );
    expect(merged).toHaveLength(2);
  });

  it('fuehrt dasselbe Profil aus beiden Diensten zusammen und bevorzugt vollstaendige Media2-Metadaten', () => {
    const merged = mergeOnvifProfiles(
      [{ token: 'shared', name: 'Main', videoCodec: 'H264', width: 1920, height: 1080, hasPtz: true, mediaService: 'media' }],
      [{ token: 'shared', name: 'Main HEVC', videoCodec: 'H265', videoProfile: 'Main 10', width: 3840, height: 2160, mediaService: 'media2' }],
    );
    expect(merged).toEqual([expect.objectContaining({
      token: 'shared',
      videoCodec: 'H265',
      videoProfile: 'Main 10',
      width: 3840,
      height: 2160,
      hasPtz: true,
      mediaService: 'both',
    })]);
  });

  it('ordnet Stream- und Snapshot-Anfragen zuerst dem Herkunftsdienst zu', () => {
    expect(mediaServiceCandidates('media2', false)).toEqual(['media2', 'media']);
    expect(mediaServiceCandidates('media', true)).toEqual(['media', 'media2']);
    expect(mediaServiceCandidates('auto', true)).toEqual(['media2', 'media']);
  });
});
