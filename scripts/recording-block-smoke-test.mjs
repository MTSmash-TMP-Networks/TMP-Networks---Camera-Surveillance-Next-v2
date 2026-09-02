#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  blockPaths,
  buildVodPlaylist,
  finalizeBlock,
  scanSessionBlocks,
} from '../backend/src/services/recording/BlockArchive.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-recording-block-test-'));

function commandAvailable(command) {
  return spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0;
}

try {
  if (!commandAvailable('ffmpeg') || !commandAvailable('ffprobe')) {
    throw new Error('FFmpeg und FFprobe müssen für den Blockarchiv-Integrationstest installiert sein.');
  }

  const pattern = path.join(temporary, 'block-%06d.ts.partial');
  const generated = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25',
    '-t', '3.2', '-map', '0:v:0', '-c:v', 'mpeg2video', '-g', '25',
    '-f', 'segment', '-segment_format', 'mpegts', '-segment_time', '1',
    '-segment_start_number', '1', '-segment_time_delta', '0.05', '-reset_timestamps', '1',
    '-segment_format_options', 'mpegts_flags=+resend_headers+initial_discontinuity',
    pattern,
  ], { encoding: 'utf8' });
  if (generated.status !== 0) throw new Error(generated.stderr || 'FFmpeg-Segmenttest ist fehlgeschlagen.');

  const partials = scanSessionBlocks(temporary).filter((file) => file.kind === 'partial');
  if (partials.length < 3) throw new Error(`Es wurden nur ${partials.length} Testblöcke erzeugt.`);

  const segments = [];
  for (const file of partials) {
    const paths = blockPaths(temporary, file.index);
    const result = await finalizeBlock({
      tempPath: file.filePath,
      finalPath: paths.finalPath,
      damagedPath: paths.damagedPath,
      ffprobePath: 'ffprobe',
      probeTimeoutMs: 12_000,
      minimumBytes: 1880,
    });
    if (!result.playable) throw new Error(`Block ${file.index} wurde nicht als abspielbar erkannt: ${result.error}`);
    segments.push({
      segment_index: file.index,
      status: 'ready',
      size_bytes: result.sizeBytes,
      duration_seconds: result.durationSeconds,
      gap_seconds: file.index === 2 ? 0.25 : 0,
      is_discontinuity: file.index === 2 ? 1 : 0,
    });
  }

  const playlist = buildVodPlaylist(segments, (segment) => `/blocks/${segment.segment_index}`);
  if (!playlist?.includes('#EXT-X-ENDLIST') || !playlist.includes('#EXT-X-DISCONTINUITY')) {
    throw new Error('Die erzeugte Archivplaylist ist unvollständig.');
  }
  if (scanSessionBlocks(temporary).some((file) => file.kind === 'partial')) {
    throw new Error('Mindestens ein Testblock wurde nicht atomar abgeschlossen.');
  }

  console.log(JSON.stringify({
    project: path.basename(root),
    finalizedBlocks: segments.length,
    playlistLines: playlist.trim().split('\n').length,
    result: 'ok',
  }, null, 2));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
