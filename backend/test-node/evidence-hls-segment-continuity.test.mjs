import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildVodPlaylist } from '../src/services/recording/BlockArchive.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function expectedSegments(n) {
  return Array.from({ length: n }, (_, i) => ({
    status: 'ready',
    duration_seconds: 2,
    size_bytes: 2048,
    gap_seconds: 0,
    is_discontinuity: false,
    exportName: `segments/recording-7/block-${String(i + 1).padStart(6, '0')}.ts`,
  }));
}

test('evidence HLS playlist marks every timestamp-reset boundary without dropping a segment', () => {
  const segments = expectedSegments(4);
  const playlist = buildVodPlaylist(segments, (segment) => segment.exportName, {
    timestampResetPerSegment: true,
  });
  const urls = playlist.split('\n').filter((line) => line.startsWith('segments/'));
  assert.deepEqual(urls, segments.map((segment) => segment.exportName));
  assert.equal((playlist.match(/^#EXT-X-DISCONTINUITY$/gm) || []).length, 3);
  assert.equal((playlist.match(/^#EXTINF:/gm) || []).length, 4);
  assert.match(playlist, /#EXT-X-PLAYLIST-TYPE:VOD/);
  assert.match(playlist, /#EXT-X-ENDLIST/);
  assert.doesNotMatch(playlist, /#EXTM3U\n#EXT-X-DISCONTINUITY/);

  // The default setting must keep existing continuous-timestamp consumers
  // unchanged. The fix is opt-in for original FFmpeg archive blocks.
  const ordinary = buildVodPlaylist(segments, (segment) => segment.exportName);
  assert.doesNotMatch(ordinary, /#EXT-X-DISCONTINUITY/);
});

test('discontinuity resets follow every block even across recording-session boundaries', () => {
  const firstSession = expectedSegments(2);
  const secondSession = expectedSegments(2).map((item) => ({
    ...item, exportName: item.exportName.replace('recording-7', 'recording-8'),
  }));
  const playlist = buildVodPlaylist([...firstSession, ...secondSession], (s) => s.exportName, {
    timestampResetPerSegment: true,
  });
  assert.equal((playlist.match(/^#EXT-X-DISCONTINUITY$/gm) || []).length, 3);
  assert.match(playlist, /recording-7\/block-000002\.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:2\.000,\nsegments\/recording-8\/block-000001\.ts/);
  const playlistWithGaps = buildVodPlaylist([
    firstSession[0],
    { ...firstSession[1], gap_seconds: 10, is_discontinuity: true, status: 'recovered' },
  ], (s) => s.exportName, { timestampResetPerSegment: true });
  assert.equal((playlistWithGaps.match(/^#EXT-X-DISCONTINUITY$/gm) || []).length, 1,
    'Do not emit duplicate discontinuity markers for a recovered block');
});

test('both legacy and streaming authorities use timestamp-aware export.m3u8', () => {
  const source = fs.readFileSync(path.join(root,
    'backend/src/services/recording/RecordingEvidenceExport.js'), 'utf8');
  assert.equal((source.match(/timestampResetPerSegment:\s*true/g) || []).length, 2,
    'Both create() and stream() must mark all MPEG-TS archive boundaries');
  assert.match(source, /Vor der Wiedergabe das ZIP vollstaendig entpacken/);
});

test('FFmpeg can decode all original reset-timestamp blocks from the exported VOD playlist', (t) => {
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  const ffprobe = spawnSync('ffprobe', ['-version'], { encoding: 'utf8' });
  if (ffmpeg.status !== 0 || ffprobe.status !== 0) {
    t.skip('FFmpeg and FFprobe are not both installed in this test environment');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-evidence-hls-continuity-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const segmentPattern = path.join(dir, 'block-%03d.ts');
  const generated = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=15',
    '-t', '8', '-an',
    '-c:v', 'mpeg2video', '-g', '15', '-q:v', '4',
    '-f', 'segment', '-segment_format', 'mpegts', '-segment_time', '2',
    '-reset_timestamps', '1',
    '-segment_format_options', 'mpegts_flags=+resend_headers+initial_discontinuity',
    segmentPattern,
  ], { encoding: 'utf8', timeout: 20000 });
  assert.equal(generated.status, 0, generated.stderr);

  const files = fs.readdirSync(dir).filter((name) => /^block-\d+\.ts$/.test(name)).sort();
  assert.ok(files.length >= 3, `Expected several independent TS files; got ${files.length}`);
  const segments = files.map((name) => ({
    status: 'ready', size_bytes: fs.statSync(path.join(dir, name)).size,
    duration_seconds: 2, exportName: name,
  }));
  const playlist = buildVodPlaylist(segments, (segment) => segment.exportName, {
    timestampResetPerSegment: true,
  });
  const playlistFile = path.join(dir, 'export.m3u8');
  fs.writeFileSync(playlistFile, playlist);
  assert.equal((playlist.match(/^#EXT-X-DISCONTINUITY$/gm) || []).length, files.length - 1);

  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-allowed_extensions', 'ALL',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    playlistFile,
  ], { encoding: 'utf8', timeout: 15000 });
  assert.equal(probe.status, 0, probe.stderr);
  assert.ok(Number(probe.stdout.trim()) >= 6,
    `Playlist duration must include all blocks, got ${probe.stdout}`);

  const decoded = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-allowed_extensions', 'ALL',
    '-i', playlistFile, '-map', '0:v:0',
    '-progress', 'pipe:1', '-nostats', '-f', 'null', '-',
  ], { encoding: 'utf8', timeout: 20000 });
  assert.equal(decoded.status, 0, decoded.stderr);
  const frameCounts = [...decoded.stdout.matchAll(/^frame=(\d+)/gm)].map((match) => Number(match[1]));
  assert.ok(Math.max(...frameCounts) >= 90,
    `Expected to decode video beyond the first block; got ${decoded.stdout.slice(-400)}`);
});
