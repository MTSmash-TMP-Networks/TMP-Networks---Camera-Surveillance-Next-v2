import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const poolSource = readFileSync(resolve(here, '../src/services/liveStreamPool.js'), 'utf8');
const shellSource = readFileSync(resolve(here, '../src/components/AppShell.jsx'), 'utf8');
const addSource = readFileSync(resolve(here, '../src/pages/AddCameraPage.jsx'), 'utf8');

describe('Browserstream-Ressourcensteuerung', () => {
  it('deaktiviert versteckte Always-On-Browserdecoder und Transcode-Fallback standardmaessig', () => {
    expect(poolSource).toContain("VITE_STREAM_BROWSER_PREWARM_ENABLED || 'false'");
    expect(poolSource).toContain("VITE_BROWSER_TRANSCODE_FALLBACK_ENABLED || 'false'");
    expect(poolSource).toContain('waitForFrameProgress');
    expect(poolSource).toContain("prewarm(options, reason = 'configured-camera')");
    expect(poolSource).toContain('if (!PREWARM_ENABLED || !options?.cameraId) return null');
  });

  it('behaelt die optionale zentrale Synchronisierung fuer Altinstallationen', () => {
    expect(shellSource).toContain('liveStreamPool.syncPersistentCameras(cameras)');
    expect(shellSource).toContain('destroyAll({ force: true })');
    expect(poolSource).toContain("purpose: 'kiosk'");
    expect(poolSource).toContain("quality: 'low'");
  });

  it('kann eine neue Kamera weiterhin vor dem Wechsel in die Liveansicht vorbereiten', () => {
    const prewarm = addSource.indexOf('liveStreamPool.prewarm');
    const navigation = addSource.indexOf('navigate(`/live?camera=${result.camera.id}`)');
    expect(prewarm).toBeGreaterThan(-1);
    expect(navigation).toBeGreaterThan(prewarm);
  });
});
