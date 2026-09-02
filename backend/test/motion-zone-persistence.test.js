import { beforeAll, describe, expect, it } from 'vitest';

let cameraRepository;
beforeAll(async () => {
  const { migrate } = await import('../src/db/database.js');
  migrate();
  ({ cameraRepository } = await import('../src/services/cameraRepository.js'));
});

describe('Kameraspezifischer Motion-Bereich', () => {
  it('speichert normalisierte Bildkoordinaten und kann wieder auf Vollbild zurueckgesetzt werden', () => {
    const camera = cameraRepository.create({
      name: 'Motion-Zone-Test', ip: '198.51.100.222', port: 80, username: '', password: '', capabilities: {},
    });
    expect(camera.motionZone).toBeNull();

    cameraRepository.update(camera.id, { motionZone: { x: 0.1, y: 0.2, width: 0.6, height: 0.5 } });
    expect(cameraRepository.get(camera.id).motionZone).toEqual({ x: 0.1, y: 0.2, width: 0.6, height: 0.5 });

    cameraRepository.update(camera.id, { motionZone: null });
    expect(cameraRepository.get(camera.id).motionZone).toBeNull();
    cameraRepository.remove(camera.id);
  });
});
