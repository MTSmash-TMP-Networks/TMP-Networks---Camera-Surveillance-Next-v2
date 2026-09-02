import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Multi-Source-Liveansicht', () => {
  it('bietet alternative Quellen und Quellenstrategien in der Kamerabearbeitung an', () => {
    const source = fs.readFileSync(new URL('../src/pages/EditCameraPage.jsx', import.meta.url), 'utf8');
    expect(source).toContain('Alternative Medienquellen');
    expect(source).toContain('HLS / M3U8');
    expect(source).toContain('MJPEG');
    expect(source).toContain('RTMP / RTMPS');
    expect(source).toContain('SRT');
    expect(source).toContain('Quellenstrategie');
  });

  it('verwendet fuer den neuen Snapshot-Fallback den normalen Einzelvideo-Player', () => {
    const player = fs.readFileSync(new URL('../src/components/SeamlessLivePlayer.jsx', import.meta.url), 'utf8');
    expect((player.match(/<video\b/g) || [])).toHaveLength(1);
    expect(player).toContain("session.mode === 'snapshot'"); // nur Rueckwaertskompatibilitaet
    const editor = fs.readFileSync(new URL('../src/pages/EditCameraPage.jsx', import.meta.url), 'utf8');
    expect(editor).toContain('serverseitig durch FFmpeg als ruhiger H.264-Videostream');
  });

  it('zeigt erreichbare Dienste getrennt von bestaetigten Stream-Pfaden an', () => {
    const source = fs.readFileSync(new URL('../src/pages/EditCameraPage.jsx', import.meta.url), 'utf8');
    expect(source).toContain('serviceResults');
    expect(source).toContain('Standard-Stream-Pfad bestätigt');
    expect(source).toContain('Port {service.port}');
  });
});
