import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/database.js';
import { cameraRepository } from '../src/services/cameraRepository.js';

beforeAll(() => migrate());

describe('Persistente Medienquellen', () => {
  it('speichert Reihenfolge, Typ und Status pro Kamera', () => {
    const camera = cameraRepository.create({ name: 'Quellenkamera', ip: '192.0.2.55', port: 80, username: '', password: '', sourcePolicy: 'stable' });
    const stored = cameraRepository.replaceMediaSources(camera.id, [
      { label: 'HLS', kind: 'hls', url: 'http://192.0.2.55/live.m3u8', priority: 5, enabled: true },
      { label: 'MJPEG', kind: 'mjpeg', url: 'http://192.0.2.55/video.mjpg', priority: 20, enabled: false },
    ]);
    expect(cameraRepository.get(camera.id).sourcePolicy).toBe('stable');
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ label: 'HLS', kind: 'hls', priority: 5, enabled: true });
    cameraRepository.updateMediaSourceStatus(stored[0].id, 'available');
    expect(cameraRepository.mediaSources(camera.id)[0].lastStatus).toBe('available');
  });
});
