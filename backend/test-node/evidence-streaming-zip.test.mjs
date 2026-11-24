import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { writeStoredZipStream } from '../src/services/recording/ZipStoreWriter.js';

test('a day export is a complete ZIP with MP4 SHA-256 and no archive staging', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-evidence-stream-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const media = path.join(directory, 'export.mp4');
  const bytes = crypto.randomBytes(2 * 1024 * 1024);
  fs.writeFileSync(media, bytes);
  const archive = path.join(directory, 'evidence.zip');
  const digests = new Map();
  async function* entries() {
    yield { name: 'README.txt', buffer: 'TMP Camera Behoerdenexport' };
    yield { name: 'export.mp4', filePath: media,
      onWritten: ({ name, sha256, crc32, size }) => digests.set(name, { sha256, crc32, size }) };
    yield { name: 'manifest.json', buffer: JSON.stringify({
      schema: 1, media: Array.from(digests.entries()).map(([name, entry]) => ({
        name, sha256: entry.sha256, crc32: entry.crc32.toString(16), size: entry.size,
      })),
    }) };
  }
  const result = await writeStoredZipStream(entries(), createWriteStream(archive));
  assert.equal(result.entryCount, 3);
  assert.equal(digests.size, 1);
  assert.equal(digests.get('export.mp4').size, bytes.length);
  assert.equal(digests.get('export.mp4').sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.ok(fs.statSync(archive).size >= bytes.length);
  const binary = fs.readFileSync(archive);
  assert.equal(binary.readUInt32LE(0), 0x04034b50);
  assert.equal(binary.readUInt32LE(binary.length - 22), 0x06054b50);
  const hasUnzip = spawnSync('unzip', ['-v'], { encoding: 'utf8' });
  if (hasUnzip.status !== 0) return;
  const integrity = spawnSync('unzip', ['-t', archive], { encoding: 'utf8' });
  assert.equal(integrity.status, 0, integrity.stderr || integrity.stdout);
  const manifest = spawnSync('unzip', ['-p', archive, 'manifest.json'], { encoding: 'utf8' });
  assert.equal(manifest.status, 0);
  const parsed = JSON.parse(manifest.stdout);
  assert.equal(parsed.media[0].sha256, digests.get('export.mp4').sha256);
});

test('ZIP stream uses ordinary Writable backpressure instead of collecting a Blob', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-evidence-tiny-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const archive = path.join(directory, 'small.zip');
  const stream = createWriteStream(archive, { highWaterMark: 1024 });
  const result = await writeStoredZipStream([
    { name: 'manifest.json', buffer: JSON.stringify({ export: 'complete' }) },
    { name: 'README.txt', buffer: 'test' },
  ], stream);
  assert.equal(result.entryCount, 2);
  assert.equal(result.zip64, false);
  assert.ok(fs.statSync(archive).size > 100);
});

test('the recording route issues a scoped ticket and does not stream into a browser Blob', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const route = fs.readFileSync(path.join(root, 'backend/src/routes/recordings.js'), 'utf8');
  const frontend = fs.readFileSync(path.join(root, 'frontend/src/pages/RecordingsPage.jsx'), 'utf8');
  const evidence = fs.readFileSync(path.join(root, 'backend/src/services/recording/RecordingEvidenceExport.js'), 'utf8');
  assert.match(route, /get\('\/export\/download\/:ticket'/);
  assert.match(route, /evidenceDownloadTickets\.take/);
  assert.match(route, /\/export\/status\/:jobId/);
  assert.match(evidence, /output\.flushHeaders\?\.\(\)/);
  assert.match(frontend, /api\.recordingEvidencePrepare\(exportPayload\(\)\)/);
  assert.doesNotMatch(frontend, /saveDownload\(result\.blob/);
  assert.equal((evidence.match(/await writeStoredZipStream\(pkg\.entries, output/g) || []).length, 2);
  assert.match(evidence, /prepareEvidenceMp4\(/);
  assert.match(evidence, /claimJob\(/);
  assert.doesNotMatch(evidence, /export\.m3u8/);
  assert.match(evidence, /input\.endTime === '24:00'/);
});
