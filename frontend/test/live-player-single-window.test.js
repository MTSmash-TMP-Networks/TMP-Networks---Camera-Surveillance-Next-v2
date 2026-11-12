import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const playerSource = readFileSync(resolve(here, '../src/components/SeamlessLivePlayer.jsx'), 'utf8');
const poolSource = readFileSync(resolve(here, '../src/services/liveStreamPool.js'), 'utf8');
const apiSource = readFileSync(resolve(here, '../src/services/api.js'), 'utf8');
const hlsSource = readFileSync(resolve(here, '../src/services/hlsPlayer.js'), 'utf8');
const livePageSource = readFileSync(resolve(here, '../src/pages/LivePage.jsx'), 'utf8');
const kioskPageSource = readFileSync(resolve(here, '../src/pages/KioskPage.jsx'), 'utf8');

describe('Nahtloser Live-/Kiosk-Stream', () => {
  it('besitzt genau eine browserweite Stelle, die echte Videoelemente erzeugt', () => {
    expect(playerSource).not.toContain('<video');
    expect((poolSource.match(/document\.createElement\('video'\)/g) || [])).toHaveLength(1);
    expect(playerSource).toContain('liveStreamPool.acquire');
  });

  it('remountet den Player nicht unnötig beim Kamerawechsel', () => {
    expect(livePageSource).not.toContain('<SeamlessLivePlayer key={camera.id}');
    expect(livePageSource).toContain('<SeamlessLivePlayer camera={camera}');
  });



  it('ueberwacht Livebilder mit Backend-Heartbeat und echten Browserframes', () => {
    expect(apiSource).toContain('streamHeartbeat');
    expect(poolSource).toContain('api.streamHeartbeat');
    expect(poolSource).toContain('requestVideoFrameCallback');
    expect(poolSource).toContain('getVideoPlaybackQuality');
    expect(poolSource).toContain('BACKEND_STREAM_HEARTBEAT_STALLED');
    expect(poolSource).toContain('BROWSER_STREAM_STALLED');
    expect(poolSource).toContain('markTransportStatsProgress');
    expect(poolSource).toContain('lastStatsProgressAt');
    expect(poolSource).toContain('hasReliableFrameSignal');
    expect(poolSource).toContain('timelineAdvanced = current > entry.lastCurrentTime');
  });

  it('verhindert stale HLS-Frames per Cache-Busting und No-Store-Headern', () => {
    expect(hlsSource).toContain('cacheBustUrl');
    expect(hlsSource).toContain('Cache-Control');
    expect(hlsSource).toContain('no-store');
    expect(hlsSource).toContain('Pragma');
    expect(apiSource).toContain("cache: 'no-store'");
  });

  it('kann einen warmen Stream profilübergreifend übernehmen und gezielt neu verbinden', () => {
    expect(poolSource).toContain('compatibleEntry(options)');
    expect(poolSource).toContain('allowCompatibleReuse');
    expect(kioskPageSource).toContain('reconnectSignal={refreshEpoch}');
    expect(kioskPageSource).toContain("key={`${item.id}:${camera?.id || 'empty'}`}");
  });

  it('bindet einen festen Kioskstream nicht bei jeder ResizeObserver-Aenderung neu an', () => {
    expect(playerSource).toContain("const requestedQuality = quality === 'auto' ? automaticQuality : quality");
    expect(playerSource).toContain("const connectionViewportWidth = requestedQuality === 'low' ? 640");
    expect(playerSource).toContain('waitingForAdaptiveMeasurement');
    expect(playerSource).toContain('viewportWidth: connectionViewportWidth');
    expect(playerSource).not.toContain('transportMode, viewportWidth, compact, connectDelayMs');
  });
});
