import { networkRecordingStorageService } from './NetworkRecordingStorageService.js';

export const recordingStorageService = {
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
