import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const read = (file) => readFileSync(resolve(root, file), 'utf8');

const compose = read('docker-compose.yml');
const dockerfile = read('backend/Dockerfile');
const database = read('backend/src/db/database.js');
const systemRoutes = read('backend/src/routes/system.js');
const storageService = read('backend/src/services/NetworkRecordingStorageService.js');
const recordingService = read('backend/src/services/RecordingService.js');
const compressionService = read('backend/src/services/recording/RecordingCompressionService.js');
const evidence = read('backend/src/services/recording/RecordingEvidenceExport.js');
const retention = read('backend/src/services/recording/RetentionManager.js');
const api = read('frontend/src/services/api.js');
const recordingsPage = read('frontend/src/pages/RecordingsPage.jsx');
const storagePage = read('frontend/src/components/RecordingStorageSettings.jsx');
const installation = read('INSTALLATION.md');

// Active recording remains on a local spool; no host-side network mount is used.
assert.match(compose, /RECORDINGS_DIR: \/data\/recordings/);
assert.match(compose, /NETWORK_RECORDING_CACHE_MAX_BYTES:/);
assert.doesNotMatch(compose, /RECORDINGS_EXTERNAL_HOST_PATH|\/recording-storage/);

// Runtime image contains direct SMB and SFTP clients.
assert.match(dockerfile, /\bsmbclient\b/);
assert.match(dockerfile, /\bopenssh-client\b/);
assert.match(dockerfile, /\bsshpass\b/);

// Storage profile and per-segment remote metadata are persistent.
assert.match(database, /CREATE TABLE IF NOT EXISTS recording_storage_profiles/);
assert.match(database, /storage_profile_id/);
assert.match(database, /remote_path/);
assert.match(database, /storage_state/);

// Admin API accepts direct network protocols and credentials.
assert.match(systemRoutes, /mode: z\.enum\(\['local', 'network'\]\)/);
assert.match(systemRoutes, /protocol: z\.enum\(\['smb', 'sftp'\]\)/);
assert.match(systemRoutes, /get\('\/recording-storage'/);
assert.match(systemRoutes, /post\('\/recording-storage\/test'/);
assert.match(systemRoutes, /put\('\/recording-storage'/);

// Backend transport is direct and credentials remain encrypted at rest.
assert.match(storageService, /encryptSecret/);
assert.match(storageService, /decryptSecret/);
assert.match(storageService, /execFile\('smbclient'/);
assert.match(storageService, /execFile\('sshpass'/);
assert.match(storageService, /UserKnownHostsFile/);
assert.match(storageService, /StrictHostKeyChecking/);
assert.match(storageService, /materializeSegment/);
assert.match(storageService, /storage_state='remote'/);
assert.match(storageService, /storage_state='upload_failed'/);
assert.match(storageService, /NETWORK_RECORDING_CACHE_MAX_BYTES/);
assert.match(storageService, /for \(const maxProtocol of \['SMB3', 'SMB2'\]\)/);
assert.match(storageService, /NETWORK_STORAGE_SHARE_NOT_FOUND/);
assert.match(storageService, /NETWORK_STORAGE_PORT_UNREACHABLE/);
assert.match(storageService, /parseSmbLocation/);

// Finalized blocks are compressed on the local spool before network transfer.
assert.match(recordingService, /recordingCompressionService\.enqueue\([\s\S]*networkRecordingStorageService\.assignSegment/);
assert.match(compressionService, /storage_state,'local'\) IN \('local','pending','upload_failed'\)/);
assert.match(storageService, /LEFT JOIN recording_compression_jobs c/);
assert.match(storageService, /r\.status IN \('recording','ready','ready_with_gaps'\)/);
assert.match(storageService, /c\.status IN \('completed','skipped','failed'\)/);
assert.match(compressionService, /r\.status IN \('recording','ready','ready_with_gaps'\)/);
assert.doesNotMatch(compressionService, /SELECT id,camera_id FROM recordings WHERE status='recording'/);
const compressionCommand = read('backend/src/services/recording/RecordingCompressionCommand.js');
const backendConfig = read('backend/src/config.js');
assert.match(compressionCommand, /'-maxrate'/);
assert.match(compressionCommand, /'-bufsize'/);
assert.match(backendConfig, /RECORDING_COMPRESSION_MAX_VIDEO_BITRATE_KBPS', 2500/);

// Finalized blocks are queued to network storage and remote blocks can be read/exported/deleted.
assert.match(recordingService, /assignSegment\(/);
assert.match(recordingService, /materializeSegment\(/);
assert.match(evidence, /materializeSegment\(/);
assert.match(retention, /deleteRemoteSegment\(/);

// UI exposes the storage API and both direct protocols.
assert.match(api, /recordingStorage: \(\) => request\('\/system\/recording-storage'/);
assert.match(recordingsPage, /recordings\.tabs\.storage/);
assert.match(recordingsPage, /archiveExpanded/);
assert.match(recordingsPage, /aria-expanded=\{archiveExpanded\}/);
assert.match(recordingsPage, /archiveTotals\.fileSizeBytes/);
assert.match(storagePage, /value="smb"/);
assert.match(storagePage, /value="sftp"/);
assert.match(storagePage, /testRecordingStorage/);
assert.match(storagePage, /saveRecordingStorage/);

// Buyer documentation explicitly explains that no host mount is necessary for SMB/SFTP.
assert.match(installation, /No SMB\/SFTP mount is required on the Docker host/);
assert.match(installation, /SMB \/ CIFS/);
assert.match(installation, /SFTP \/ SSH/);

console.log('Direct SMB/SFTP recording storage smoke test passed.');
