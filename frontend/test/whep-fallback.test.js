import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('WebRTC/WHEP fallback', () => {
  const whep = fs.readFileSync(new URL('../src/services/whep.js', import.meta.url), 'utf8');
  const pool = fs.readFileSync(new URL('../src/services/liveStreamPool.js', import.meta.url), 'utf8');
  it('imposes a hard wall-clock timeout on WHEP POST plus SDP body and video.play()', () => {
    expect(whep).toContain("new AbortController()");
    expect(whep).toContain('requestController.abort()');
    expect(whep).toContain("Zeitlimit bei der WebRTC/WHEP-Anmeldung");
    expect(whep).toContain('await response.text()');
    expect(whep).toContain('const playPromise = Promise.resolve(video.play())');
    expect(whep).not.toContain('await video.play()');
  });
  it('falls back to HLS when WHEP or playback fails without indefinite waiting', () => {
    expect(pool).toContain('WEBRTC_CONNECT_FAILED');
    expect(pool).toContain('Browser konnte WebRTC/WHEP nicht abspielen; HLS-Fallback wird versucht');
    expect(pool).toContain('await waitForPlaying(entry.video, 9000, entry.abort.signal)');
    expect(pool).toContain("if (state === 'failed' && ['ready', 'recovering'].includes(entry.state.state))");
    expect(pool).toContain('const attempts = forceLocalHls ? [tryHls]');
  });
  it('keeps reverse-proxy host and port headers', () => {
    const nginx = fs.readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8');
    expect(nginx).toContain('proxy_set_header Host $http_host;');
    expect(nginx).toContain('proxy_set_header X-Forwarded-Port $server_port;');
  });
});
