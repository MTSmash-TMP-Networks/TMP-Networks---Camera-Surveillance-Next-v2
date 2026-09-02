import fs from 'node:fs';
import path from 'node:path';
import { createStoredZip } from '../backend/src/services/recording/ZipStoreWriter.js';

const workDir = '/tmp/tmp-camera-evidence-export-smoke';
fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(workDir, { recursive: true });
fs.mkdirSync(path.join(workDir, 'segments'), { recursive: true });
fs.writeFileSync(path.join(workDir, 'segments', 'block-000001.ts'), Buffer.alloc(1880, 0x47));
const output = path.join(workDir, 'evidence.zip');
const result = await createStoredZip([
  { name: 'README.txt', buffer: 'TMP Camera Evidence Export\n' },
  { name: 'manifest.json', buffer: JSON.stringify({ schema: 1, camera: 'test' }, null, 2) },
  { name: 'export.m3u8', buffer: '#EXTM3U\n#EXTINF:1.000,\nsegments/block-000001.ts\n#EXT-X-ENDLIST\n' },
  { name: 'segments/block-000001.ts', filePath: path.join(workDir, 'segments', 'block-000001.ts') },
], output);
if (result.entryCount !== 4) throw new Error(`Unexpected entry count: ${result.entryCount}`);
if (!fs.existsSync(output) || fs.statSync(output).size <= 0) throw new Error('Evidence export ZIP was not created');
console.log(JSON.stringify({ ok: true, entryCount: result.entryCount, sizeBytes: result.sizeBytes }));
