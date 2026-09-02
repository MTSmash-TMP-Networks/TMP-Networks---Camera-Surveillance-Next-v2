import { describe, expect, it } from 'vitest';
import { buildFfmpegArgs } from '../src/services/media/FfmpegCommand.js';

const probe = { video: { codec: 'h264', fps: 25 }, audio: { codec: 'g711', channels: 1 } };

describe('FFmpeg-Browserausgaben', () => {
  it('kodiert Video einmal und verteilt Opus/AAC per Tee', () => {
    const args = buildFfmpegArgs({
      sourceUri: 'rtsp://user:pass@192.0.2.5/live', inputTransport: 'tcp',
      policy: { copyVideo: false }, probe,
      webrtcOutput: 'rtsp://localhost/webrtc?token=one', hlsOutput: 'rtsp://localhost/hls?token=two',
    });
    const text = args.join(' ');
    expect(text).toContain('-rtsp_transport tcp');
    expect(text).not.toContain('-rw_timeout');
    expect(text).not.toContain('-stimeout');
    expect(text).toContain('libopus');
    expect(text).toContain('aac');
    expect(text).toContain('-f tee');
    expect(text).toContain("select='v\\:0,a\\:0'");
    expect(text).toContain("select='v\\:0,a\\:1'");
    expect(args.filter((value) => value === '-c:v')).toHaveLength(1);
  });

  it('setzt RTSP-Eingabeoptionen nicht auf HTTP-Quellen', () => {
    const args = buildFfmpegArgs({
      sourceUri: 'https://camera.test/video', inputTransport: 'tcp',
      policy: { copyVideo: false }, probe: { video: { codec: 'mjpeg', fps: 15 }, audio: null },
      webrtcOutput: 'rtsp://localhost/webrtc', hlsOutput: 'rtsp://localhost/hls',
    });
    const inputIndex = args.indexOf('-i');
    expect(args.slice(0, inputIndex)).not.toContain('-rtsp_transport');
    expect(args.join(' ')).toContain('libx264');
    expect(args.join(' ')).toContain("select='v\\:0'");
  });
});
