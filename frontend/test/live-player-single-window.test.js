import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const player = readFileSync(resolve(here, '../src/components/SeamlessLivePlayer.jsx'), 'utf8');
const pool = readFileSync(resolve(here, '../src/services/liveStreamPool.js'), 'utf8');
const api = readFileSync(resolve(here, '../src/services/api.js'), 'utf8');
const hls = readFileSync(resolve(here, '../src/services/hlsPlayer.js'), 'utf8');
const live = readFileSync(resolve(here, '../src/pages/LivePage.jsx'), 'utf8');
const kiosk = readFileSync(resolve(here, '../src/pages/KioskPage.jsx'), 'utf8');

describe('Shared live player behavior', () => {
  it('has a single browser-wide video-element factory and pooled consumers', () => {
    expect(player).not.toContain('<video');
    expect((pool.match(/document\.createElement\('video'\)/g) || [])).toHaveLength(1);
    expect(player).toContain('liveStreamPool.acquire');
  });
  it('does not remount the primary player for camera switches', () => {
    expect(live).not.toContain('<SeamlessLivePlayer key={camera.id}');
    expect(live).toContain('<SeamlessLivePlayer camera={camera}');
  });
  it('tracks backend and actual video-frame progress, not only the network link', () => {
    for (const marker of ['api.streamHeartbeat', 'requestVideoFrameCallback', 'getVideoPlaybackQuality', 'BACKEND_STREAM_HEARTBEAT_STALLED', 'BROWSER_STREAM_STALLED', 'markTransportStatsProgress', 'lastStatsProgressAt', 'hasReliableFrameSignal']) expect(pool).toContain(marker);
    expect(api).toContain('streamHeartbeat');
  });
  it('uses no-store HLS cache controls', () => {
    for (const marker of ['cacheBustUrl', 'Cache-Control', 'no-store', 'Pragma']) expect(hls).toContain(marker);
    expect(api).toContain("cache: 'no-store'");
  });
  it('reuses warm streams and preserves explicit reconnect commands', () => {
    expect(pool).toContain('compatibleEntry(options)');
    expect(pool).toContain('allowCompatibleReuse');
    expect(kiosk).toContain('reconnectSignal={refreshEpoch}');
  });
  it('never rebinds backend central preview on resize', () => {
    expect(player).toContain("const requestedQuality = compact ? 'low' : (quality === 'auto' ? 'auto' : quality)");
    expect(player).toContain('const connectionViewportWidth = compact ? 640');
    expect(player).toContain('const waitingForAdaptiveMeasurement = false');
    expect(player).toContain('viewportWidth: connectionViewportWidth');
    expect(player).not.toContain('transportMode, viewportWidth, compact, connectDelayMs');
  });
  it('keeps the full Live Auto setting on backend auto, Kiosk on low preview', () => {
    expect(player).toContain("quality === 'auto' ? 'auto' : quality");
    expect(player).toContain("compact ? 'low'");
    expect(pool).toContain("quality: requestedQuality, wait: false");
    expect(pool).not.toContain('quality: trackedQuality, wait: false');
    expect(pool).toContain('warmer Vorschau-Stream');
  });
  it('keeps last known ready camera status across views', () => {
    expect(live).toContain('cameraUpserted');
    expect(live).toContain("state === 'ready' && camera?.status !== 'online'");
    expect(live).toContain('onStatusChange={handlePlaybackStatus}');
  });
});
