import { networkRecordingStorageService, smbArchiveInventory } from './NetworkRecordingStorageService.js';

export const recordingStorageService = {
  inventoryStatus: () => smbArchiveInventory.status(),
  scanInventory: actor => smbArchiveInventory.startScan(actor),
  cleanInventory: (id, actor, canMutate) => smbArchiveInventory.startCleanup(id, actor, canMutate),
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
