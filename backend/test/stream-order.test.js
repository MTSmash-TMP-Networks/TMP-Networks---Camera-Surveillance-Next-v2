import { describe, expect, it } from 'vitest';
import { prioritizeRequestedSource, streamOrchestrator } from '../src/services/media/StreamOrchestrator.js';

describe('Stream-Fallbackreihenfolge', () => {
  it('prueft alle TCP-Profile vor HTTP und UDP', async () => {
    const profiles = [
      { token: 'main', name: 'Main', role: 'high', rank: 0 },
      { token: 'sub', name: 'Second', role: 'low', rank: 1 },
    ];
    const onvif = {
      streamCandidates: async (token) => [
        { uri: `rtsp://camera/${token}`, transport: 'tcp' },
        { uri: `rtsp://camera/${token}?tunnel=1`, transport: 'http' },
        { uri: `rtsp://camera/${token}?udp=1`, transport: 'udp' },
      ],
    };
    const attempts = await streamOrchestrator.orderedAttempts(onvif, profiles, { quality: 'high', requestedProfileToken: null }, 1920, []);
    expect(attempts.map((item) => `${item.profile.token}:${item.candidate.transport}`)).toEqual([
      'main:tcp', 'sub:tcp', 'main:http', 'sub:http', 'main:udp', 'sub:udp',
    ]);
  });

  it('setzt eine manuell ausgewaehlte alternative Quelle vor alle Fallbacks', () => {
    const attempts = [
      { candidate: { sourceId: null, transport: 'tcp' } },
      { candidate: { sourceId: 7, transport: 'tcp' } },
      { candidate: { sourceId: 4, transport: 'hls' } },
    ];
    expect(prioritizeRequestedSource(attempts, 'source:7')[0].candidate.sourceId).toBe(7);
  });
});
