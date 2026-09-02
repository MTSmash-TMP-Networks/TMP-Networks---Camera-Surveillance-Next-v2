import path from 'node:path';
import { config } from '../../config.js';

export function recordingStorageRoots() {
  return [...new Set([
    config.recordingsDir,
    config.recordingsLocalDir,
  ].filter(Boolean).map((entry) => path.resolve(entry)))];
}

export function isRecordingStoragePath(filePath, { allowRoot = true } = {}) {
  if (!filePath) return false;
  const resolved = path.resolve(filePath);
  return recordingStorageRoots().some((root) => (allowRoot && resolved === root) || resolved.startsWith(`${root}${path.sep}`));
}

export function recordingStorageRootFor(filePath) {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  return recordingStorageRoots().find((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`)) || null;
}
