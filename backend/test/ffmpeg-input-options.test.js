import { describe, expect, it } from 'vitest';
import { buildMediaInputArgs } from '../src/services/media/FfmpegInputOptions.js';
import { buildProbeArgs } from '../src/services/media/FfmpegProbe.js';

function containsUnsupportedTimeout(args) {
  return ['-rw_timeout', '-stimeout', '-timeout'].some((option) => args.includes(option));
}

describe('FFmpeg-Eingabekompatibilitaet', () => {
  it('verwendet bei RTSP nur die standardisierte Transportauswahl', () => {
    const args = buildMediaInputArgs('rtsp://camera.example/live', 'tcp', { threadQueueSize: 1024 });
    expect(args).toEqual(['-thread_queue_size', '1024', '-rtsp_transport', 'tcp']);
    expect(containsUnsupportedTimeout(args)).toBe(false);
  });

  it('setzt keine RTSP-Optionen auf HTTP-Quellen', () => {
    const args = buildMediaInputArgs('https://camera.example/live.mjpg', 'tcp');
    expect(args).not.toContain('-rtsp_transport');
    expect(args).toContain('-reconnect');
    expect(args).toContain('-reconnect_streamed');
  });

  it('erzwingt keine buildabhaengige Timeout-Option bei ffprobe', () => {
    const args = buildProbeArgs('rtsp://camera.example/live', 'udp');
    expect(args).toContain('-rtsp_transport');
    expect(args).toContain('udp');
    expect(containsUnsupportedTimeout(args)).toBe(false);
  });
});
