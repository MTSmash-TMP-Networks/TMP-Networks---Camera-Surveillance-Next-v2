import { beforeAll, describe, expect, it } from 'vitest';

let cameraRepository;
beforeAll(async () => {
  const { migrate } = await import('../src/db/database.js');
  migrate();
  ({ cameraRepository } = await import('../src/services/cameraRepository.js'));
});

describe('Kamera-Deduplizierung über IP-Adresse', () => {
  it('erkennt eine bereits vergebene IP-Adresse zuverlässig', () => {
    const camera = cameraRepository.create({
      name: 'IP-Dedup Kamera', ip: '192.0.2.120', port: 80, username: '', password: '', capabilities: {},
      macAddress: 'AA-BB-CC-DD-EE-FF', deviceUid: 'urn:uuid:camera-123', serialNumber: 'ABC-42',
    });
    const found = cameraRepository.findDiscoveryDuplicate({
      ip: 'http://192.0.2.120:8080', macAddress: '11:22:33:44:55:66', deviceUid: 'other-device', serialNumber: 'OTHER-1',
    });
    expect(found.cameraId).toBe(camera.id);
    expect(found.matchType).toBe('ip');
  });

  it('blockiert eine andere IP nicht wegen gleicher MAC, UID oder Seriennummer', () => {
    const found = cameraRepository.findDiscoveryDuplicate({
      ip: '192.0.2.121', macAddress: 'aa:bb:cc:dd:ee:ff', deviceUid: 'URN:UUID:CAMERA-123', serialNumber: 'ABC-42',
    });
    expect(found).toBeNull();
  });
});
