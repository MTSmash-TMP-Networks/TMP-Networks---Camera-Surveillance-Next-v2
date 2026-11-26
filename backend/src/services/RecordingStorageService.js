import { networkRecordingStorageService, smbArchiveInventory } from './NetworkRecordingStorageService.js';
import { db } from '../db/database.js';

export const recordingStorageService = {
  inventoryStatus: () => smbArchiveInventory.status(),
  scanInventory: actor => smbArchiveInventory.startScan(actor),
  cleanInventory: (id, actor, canMutate, scope, authVersion) => smbArchiveInventory.startCleanup(id, actor, () => canMutate() && Boolean(db.prepare("SELECT 1 FROM users WHERE id=? AND role='admin' AND enabled=1 AND COALESCE(auth_version,1)=?").get(actor, authVersion)), scope),
  stopInventoryCleanup: id => smbArchiveInventory.stopCleanup(id),
  async overview() {
    return networkRecordingStorageService.settings();
  },
  async test(input) {
    if (input?.mode !== 'network') return { ok: true, mode: 'local' };
    return networkRecordingStorageService.test(input);
  },
  async configure(input) {
    if (input?.mode === 'network') await networkRecordingStorageService.test(input);
    return networkRecordingStorageService.save(input);
  },
};
