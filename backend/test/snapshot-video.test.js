import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildSnapshotVideoArgs } from '../src/services/media/FfmpegCommand.js';
import { startSnapshotFramePump } from '../src/services/media/SnapshotVideoBridge.js';

describe('Snapshot-Video-Fallback', () => {
  it('erzeugt einen kontinuierlichen H.264-Stream aus image2pipe ohne Audio', () => {
    const args = buildSnapshotVideoArgs({
      webrtcOutput: 'rtsp://go2rtc:8554/cam_webrtc',
      hlsOutput: 'rtsp://go2rtc:8554/cam_hls',
      width: 1280,
      height: 720,
      fps: 5,
    });
    expect(args).toContain('image2pipe');
    expect(args).toContain('libx264');
    expect(args).toContain('ultrafast');
    expect(args).toContain('-an');
    expect(args.join(' ')).toContain('fps=5');
    expect(args.at(-1)).toContain('cam_webrtc');
    expect(args.at(-1)).toContain('cam_hls');
  });

  it('wiederholt das letzte gültige Bild, während neue Snapshots geladen werden', async () => {
    const stdin = new PassThrough();
    const child = { stdin };
    let bytes = 0;
    stdin.on('data', (chunk) => { bytes += chunk.length; });
    const frame = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const pump = startSnapshotFramePump({
      child,
      initialBuffer: frame,
      capture: async () => ({ contentType: 'image/jpeg', buffer: frame }),
      fps: 10,
      refreshMs: 400,
    });
    await new Promise((resolve) => setTimeout(resolve, 260));
    pump.stop();
    expect(bytes).toBeGreaterThanOrEqual(frame.length * 2);
  });
});
