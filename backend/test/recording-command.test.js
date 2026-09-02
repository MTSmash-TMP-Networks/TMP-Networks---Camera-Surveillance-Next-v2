import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  buildRecordingArgs,
  buildRecordingInputArgs,
  buildRecordingRemuxArgs,
  nextRecordingSegmentNumber,
  waitForRecordingStartup,
} from '../src/services/recording/RecordingCommand.js';

describe('Aufnahme-FFmpeg-Kommandos', () => {
  it('zeichnet HLS mit optionalem Audio robust als MPEG-TS auf', () => {
    const args = buildRecordingArgs({ sourceUri: 'http://127.0.0.1:8888/cam_hls/index.m3u8', mediaToken: 'token', tempPath: '/data/a.partial.ts' });
    expect(args).toContain('-headers');
    expect(args.join(' ')).toContain('Authorization: Bearer token');
    expect(args).toContain('0:a:0?');
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'copy', '-c:a', 'copy']));
    expect(args).toContain('mpegts');
    expect(args).toEqual(expect.arrayContaining(['-mpegts_flags', '+resend_headers+initial_discontinuity']));
    expect(args).toEqual(expect.arrayContaining(['-rw_timeout', '15000000', '-reconnect', '1', '-progress', 'pipe:1']));
    expect(args).not.toContain('-reconnect_at_eof');
    expect(args).not.toContain('-stimeout');
  });


  it('überlässt das Nachladen einer Live-HLS-Playlist dem HLS-Demuxer', () => {
    const hls = buildRecordingInputArgs('http://go2rtc:1984/api/stream.m3u8?src=camera_hls');
    expect(hls).toContain('-reconnect');
    expect(hls).not.toContain('-reconnect_at_eof');

    const progressiveHttp = buildRecordingInputArgs('http://example.invalid/live.ts');
    expect(progressiveHttp).toEqual(expect.arrayContaining(['-reconnect_at_eof', '1']));
  });

  it('teilt einen dauerhaften Aufnahmeprozess ohne Stream-Neuverbindung in unabhängige Blöcke', () => {
    const args = buildRecordingArgs({
      sourceUri: 'http://127.0.0.1:8888/cam_hls/index.m3u8',
      mediaToken: 'token',
      segmentPattern: '/data/session/block-%06d.ts.partial',
      segmentSeconds: 300,
      segmentStartNumber: 7,
    });
    expect(args).toEqual(expect.arrayContaining([
      '-f', 'segment', '-segment_format', 'mpegts', '-segment_time', '300',
      '-segment_start_number', '7', '-reset_timestamps', '1',
    ]));
    expect(args.at(-1)).toBe('/data/session/block-%06d.ts.partial');
    expect(args).not.toContain('-mpegts_flags');
  });

  it('nutzt den vorhandenen HLS-Rückpuffer nur für den ersten Ereignisabschnitt', () => {
    const args = buildRecordingArgs({ sourceUri: 'http://127.0.0.1:8888/cam_hls/index.m3u8', mediaToken: 'token', tempPath: '/data/a.partial.ts', prebufferSeconds: 5 });
    expect(args).toEqual(expect.arrayContaining(['-live_start_index', '-5']));
  });

  it('vergibt nach fehlgeschlagenen Quellen immer eine neue freie Blocknummer', () => {
    expect(nextRecordingSegmentNumber({ blockCounter: 6, segmentIndexes: [1, 2, 9, 4] })).toBe(10);
    expect(nextRecordingSegmentNumber({ blockCounter: 0, segmentIndexes: [] })).toBe(1);
  });

  it('bestaetigt den Aufnahme-Start erst nach geschriebenen Mediendaten', async () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    let files = [];
    setTimeout(() => { files = [{ index: 4, sizeBytes: 1880 }]; }, 35);
    setTimeout(() => { files = [{ index: 4, sizeBytes: 3760 }]; }, 70);
    const result = await waitForRecordingStartup({
      child,
      startIndex: 4,
      timeoutMs: 500,
      pollIntervalMs: 10,
      minimumBytes: 1880,
      settleMs: 25,
      inspect: () => files,
    });
    expect(result).toMatchObject({ ok: true, file: { index: 4, sizeBytes: 3760 } });
  });

  it('akzeptiert kurz geschriebene Daten nicht, wenn FFmpeg waehrend der Stabilisierung beendet wird', async () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    let files = [];
    setTimeout(() => { files = [{ index: 2, sizeBytes: 1880 }]; }, 20);
    setTimeout(() => { child.exitCode = 1; child.emit('close', 1, null); }, 70);
    const result = await waitForRecordingStartup({
      child,
      startIndex: 2,
      timeoutMs: 400,
      pollIntervalMs: 10,
      minimumBytes: 1880,
      settleMs: 120,
      inspect: () => files,
    });
    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('FFmpeg beendet');
  });

  it('meldet einen lebenden FFmpeg-Prozess ohne Ausgabedaten als Startfehler', async () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    const result = await waitForRecordingStartup({
      child,
      startIndex: 1,
      timeoutMs: 100,
      pollIntervalMs: 10,
      minimumBytes: 188,
      inspect: () => [],
    });
    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('keine Mediendaten');
  });

  it('behält den Legacy-Remux für ältere monolithische Aufnahmen bei', () => {
    const args = buildRecordingRemuxArgs('/data/a.partial.ts', '/data/a.mp4');
    expect(args).toEqual(expect.arrayContaining(['-c', 'copy', '-movflags', '+faststart']));
    expect(args.at(-1)).toBe('/data/a.mp4');
  });
});
