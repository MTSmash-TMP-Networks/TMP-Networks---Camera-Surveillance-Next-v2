import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = (file) => readFileSync(resolve(root, file), 'utf8');

test('network recording storage uses direct SMB and SFTP clients without a host mount', () => {
  const compose = read('docker-compose.yml');
  const dockerfile = read('backend/Dockerfile');
  const service = read('backend/src/services/NetworkRecordingStorageService.js');
  assert.doesNotMatch(compose, /RECORDINGS_EXTERNAL_HOST_PATH|\/recording-storage/);
  assert.match(dockerfile, /\bsmbclient\b/);
  assert.match(dockerfile, /\bopenssh-client\b/);
  assert.match(dockerfile, /\bsshpass\b/);
  assert.match(service, /execFile\('smbclient'/);
  assert.match(service, /execFile\('sshpass'/);
});

test('network storage credentials are encrypted and never exposed by the public profile', () => {
  const service = read('backend/src/services/NetworkRecordingStorageService.js');
  assert.match(service, /encryptSecret/);
  assert.match(service, /decryptSecret/);
  assert.match(service, /passwordConfigured: Boolean\(row\.password_enc\)/);
  const publicProfile = service.slice(service.indexOf('function publicProfile'), service.indexOf('function containsUnsafeControl'));
  assert.doesNotMatch(publicProfile, /password_enc\s*:/);
  assert.doesNotMatch(publicProfile, /password\s*:/);
});

test('finalized remote blocks retry safely and are materialized for playback/export', () => {
  const service = read('backend/src/services/NetworkRecordingStorageService.js');
  const recording = read('backend/src/services/RecordingService.js');
  const evidence = read('backend/src/services/recording/RecordingEvidenceExport.js');
  assert.match(service, /storage_state='pending'/);
  assert.match(service, /storage_state='upload_failed'/);
  assert.match(service, /storage_state='remote'/);
  assert.match(recording, /assignSegment\(/);
  assert.match(recording, /materializeSegment\(/);
  assert.match(evidence, /materializeSegment\(/);
});

test('compression does not race the network transfer worker', () => {
  const compression = read('backend/src/services/recording/RecordingCompressionService.js');
  const storage = read('backend/src/services/NetworkRecordingStorageService.js');
  assert.match(compression, /COALESCE\(s\.storage_state,'local'\) IN \('local','pending','upload_failed'\)/);
  assert.match(storage, /LEFT JOIN recording_compression_jobs c/);
  assert.match(storage, /c\.status IN \('completed','skipped','failed'\)/);
  assert.match(storage, /r\.status IN \('recording','ready','ready_with_gaps'\)/);
});


test('SMB compatibility path accepts NAS-style locations and distinguishes connection stages', () => {
  const service = read('backend/src/services/NetworkRecordingStorageService.js');
  const ui = read('frontend/src/components/RecordingStorageSettings.jsx');
  const parser = read('frontend/src/utils/smbLocation.js');
  assert.match(service, /function parseSmbLocation\(/);
  assert.match(service, /smb:\\\/\\\//);
  assert.match(service, /for \(const maxProtocol of \['SMB3', 'SMB2'\]\)/);
  assert.match(service, /--use-kerberos=off/);
  assert.match(service, /SMB2_02/);
  assert.match(service, /NETWORK_STORAGE_SHARE_NOT_FOUND/);
  assert.match(service, /NETWORK_STORAGE_PERMISSION_DENIED/);
  assert.match(service, /NETWORK_STORAGE_PROTOCOL_FAILED/);
  assert.match(service, /NETWORK_STORAGE_HOST_UNRESOLVED/);
  assert.match(service, /NETWORK_STORAGE_PORT_UNREACHABLE/);
  assert.match(service, /if \(profile\.protocol === 'smb'\) await runSmb\(profile, 'pwd'\)/);
  assert.match(ui, /parseSmbLocationText/);
  assert.match(parser, /export function parseSmbLocationText\(/);
  assert.match(ui, /NETWORK_STORAGE_SHARE_NOT_FOUND/);
  assert.match(ui, /NETWORK_STORAGE_PORT_UNREACHABLE/);
});
