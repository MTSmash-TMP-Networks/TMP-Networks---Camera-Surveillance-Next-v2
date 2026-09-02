#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { buildRecordingArgs } from '../backend/src/services/recording/RecordingCommand.js';
import { blockPaths, buildVodPlaylist, finalizeBlock, scanSessionBlocks } from '../backend/src/services/recording/BlockArchive.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-short-recording-stop-'));
const sourceDir = path.join(root, 'source');
const sessionDir = path.join(root, 'session');
fs.mkdirSync(sourceDir, { recursive: true });
fs.mkdirSync(sessionDir, { recursive: true });

function available(command) {
  return spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0;
}

function waitFor(predicate, timeoutMs = 15_000, intervalMs = 100) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      try {
        if (predicate()) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started >= timeoutMs) {
          clearInterval(timer);
          reject(new Error('Zeitlimit im Kurzaufnahme-Test überschritten'));
        }
      } catch (error) {
        clearInterval(timer);
        reject(error);
      }
    }, intervalMs);
  });
}

async function closeChild(child, timeoutMs = 20_000) {
  if (child.exitCode !== null) return;
  const closed = once(child, 'close');
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const result = await Promise.race([closed, timeout]);
  if (!result && child.exitCode === null) {
    child.kill('SIGKILL');
    await once(child, 'close').catch(() => {});
  }
}

let generator = null;
let recorder = null;
let server = null;
try {
  if (!available('ffmpeg') || !available('ffprobe')) throw new Error('FFmpeg und FFprobe werden benötigt.');

  server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '');
    const target = path.resolve(sourceDir, pathname || 'index.m3u8');
    if (!target.startsWith(`${path.resolve(sourceDir)}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', target.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
    fs.createReadStream(target).pipe(response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;

  generator = spawn('ffmpeg', [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-re',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25',
    '-map', '0:v:0', '-c:v', 'mpeg2video', '-g', '25',
    '-f', 'hls', '-hls_time', '1', '-hls_list_size', '20',
    '-hls_flags', 'append_list+omit_endlist',
    path.join(sourceDir, 'index.m3u8'),
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let generatorError = '';
  generator.stderr.on('data', (chunk) => { generatorError = `${generatorError}${chunk}`.slice(-4000); });
  await waitFor(() => fs.existsSync(path.join(sourceDir, 'index.m3u8')) && fs.readdirSync(sourceDir).some((name) => name.endsWith('.ts')), 15_000);

  const sourceUri = `http://127.0.0.1:${port}/index.m3u8`;
  const args = buildRecordingArgs({
    sourceUri,
    mediaToken: 'short-stop-test',
    segmentPattern: path.join(sessionDir, 'block-%06d.ts.partial'),
    segmentSeconds: 300,
    segmentStartNumber: 1,
  });
  if (args.includes('-reconnect_at_eof')) throw new Error('Live-HLS enthält weiterhin reconnect_at_eof.');

  recorder = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let recorderError = '';
  recorder.stderr.on('data', (chunk) => { recorderError = `${recorderError}${chunk}`.slice(-8000); });
  await waitFor(() => scanSessionBlocks(sessionDir).some((file) => file.kind === 'partial' && file.sizeBytes > 50_000), 20_000);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  recorder.stdin.write('q\n');
  recorder.stdin.end();
  await closeChild(recorder, 20_000);
  if (recorder.exitCode !== 0) throw new Error(recorderError || `Recorder beendet mit ${recorder.exitCode}`);

  const partials = scanSessionBlocks(sessionDir).filter((file) => file.kind === 'partial');
  if (partials.length !== 1) throw new Error(`Erwartet wurde ein kurzer offener Block, gefunden: ${partials.length}`);
  const file = partials[0];
  const paths = blockPaths(sessionDir, file.index);
  const result = await finalizeBlock({
    tempPath: file.filePath,
    finalPath: paths.finalPath,
    damagedPath: paths.damagedPath,
    ffprobePath: 'ffprobe',
    probeTimeoutMs: 12_000,
    minimumBytes: 1880,
    fallbackDurationSeconds: 5,
  });
  if (!result.playable || result.durationSeconds <= 1) {
    throw new Error(`Kurzaufnahme wurde nicht finalisiert: ${result.error || 'Dauer fehlt'}`);
  }
  const playlist = buildVodPlaylist([{
    segment_index: file.index,
    status: 'ready',
    size_bytes: result.sizeBytes,
    duration_seconds: result.durationSeconds,
    gap_seconds: 0,
  }], () => '/block/1');
  if (!playlist?.includes('#EXT-X-ENDLIST') || !playlist.includes('#EXTINF:')) throw new Error('VOD-Playlist der Kurzaufnahme ist ungültig.');

  console.log(JSON.stringify({
    result: 'ok',
    source: 'live-hls',
    gracefulStop: true,
    finalizedBlocks: 1,
    durationSeconds: Number(result.durationSeconds.toFixed(3)),
    sizeBytes: result.sizeBytes,
  }, null, 2));
} finally {
  if (recorder?.exitCode === null) recorder.kill('SIGKILL');
  if (generator?.exitCode === null) generator.kill('SIGKILL');
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
