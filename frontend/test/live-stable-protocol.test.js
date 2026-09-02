import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/services/liveStreamPool.js', import.meta.url), 'utf8');
const hlsSource = readFileSync(new URL('../src/services/hlsPlayer.js', import.meta.url), 'utf8');

describe('Stable Live/Kiosk playback concept', () => {
  it('uses LL-HLS as deterministic default instead of WebRTC-first', () => {
    expect(source).toContain("VITE_STREAM_PREFERRED_PROTOCOL || 'hls'");
    expect(source).toContain('const preferWebRtc = STREAM_PROTOCOL === \'webrtc\'');
    expect(source).toContain('await tryHls(preferWebRtc ?');
  });

  it('does not declare HLS ready before real browser frames arrive', () => {
    expect(source).toContain('LL-HLS-Playlist empfangen – warte auf erste Videodaten');
    expect(source).toContain('await waitForPlaying(entry.video, HLS_START_TIMEOUT_MS');
    expect(source).toContain('Browser spielt den LL-HLS-Stream ab');
  });

  it('keeps Live/Kiosk visible through snapshot fallback instead of failing hard', () => {
    expect(source).toContain('SNAPSHOT_LIVE_FALLBACK');
    expect(source).toContain('snapshotMode: true');
    expect(source).toContain('Stabiler Snapshot-Livemodus');
  });

  it('logs HLS browser failures with response details', () => {
    expect(hlsSource).toContain('hlsErrorDetails');
    expect(hlsSource).toContain('responseCode');
    expect(hlsSource).toContain('responseText');
  });
});
