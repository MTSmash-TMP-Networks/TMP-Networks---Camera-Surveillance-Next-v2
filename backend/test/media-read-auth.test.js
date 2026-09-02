import { describe, expect, it } from 'vitest';
import { prepareMediaReadSource } from '../src/services/media/MediaReadAuth.js';
import { buildRecordingArgs } from '../src/services/recording/RecordingCommand.js';

describe('Interne go2rtc-Leseauthentifizierung', () => {
  it('laesst interne RTSP-Lesequellen ohne Token-Query', () => {
    const prepared = prepareMediaReadSource('rtsp://go2rtc:8554/camera_live', 'abc.def');
    expect(prepared.uri).toBe('rtsp://go2rtc:8554/camera_live');
    expect(prepared.inputArgs).toEqual([]);
    expect(prepared.displayUri).toBe('rtsp://go2rtc:8554/camera_live');
  });

  it('uebergibt HLS-Lesetokens als Authorization-Header', () => {
    const prepared = prepareMediaReadSource('http://go2rtc:1984/api/stream.m3u8?src=camera_hls', 'abc.def');
    expect(prepared.uri).toBe('http://go2rtc:1984/api/stream.m3u8?src=camera_hls');
    expect(prepared.inputArgs.join(' ')).toContain('Authorization: Bearer abc.def');
  });

  it('entfernt Zugangsdaten und Tokens aus Diagnose-URLs', () => {
    const prepared = prepareMediaReadSource('rtsp://user:pass@go2rtc:8554/camera_live?token=secret&x=1');
    expect(prepared.displayUri).toBe('rtsp://go2rtc:8554/camera_live?x=1');
  });



  it('entfernt interne Live-Cache-Busting-Parameter aus Diagnose-URLs', () => {
    const prepared = prepareMediaReadSource('http://go2rtc:1984/api/stream.m3u8?src=live&token=secret&_motion=1&_live=2&_ts=3&keep=ok');
    expect(prepared.displayUri).toBe('http://go2rtc:1984/api/stream.m3u8?src=live&keep=ok');
  });

  it('baut den Recorder-RTSP-Aufruf ohne Browser-Token', () => {
    const args = buildRecordingArgs({
      sourceUri: 'rtsp://go2rtc:8554/camera_live',
      mediaToken: 'abc.def',
      tempPath: '/data/a.partial.ts',
    });
    expect(args).toEqual(expect.arrayContaining(['-rtsp_transport', 'tcp']));
    expect(args).toContain('rtsp://go2rtc:8554/camera_live');
    expect(args).not.toContain('-headers');
  });
});
