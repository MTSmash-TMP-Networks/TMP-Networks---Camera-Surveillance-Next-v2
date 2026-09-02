import { beforeAll, describe, expect, it } from 'vitest';

let cameraRepository;
beforeAll(async () => {
  const { migrate } = await import('../src/db/database.js');
  migrate();
  ({ cameraRepository } = await import('../src/services/cameraRepository.js'));
});

describe('Automatische Kameranamen', () => {
  it('vergibt den naechsten fortlaufenden Kamera-Namen, wenn kein Name gesetzt ist', () => {
    const marker = cameraRepository.create({
      name: 'Kamera-9000', ip: '198.51.100.10', port: 80, username: '', password: '', capabilities: {},
    });
    const created = cameraRepository.create({
      name: '', ip: '198.51.100.11', port: 80, username: '', password: '', capabilities: {},
    });
    expect(created.name).toBe('CAM-9001');
    cameraRepository.remove(marker.id);
    cameraRepository.remove(created.id);
  });

  it('zaehlt nur echte Standardnamen und ignoriert erkannte Metadaten', () => {
    const metadata = cameraRepository.create({
      name: 'Hikvision DS-2CD Interface', ip: '198.51.100.12', port: 80, username: '', password: '', capabilities: {},
    });
    const marker = cameraRepository.create({
      name: 'Kamera-9010', ip: '198.51.100.13', port: 80, username: '', password: '', capabilities: {},
    });
    expect(cameraRepository.nextDefaultName()).toBe('CAM-9011');
    cameraRepository.remove(metadata.id);
    cameraRepository.remove(marker.id);
  });

  it('korrigiert stale automatische Vorschlaege beim Speichern serverseitig', () => {
    const first = cameraRepository.create({
      name: 'Kamera-9020', ip: '198.51.100.14', port: 80, username: '', password: '', capabilities: {},
    });
    const second = cameraRepository.create({
      name: 'Kamera-9020', ip: '198.51.100.15', port: 80, username: '', password: '', capabilities: {},
    });
    expect(second.name).toBe('CAM-9021');
    cameraRepository.remove(first.id);
    cameraRepository.remove(second.id);
  });
});
