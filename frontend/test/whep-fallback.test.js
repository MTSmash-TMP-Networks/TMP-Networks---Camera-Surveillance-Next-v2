import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('WebRTC/WHEP fallback', () => {
  it('wartet niemals unbegrenzt auf video.play und besitzt feste WHEP-Zeitlimits', () => {
    const source = fs.readFileSync(new URL('../src/services/whep.js', import.meta.url), 'utf8');
    expect(source).toContain("fetchWithTimeout(url");
    expect(source).toContain("Zeitlimit bei der WebRTC/WHEP-Anmeldung");
    expect(source).toContain("const playPromise = video.play()");
    expect(source).not.toContain('await video.play()');
    expect(source).toContain("controller.abort(timeoutError(message))");
  });

  it('wechselt nach fehlender WebRTC-Wiedergabe zu LL-HLS', () => {
    const source = fs.readFileSync(new URL('../src/services/liveStreamPool.js', import.meta.url), 'utf8');
    expect(source).toContain("WEBRTC_FALLBACK");
    expect(source).toContain("Low-Latency-HLS wird gestartet");
    expect(source).toContain('waitForPlaying(entry.video, 8000');
    expect(source).toContain("state === 'failed' && entry.state.state === 'ready'");
  });

  it('erhaelt Host und Port am WHEP-Reverse-Proxy', () => {
    const nginx = fs.readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8');
    expect(nginx).toContain('proxy_set_header Host $http_host;');
    expect(nginx).toContain('proxy_set_header X-Forwarded-Port $server_port;');
  });
});
