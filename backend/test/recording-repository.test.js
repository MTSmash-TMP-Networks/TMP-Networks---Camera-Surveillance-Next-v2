import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

let recordingRepository;
let cameraRepository;

beforeAll(async () => {
  const { migrate } = await import('../src/db/database.js');
  migrate();
  ({ recordingRepository } = await import('../src/services/recordingRepository.js'));
  ({ cameraRepository } = await import('../src/services/cameraRepository.js'));
});

describe('Aufnahmeverwaltung', () => {
  it('speichert und beendet eine Aufnahme mit Dateimetadaten', () => {
    const camera = cameraRepository.create({ name: 'Record Test', ip: '192.0.2.70', port: 80, username: 'u', password: 'p', capabilities: {} });
    const filePath = `/tmp/recording-${process.pid}.mp4`;
    fs.writeFileSync(filePath, Buffer.alloc(128));
    const created = recordingRepository.create({ cameraId: camera.id, filename: 'test.mp4', filePath });
    expect(created.status).toBe('recording');
    const ready = recordingRepository.finish(created.id, {
      filename: 'test.mp4', filePath, endedAt: new Date().toISOString(), durationSeconds: 12, fileSizeBytes: 128,
    });
    expect(ready.status).toBe('ready');
    expect(recordingRepository.list({ cameraId: camera.id })).toHaveLength(1);
    recordingRepository.remove(created.id);
    fs.rmSync(filePath, { force: true });
  });
});
