import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assessProbe,
  blockIndexFromName,
  blockPaths,
  buildVodPlaylist,
  scanSessionBlocks,
  summarizeBlocks,
  writeJournal,
} from '../src/services/recording/BlockArchive.js';

const tempDirectories = [];
afterEach(() => {
  for (const directory of tempDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('Blockarchiv', () => {
  it('erkennt nur Blöcke mit Videospur und ausreichender Größe als abspielbar', () => {
    const valid = assessProbe({ format: { duration: '12.5', format_name: 'mpegts' }, streams: [{ codec_type: 'video', codec_name: 'h264' }] }, 100_000);
    expect(valid.playable).toBe(true);
    expect(valid.durationSeconds).toBe(12.5);
    expect(assessProbe({ format: { duration: '12' }, streams: [{ codec_type: 'audio' }] }, 100_000).playable).toBe(false);
    expect(assessProbe({ format: { duration: '12' }, streams: [{ codec_type: 'video' }] }, 100).reason).toBe('block_too_small');
  });

  it('verwendet bei MPEG-TS ohne gemeldete Dauer eine sichere Sitzungsdauer', () => {
    const assessed = assessProbe(
      { format: { format_name: 'mpegts' }, streams: [{ codec_type: 'video', codec_name: 'h264' }] },
      100_000,
      { fallbackDurationSeconds: 61.25 },
    );
    expect(assessed.playable).toBe(true);
    expect(assessed.durationSeconds).toBe(61.25);
    expect(assessed.durationEstimated).toBe(true);
  });

  it('erzeugt eine VOD-Playlist mit Diskontinuität nach einer Lücke', () => {
    const playlist = buildVodPlaylist([
      { segment_index: 1, duration_seconds: 10, size_bytes: 100, status: 'ready', gap_seconds: 0 },
      { segment_index: 2, duration_seconds: 8, size_bytes: 100, status: 'recovered', gap_seconds: 2.5 },
    ], (segment) => `/block/${segment.segment_index}`);
    expect(playlist).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(playlist).toContain('#EXT-X-DISCONTINUITY');
    expect(playlist).toContain('#EXT-X-ENDLIST');
    expect(playlist).toContain('/block/2');
  });

  it('scannt finale, partielle und beschädigte Blöcke deterministisch', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-block-archive-'));
    tempDirectories.push(directory);
    const first = blockPaths(directory, 1);
    const second = blockPaths(directory, 2);
    fs.writeFileSync(first.finalPath, Buffer.alloc(2000));
    fs.writeFileSync(second.tempPath, Buffer.alloc(2000));
    const files = scanSessionBlocks(directory);
    expect(files.map((item) => [item.index, item.kind])).toEqual([[1, 'final'], [2, 'partial']]);
    expect(blockIndexFromName('block-000123.ts.partial')).toBe(123);
  });

  it('schreibt ein atomar ersetzbares Sitzungsjournal und fasst Blöcke zusammen', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-block-journal-'));
    tempDirectories.push(directory);
    writeJournal(directory, { recordingId: 7, status: 'recording' });
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'session.json'), 'utf8')).recordingId).toBe(7);
    expect(fs.existsSync(path.join(directory, 'session.json.tmp'))).toBe(false);
    expect(summarizeBlocks([
      { status: 'ready', size_bytes: 10, duration_seconds: 2 },
      { status: 'damaged', size_bytes: 20, duration_seconds: 0 },
    ])).toMatchObject({ playableBlockCount: 1, damagedBlockCount: 1, fileSizeBytes: 10, mediaDurationSeconds: 2 });
  });
});
