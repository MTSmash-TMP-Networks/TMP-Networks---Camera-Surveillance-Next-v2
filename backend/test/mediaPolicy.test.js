import { describe, expect, it } from 'vitest';
import { mediaPolicy, sanitize } from '../src/services/media/FfmpegProbe.js';

describe('Medienrichtlinie', () => {
  it('reicht H.264 Baseline ohne Neukodierung durch und behaelt Audio aktiv', () => {
    const policy = mediaPolicy({ video: { codec: 'h264', profile: 'Constrained Baseline', hasBFrames: false, pixelFormat: 'yuv420p' }, audio: { codec: 'aac' } });
    expect(policy.copyVideo).toBe(true);
    expect(policy.transcodeAudio).toBe(true);
    expect(policy.outputAudioCodecs).toEqual({ webrtc: 'opus', hls: 'aac' });
  });

  it('transkodiert H.265 weiterhin fuer Browser und HLS', () => {
    const h265 = mediaPolicy({ video: { codec: 'hevc', hasBFrames: false }, audio: null });
    expect(h265.transcodeVideo).toBe(true);
    expect(h265.outputVideoCodec).toBe('h264');
    expect(h265.reason).toContain('H.265/HEVC');
  });

  it('testet H.264 Main/yuvj420p standardmaessig zuerst per Copy', () => {
    const policy = mediaPolicy({ video: { codec: 'h264', profile: 'Main', hasBFrames: true, pixelFormat: 'yuvj420p' }, audio: { codec: 'pcm_alaw' } });
    expect(policy.copyVideo).toBe(true);
    expect(policy.transcodeVideo).toBe(false);
    expect(policy.browserVideoMode).toBe('copy-first');
    expect(policy.reason).toContain('nur nach einem echten Wiedergabefehler');
  });

  it('normalisiert riskantes H.264 im safe-Modus oder im Browser-Fallback', () => {
    const probe = { video: { codec: 'h264', profile: 'Main', hasBFrames: true, pixelFormat: 'yuvj420p' }, audio: { codec: 'pcm_alaw' } };
    const safe = mediaPolicy(probe, { browserVideoMode: 'safe' });
    const fallback = mediaPolicy(probe, { browserVideoMode: 'transcode' });
    expect(safe.transcodeVideo).toBe(true);
    expect(fallback.transcodeVideo).toBe(true);
    expect(fallback.copyVideo).toBe(false);
  });

  it('erzwingt fuer den Dauer-Ingest Video-Durchleitung unabhaengig vom Profil', () => {
    const policy = mediaPolicy({ video: { codec: 'hevc', profile: 'Main', hasBFrames: true, pixelFormat: 'yuvj420p' }, audio: { codec: 'pcm_alaw' } }, { browserVideoMode: 'force-copy' });
    expect(policy.copyVideo).toBe(true);
    expect(policy.transcodeVideo).toBe(false);
    expect(policy.transcodeAudio).toBe(true);
  });

  it('entfernt Medienadressen aus Fehlermeldungen', () => {
    expect(sanitize('Fehler rtsp://user:pass@192.168.1.10/stream')).not.toContain('pass');
  });
});
