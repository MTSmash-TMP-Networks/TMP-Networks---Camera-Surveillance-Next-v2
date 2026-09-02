import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planRetentionDeletion } from '../src/services/recording/RetentionPolicy.js';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = (file) => readFileSync(resolve(root, file), 'utf8');

test('minimum-free-space retention never deletes remote-only recordings', () => {
  const rows = [
    { id: 1, status: 'ready', started_at: '2026-01-01T00:00:00Z', file_size_bytes: 500_000_000, local_file_bytes: 0 },
    { id: 2, status: 'ready', started_at: '2026-01-02T00:00:00Z', file_size_bytes: 500_000_000, local_file_bytes: 50_000_000 },
  ];
  const policy = { cleanupEnabled: true, strategy: 'quota', maxRecordings: 0, maxStorageBytes: 0, minFreeBytes: 40_000_000, protectEventRecordings: false };
  const plan = planRetentionDeletion(rows, policy, { freeBytes: 1_000_000 });
  assert.deepEqual(plan.map((item) => item.id), [2]);
  assert.equal(plan[0].localBytes, 50_000_000);
});

test('retention protects recording rows while compression or upload is unfinished', () => {
  const rows = [
    { id: 1, status: 'ready', started_at: '2025-01-01T00:00:00Z', file_size_bytes: 500_000_000, local_file_bytes: 500_000_000, pipeline_busy: true },
  ];
  const policy = { cleanupEnabled: true, strategy: 'hybrid', maxAgeDays: 1, eventMaxAgeDays: 1, maxRecordings: 0, maxStorageBytes: 1, minFreeBytes: 10_000_000_000, protectEventRecordings: false };
  assert.deepEqual(planRetentionDeletion(rows, policy, { nowMs: Date.now(), freeBytes: 0 }), []);
});

test('network upload is verified and local cleanup happens before terminal remote state', () => {
  const source = read('backend/src/services/NetworkRecordingStorageService.js');
  const start = source.indexOf('async uploadSegment(segment)');
  const end = source.indexOf('async materializeSegment(segment)', start);
  const block = source.slice(start, end);
  const verify = block.indexOf('verifyRemoteFile(profile, segment.remote_path, expectedBytes)');
  const removeLocal = block.indexOf('await fs.promises.rm(localPath');
  const markRemote = block.lastIndexOf("storage_state='remote'");
  assert.ok(verify >= 0);
  assert.ok(removeLocal > verify);
  assert.ok(markRemote > removeLocal);
  assert.match(source, /async reconcile\(/);
  assert.match(source, /storage_state IN \('pending','uploading','upload_failed','remote'\)/);
  assert.match(source, /STALE_CACHE_PART_MAX_AGE_MS/);
});

test('restart recovery requeues recovered blocks for compression and network storage', () => {
  const source = read('backend/src/services/RecordingService.js');
  assert.match(source, /queueFinalizedBlockForStorage\(/);
  const recovery = source.slice(source.indexOf('async recoverBlockArchive'), source.indexOf('async recoverLegacyRecording'));
  assert.match(recovery, /queueFinalizedBlockForStorage\(row\.id, index/);
});

test('startup reconciles storage before retention is enabled', () => {
  const source = read('backend/src/server.js');
  const reconcile = source.indexOf('await networkRecordingStorageService.reconcile()');
  const retention = source.indexOf('retentionManager.start()');
  assert.ok(reconcile >= 0 && retention > reconcile);
});

test('minimum-free-space retention leaves remote-backed recordings to storage reconciliation', () => {
  const rows = [
    { id: 1, status: 'ready', started_at: '2026-01-01T00:00:00Z', file_size_bytes: 500_000_000, local_file_bytes: 250_000_000, remote_backed: true },
    { id: 2, status: 'ready', started_at: '2026-01-02T00:00:00Z', file_size_bytes: 500_000_000, local_file_bytes: 250_000_000, remote_backed: false },
  ];
  const policy = { cleanupEnabled: true, strategy: 'quota', maxRecordings: 0, maxStorageBytes: 0, minFreeBytes: 200_000_000, protectEventRecordings: false };
  const plan = planRetentionDeletion(rows, policy, { freeBytes: 1_000_000 });
  assert.deepEqual(plan.map((item) => item.id), [2]);
});

test('compression restart recovery discards transient output and preserves a backup for non-terminal jobs', () => {
  const source = read('backend/src/services/recording/RecordingCompressionService.js');
  const start = source.indexOf('reconcileTransientFiles()');
  const end = source.indexOf('\n  start() {', start);
  const block = source.slice(start, end);
  assert.match(block, /backupExists && !terminal/);
  assert.match(block, /fs\.renameSync\(backup, source\)/);
  assert.match(block, /if \(temporaryExists\) removeFile\(temporary\)/);
  assert.match(block, /requeue\(row\)/);
});

test('compression transient recovery is initialized before remote reconciliation', () => {
  const source = read('backend/src/server.js');
  const compression = source.indexOf('recordingCompressionService.start()');
  const reconcile = source.indexOf('await networkRecordingStorageService.reconcile()');
  const retention = source.indexOf('retentionManager.start()');
  assert.ok(compression >= 0 && reconcile > compression && retention > reconcile);
});
