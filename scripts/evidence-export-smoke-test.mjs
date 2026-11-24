import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStoredZip } from '../backend/src/services/recording/ZipStoreWriter.js';

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-camera-evidence-export-smoke-'));
try {
  const output = path.join(workDir, 'evidence.zip');
  const result = await createStoredZip([
    { name: 'README.txt', buffer: 'TMP Camera Evidence Export\n' },
    { name: 'manifest.json', buffer: JSON.stringify({ schema: 2, camera: 'test' }, null, 2) },
    { name: 'export.mp4', buffer: Buffer.from('ZIP writer fixture; real MP4 is tested separately') },
  ], output);
  if (result.entryCount !== 3 || !fs.statSync(output).size) throw new Error('Evidence ZIP writer smoke test failed');
  console.log(JSON.stringify({ ok: true, entryCount: result.entryCount, sizeBytes: result.sizeBytes }));
} finally { fs.rmSync(workDir, { recursive: true, force: true }); }
