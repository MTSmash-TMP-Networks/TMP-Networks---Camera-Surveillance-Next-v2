import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const poolSource = readFileSync(new URL('../src/services/liveStreamPool.js', import.meta.url), 'utf8');
const hlsSource = readFileSync(new URL('../src/services/hlsPlayer.js', import.meta.url), 'utf8');
const playerSource = readFileSync(new URL('../src/components/SeamlessLivePlayer.jsx', import.meta.url), 'utf8');

describe('Automatic HLS recovery', () => {
  it('keeps the last decoded frame visible while recovery runs', () => {
    expect(poolSource).toContain("['ready', 'recovering'].includes(entry.state.state)");
    expect(playerSource).toContain("!['ready', 'recovering'].includes(status.state)");
  });

  it('monitors recovering streams instead of waiting for a route change', () => {
    expect(poolSource).toContain("!['ready', 'recovering'].includes(entry.state.state)");
    expect(poolSource).toContain('HLS_RECOVERY_ESCALATION_MS');
    expect(poolSource).toContain('HLS_RECOVERY_ESCALATED');
    expect(poolSource).toContain("this.finishHlsRecovery(entry, 'playing')");
  });

  it('uses staged hls.js recovery and a hard timeout', () => {
    expect(hlsSource).toContain('RECOVERY_WATCHDOG_MS');
    expect(hlsSource).toContain('recoverNetwork');
    expect(hlsSource).toContain('recoverMedia');
    expect(hlsSource).toContain('recoverSoftStall');
    expect(hlsSource).toContain('recoveryTimedOut');
    expect(hlsSource).toContain('swapAudioCodec');
    expect(hlsSource).toContain('seekToLiveEdge');
  });
});
