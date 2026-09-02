import { describe, expect, it } from 'vitest';
import { chooseProfiles, rankProfiles } from '../src/services/onvif/profileRanker.js';

describe('ONVIF-Profilranking', () => {
  const ranked = rankProfiles([
    { token: 'main', name: 'MainStreamProfile', videoCodec: 'H264', width: 2560, height: 1440 },
    { token: 'sub', name: 'SecondStreamProfile', videoCodec: 'H264', width: 640, height: 360 },
    { token: 'hevc', name: 'Alternative', videoCodec: 'H265', width: 1920, height: 1080 },
  ]);
  it('erkennt Haupt- und Nebenstream', () => {
    expect(ranked.find((p) => p.token === 'main').role).toBe('high');
    expect(ranked.find((p) => p.token === 'sub').role).toBe('low');
  });
  it('bevorzugt bei kleinen Kacheln den Nebenstream', () => {
    expect(chooseProfiles(ranked, 'auto', 480)[0].token).toBe('sub');
  });
  it('bevorzugt H.264 vor H.265 bei automatischer Auswahl', () => {
    expect(ranked[0].videoCodec).toBe('H264');
  });
  it('priorisiert H.265, wenn die Kamera entsprechend konfiguriert ist', () => {
    expect(chooseProfiles(ranked, 'high', 1920, 'h265')[0].token).toBe('hevc');
  });
  it('faellt bei fehlendem Wunschcodec auf andere Profile zurueck', () => {
    const onlyH264 = ranked.filter((profile) => profile.videoCodec === 'H264');
    expect(chooseProfiles(onlyH264, 'high', 1920, 'h265')).toHaveLength(2);
  });
});
