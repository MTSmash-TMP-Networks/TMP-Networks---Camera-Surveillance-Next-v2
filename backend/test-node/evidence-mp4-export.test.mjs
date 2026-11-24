import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { prepareEvidenceMp4 } from '../src/services/recording/EvidenceMp4.js';
import { describeZipEntry, writeStoredZipStream } from '../src/services/recording/ZipStoreWriter.js';

function exec(cmd, args, encoding = 'utf8') {
  const result = spawnSync(cmd, args, { encoding, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
}

test('three independent TS recordings become one indexed, seekable MP4 in a three-entry ZIP', async (t) => {
  if (['ffmpeg', 'ffprobe', 'unzip'].some((cmd) => spawnSync(cmd, [cmd === 'unzip' ? '-v' : '-version']).status !== 0)) {
    if (process.env.REQUIRE_FFMPEG === '1') assert.fail('FFmpeg, FFprobe and unzip required');
    t.skip('Media test dependencies missing'); return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-mp4-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const workDir = path.join(dir, 'work');
  fs.mkdirSync(workDir);
  const blocks = [];
  for (const [i, color] of ['red', 'green', 'blue'].entries()) {
    const sourcePath = path.join(dir, 'source-' + i + '.ts');
    exec('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','color=' + color + ':size=160x90:rate=15',
      '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-g','15','-pix_fmt','yuv420p',
      '-c:a','aac','-f','mpegts',sourcePath]);
    blocks.push({ sourcePath, sizeBytes: fs.statSync(sourcePath).size,
      originalHash: crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex') });
  }
  const result = await prepareEvidenceMp4({ blocks, workDir, resolveBlock: (b) => b.sourcePath });
  assert.ok(result.durationSeconds > 5.8 && result.durationSeconds < 6.5);
  assert.equal(result.videoCodec, 'h264');
  assert.equal(result.audioCodec, 'aac');
  assert.equal(result.sources.length, 3);
  for (const [i, sec] of [1, 3, 5].entries()) {
    const rgb = [...exec('ffmpeg', ['-hide_banner','-loglevel','error','-ss',String(sec),'-i',result.filePath,
      '-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'], null)];
    assert.ok(rgb[i] > 90 && rgb[i] > Math.max(...rgb.filter((_, j) => j !== i)) + 40, 'Seek at ' + sec + ' must show source ' + i);
  }
  for (const block of blocks) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(block.sourcePath)).digest('hex'), block.originalHash);
  assert.equal(fs.existsSync(path.join(workDir, 'inputs')), false);
  const video = await describeZipEntry({ name: 'export.mp4', filePath: result.filePath });
  const zipPath = path.join(dir, 'evidence.zip');
  const zipped = await writeStoredZipStream([{name:'README.txt',buffer:'Evidence MP4'},
    {name:'manifest.json',buffer:JSON.stringify({video:{sha256:video.sha256}})}, video], fs.createWriteStream(zipPath));
  assert.equal(zipped.entryCount, 3);
  assert.deepEqual(exec('unzip', ['-Z1', zipPath]).trim().split('\n'), ['README.txt','manifest.json','export.mp4']);
  exec('unzip', ['-t', zipPath]);
  const exported = exec('unzip', ['-p', zipPath, 'export.mp4'], null);
  assert.equal(crypto.createHash('sha256').update(exported).digest('hex'), video.sha256);
});
