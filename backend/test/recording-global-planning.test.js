import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

let cameraRepository;
let recordingPolicyRepository;
let db;

beforeAll(async () => {
  const database = await import('../src/db/database.js');
  database.migrate();
  db = database.db;
  ({ cameraRepository } = await import('../src/services/cameraRepository.js'));
  ({ recordingPolicyRepository } = await import('../src/services/recording/RecordingPolicyRepository.js'));
});

describe('Globale Aufnahmeplanung', () => {
  it('verteilt Vorlage in einer Transaktion und vergibt pro Kamera eigene Plan-IDs', () => {
    const a = cameraRepository.create({ name: 'Global-' + randomUUID(), ip: '192.0.2.150', port: 80, username: '', password: '', capabilities: {} });
    const b = cameraRepository.create({ name: 'Global-' + randomUUID(), ip: '192.0.2.151', port: 80, username: '', password: '', capabilities: {} });
    try {
      const template = {
        id: 'template-id', cameraId: a.id, profileToken: 'ONVIF-CAMERA-A',
        name: 'Ganztagsaufnahme', mode: 'scheduled', timezone: 'Europe/Berlin',
        enabled: true, weekdays: [0,1,2,3,4,5,6],
        startTime: '00:00', endTime: '00:00', quality: 'balanced',
      };
      const result = recordingPolicyRepository.applyPlanningToAll({ plans: [template] });
      expect(result.updated).toBeGreaterThanOrEqual(2);
      expect(result.appliedRetention).toBe(false);
      const [pa] = recordingPolicyRepository.listPlans(a.id);
      const [pb] = recordingPolicyRepository.listPlans(b.id);
      expect(pa.name).toBe(template.name);
      expect(pb.name).toBe(template.name);
      expect(pa.startTime).toBe('00:00');
      expect(pb.endTime).toBe('00:00');
      expect(pa.id).not.toBe(pb.id);
      expect(pa.id).not.toBe('template-id');
      expect(pa.profileToken).toBeNull();
      expect(pb.profileToken).toBeNull();
    } finally {
      cameraRepository.remove(a.id);
      cameraRepository.remove(b.id);
    }
  });

  it('rollt alle Kameraänderungen bei einem Datenbankfehler zurück', () => {
    const idA = randomUUID();
    const idB = randomUUID();
    const a = cameraRepository.create({ id: idA, name: 'Global-' + idA, ip: '192.0.2.152', port: 80, username: '', password: '', capabilities: {} });
    const b = cameraRepository.create({ id: idB, name: 'Global-' + idB, ip: '192.0.2.153', port: 80, username: '', password: '', capabilities: {} });
    const original = { name: 'Unverändert', mode: 'scheduled', weekdays: [1], startTime: '08:00', endTime: '16:00' };
    try {
      recordingPolicyRepository.replacePlans(a.id, [original]);
      recordingPolicyRepository.replacePlans(b.id, [original]);
      // A trigger failure after some cameras were changed must roll back
      // the entire operation, never leave a partially configured fleet.
      db.exec(`CREATE TRIGGER fail_global_recording_${idB.replaceAll('-', '')}
        BEFORE INSERT ON recording_plans
        WHEN NEW.camera_id='${idB}'
        BEGIN SELECT RAISE(ABORT, 'test-global-rollback'); END`);
      expect(() => recordingPolicyRepository.applyPlanningToAll({
        plans: [{ ...original, name: 'Soll nicht gespeichert werden' }],
      })).toThrow(/test-global-rollback/);
      expect(recordingPolicyRepository.listPlans(a.id)[0].name).toBe('Unverändert');
      expect(recordingPolicyRepository.listPlans(b.id)[0].name).toBe('Unverändert');
    } finally {
      db.exec(`DROP TRIGGER IF EXISTS fail_global_recording_${idB.replaceAll('-', '')}`);
      cameraRepository.remove(a.id);
      cameraRepository.remove(b.id);
    }
  });
});
