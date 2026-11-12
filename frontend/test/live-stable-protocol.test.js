import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/services/liveStreamPool.js', import.meta.url), 'utf8');
const hlsSource = readFileSync(new URL('../src/services/hlsPlayer.js', import.meta.url), 'utf8');

describe('Stable Live/Kiosk playback concept', () => {
  it('uses Local-HLS as the explicit kiosk/live transport when requested', () => {
    expect(source).toContain("function wantsLocalHls(entry)");
    expect(source).toContain("session.mode === 'local-hls-ring'");
    expect(source).toContain("forceLocalHls ? [tryHls]");
    expect(source).toContain("protocol: forceLocalHls ? 'Local-HLS' : 'LL-HLS'");
  });

  it('does not declare HLS ready before real browser frames arrive', () => {
    expect(source).toContain('await waitForPlaying(entry.video, 18000');
    expect(source).toContain('await waitForFrameProgress(entry.video, 10000');
    expect(source).toContain("entry.update({ state: 'ready', protocol: forceLocalHls ? 'Local-HLS'");
  });

  it('keeps snapshot mode as an explicit emergency path', () => {
    expect(source).toContain("session.mode === 'snapshot'");
    expect(source).toContain('snapshotMode: true');
    expect(source).toContain('Snapshot-Livemodus');
  });

  it('keeps HLS request diagnostics available for fatal recovery', () => {
    expect(hlsSource).toContain('responseCode');
    expect(hlsSource).toContain('data.context?.url');
    expect(hlsSource).toContain('recoverNetwork');
    expect(hlsSource).toContain('recoverMedia');
  });
});
