import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dbPath = path.resolve(process.env.DB_PATH || '/data/kamera_server.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

function sizeOf(filePath) {
  try {
    const stat = fs.statSync(path.resolve(filePath || ''));
    return stat.isFile() ? stat.size : 0;
  } catch { return 0; }
}

const states = db.prepare(`SELECT COALESCE(storage_state,'local') AS state,COUNT(*) AS count,COALESCE(SUM(size_bytes),0) AS logical_bytes
  FROM recording_segments GROUP BY COALESCE(storage_state,'local') ORDER BY state`).all();
const compression = db.prepare(`SELECT status,COUNT(*) AS count,COALESCE(SUM(saved_bytes),0) AS saved_bytes
  FROM recording_compression_jobs GROUP BY status ORDER BY status`).all();
const segments = db.prepare(`SELECT id,recording_id,segment_index,file_path,size_bytes,storage_state,storage_profile_id,remote_path
  FROM recording_segments`).all();
let localBytes = 0;
let localFiles = 0;
let remoteDuplicates = 0;
let remoteDuplicateBytes = 0;
let missingPending = 0;
for (const segment of segments) {
  const bytes = sizeOf(segment.file_path);
  if (bytes > 0) {
    localBytes += bytes;
    localFiles += 1;
    if (String(segment.storage_state || 'local') === 'remote') {
      remoteDuplicates += 1;
      remoteDuplicateBytes += bytes;
    }
  } else if (['pending','uploading','upload_failed'].includes(String(segment.storage_state || 'local'))) {
    missingPending += 1;
  }
}

console.log(`database: ${dbPath}`);
console.log(`segments: ${segments.length}`);
console.log(`referenced local files: ${localFiles}`);
console.log(`referenced local bytes: ${localBytes}`);
console.log(`remote-state local duplicates: ${remoteDuplicates}`);
console.log(`remote-state duplicate bytes: ${remoteDuplicateBytes}`);
console.log(`pending/uploading rows without local file: ${missingPending}`);
console.log('storage states:');
for (const row of states) console.log(`  ${row.state}: ${row.count} segment(s), ${row.logical_bytes} logical bytes`);
console.log('compression jobs:');
for (const row of compression) console.log(`  ${row.status}: ${row.count} job(s), ${row.saved_bytes} saved bytes`);

db.close();
