import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Multi-source camera editor', () => {
  const editor = fs.readFileSync(new URL('../src/pages/EditCameraPage.jsx', import.meta.url), 'utf8');
  const pool = fs.readFileSync(new URL('../src/services/liveStreamPool.js', import.meta.url), 'utf8');
  const player = fs.readFileSync(new URL('../src/components/SeamlessLivePlayer.jsx', import.meta.url), 'utf8');

  it('offers alternative source types and source strategy', () => {
    for (const marker of ['Alternative Medienquellen', 'HLS / M3U8', 'MJPEG', 'RTMP / RTMPS', 'SRT', 'Quellenstrategie']) expect(editor).toContain(marker);
  });
  it('reuses the centralized video player for server-side snapshot-video fallback', () => {
    expect(player).not.toContain('<video');
    expect((pool.match(/document\.createElement\('video'\)/g) || [])).toHaveLength(1);
    expect(pool).toContain("session.mode === 'snapshot-video'");
    expect(editor).toContain('serverseitig durch FFmpeg als ruhiger H.264-Videostream');
  });
  it('distinguishes reachable ports from verified RTSP path and media', () => {
    expect(editor).toContain('serviceResults');
    expect(editor).toContain('service.reachable');
    expect(editor).toContain('service.pathConfirmed');
    expect(editor).toContain('service.streamFound');
    expect(editor).toContain('RTSP-Pfad und SDP-Videospur bestätigt');
    expect(editor).toContain('Port {service.port}');
  });
});
