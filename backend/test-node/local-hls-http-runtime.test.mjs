import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { buildLocalHlsRingArgs } from '../src/services/media/FfmpegCommand.js';

function waitForExit(child, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('FFmpeg runtime test timed out')), timeoutMs);
    timer.unref?.();
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}

test('HTTP MPEG-TS broker bridge produces a playable local HLS ring', async (t) => {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
    t.skip('ffmpeg is not installed');
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-camera-http-ts-'));
  const source = path.join(root, 'source.ts');
  const output = path.join(root, 'hls');
  fs.mkdirSync(output, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const generated = spawnSync('ffmpeg', [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10',
    '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-profile:v', 'baseline', '-pix_fmt', 'yuv420p', '-g', '10', '-bf', '0', '-an',
    '-f', 'mpegts', source,
  ], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr || 'sample MPEG-TS generation failed');

  const server = http.createServer((req, res) => {
    if (!req.url?.startsWith('/media/go2rtc/api/stream.ts?src=cam_video')) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store' });
    fs.createReadStream(source).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = server.address().port;

  const args = buildLocalHlsRingArgs({
    sourceUri: `http://127.0.0.1:${port}/media/go2rtc/api/stream.ts?src=cam_video`,
    outputDir: output,
    includeAudio: false,
    segmentSeconds: 1,
    listSize: 4,
  });
  const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const result = await waitForExit(child);
  assert.equal(result.code, 0, stderr || `ffmpeg exited with ${result.code ?? result.signal}`);

  const playlist = fs.readFileSync(path.join(output, 'index.m3u8'), 'utf8');
  assert.match(playlist, /#EXTM3U/);
  assert.match(playlist, /seg_\d+\.ts/);
  const segments = fs.readdirSync(output).filter((name) => name.endsWith('.ts'));
  assert.ok(segments.length >= 1, `expected HLS segments, got ${segments.join(', ')}`);
  assert.ok(segments.some((name) => fs.statSync(path.join(output, name)).size > 1880));
});
