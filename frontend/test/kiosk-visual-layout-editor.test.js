import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { kioskMessages } from '../src/i18n/kioskMessages.js';

const kiosk = readFileSync(new URL('../src/pages/KioskPage.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/services/api.js', import.meta.url), 'utf8');

describe('Visual kiosk grid layout editor', () => {
  it('uses one server authority for browser and Linux layouts with safe migration and polling', () => {
    expect(kiosk).toContain('api.kioskLayouts()');
    expect(kiosk).toContain('api.saveKioskLayouts(');
    expect(kiosk).toContain('expectedRevision: sharedRevision.current');
    expect(kiosk).toContain('expectedRevision: 0');
    expect(kiosk).toContain('remote.revision !== sharedRevision.current');
    expect(kiosk).toContain('window.setInterval(synchronize, 5000)');
    expect(api).toContain("kioskLayouts: () => request('/kiosk/layouts'");
    expect(api).toContain("saveKioskLayouts: (input) => request('/kiosk/layouts'");
  });
  it('uses cached lazy thumbnails, never extra live video players', () => {
    expect(kiosk).toContain('createKioskThumbnailLoader');
    expect(kiosk).toContain('maxConcurrent: 2');
    expect(kiosk).toContain("api.thumbnail(cameraId, { signal, timeoutMs: 12_000 })");
    expect(kiosk).toContain('IntersectionObserver');
    expect(kiosk).toContain('observer.disconnect()');
    expect(kiosk).toContain('loader.dispose()');
    expect(kiosk).not.toContain('connectWhep(');
    expect(kiosk).not.toContain('connectHls(');
  });
  it('shows camera thumbnails on the left and preserves saved views and grid on the right', () => {
    expect(kiosk).toContain('kiosk-layout-saved-scroll');
    expect(kiosk).toContain('kiosk-layout-editor-workspace');
    expect(kiosk).toContain('kiosk-camera-palette-list');
    expect(kiosk).toContain('kiosk-layout-assignment-visual');
    expect(kiosk).toContain('<KioskThumbnail cameraId={String(camera.id)}');
    expect(kiosk).toContain('onSave({ ...draft, name: draft.name.trim() })');
    expect(css).toContain('grid-template-columns:284px minmax(0,1fr)');
  });
  it('supports mouse dragging, slot swapping, click-selection, keyboard and clear', () => {
    for (const marker of ['onDragStart={', 'onDragOver={', 'onDrop={', 'event.dataTransfer.setData', 'swapKioskSlotCameras', 'assignKioskCamera', 'aria-label={t(\'kiosk.editor.assignSlot\'', "value={item.cameraId}", "changeCamera(item.id, '')"]) expect(kiosk).toContain(marker);
  });
  it('has both German and English text and fallback labels for other locales', () => {
    expect(kioskMessages.de['kiosk.editor.cameraList']).toBe('Verfügbare Kameras');
    expect(kioskMessages.de['kiosk.editor.search']).toBe('Kameras suchen');
    expect(kioskMessages.en['kiosk.editor.cameraList']).toBe('Available cameras');
    expect(kioskMessages.fr['kiosk.editor.search']).toBe('Search cameras');
  });
  it('applies timeouts and cancellation to the existing authenticated snapshot endpoint', () => {
    expect(api).toContain('requestBlob(path, { signal = undefined, timeoutMs = 12_000 } = {})');
    expect(api).toContain('const requestSignal = signal && AbortSignal.any');
    expect(api).toContain("snapshot: (id, profile = '', options = {})");
  });
});
