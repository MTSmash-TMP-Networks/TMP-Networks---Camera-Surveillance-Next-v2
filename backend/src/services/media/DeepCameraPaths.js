import { CAMERA_RTSP_PORTS, CAMERA_TLS_PORTS, CAMERA_WEB_PORTS } from './CameraPortCatalog.js';

const BASE_PATHS = [
  ['/11', 'OEM Hauptstream', 74], ['/12', 'OEM Substream', 74], ['/13', 'OEM Drittstream', 54],
  ['/0', 'Stream 0', 48], ['/1', 'Stream 1', 55], ['/2', 'Stream 2', 52], ['/3', 'Stream 3', 44],
  ['/live', 'Live', 50], ['/live.sdp', 'Live SDP', 58], ['/stream', 'Stream', 46], ['/stream1', 'Stream 1', 60], ['/stream2', 'Stream 2', 58],
  ['/main', 'Main', 42], ['/sub', 'Sub', 42], ['/mainstream', 'Mainstream', 48], ['/substream', 'Substream', 48],
  ['/video', 'Video', 38], ['/video1', 'Video 1', 46], ['/video2', 'Video 2', 44], ['/videoMain', 'Video Main', 62], ['/videoSub', 'Video Sub', 62],
  ['/media/video1', 'Media Video 1', 68], ['/media/video2', 'Media Video 2', 66],
  ['/profile1/media.smp', 'Profil 1', 70], ['/profile2/media.smp', 'Profil 2', 68],
  ['/axis-media/media.amp', 'Axis Media', 80], ['/mpeg4/media.amp', 'Axis MPEG4', 52],
  ['/cam/realmonitor?channel=1&subtype=0', 'Dahua Hauptstream', 88], ['/cam/realmonitor?channel=1&subtype=1', 'Dahua Substream', 88],
  ['/cam/realmonitor?channel=1&subtype=0&unicast=true&proto=Onvif', 'Dahua ONVIF Hauptstream', 82],
  ['/cam/realmonitor?channel=1&subtype=1&unicast=true&proto=Onvif', 'Dahua ONVIF Substream', 82],
  ['/h264/ch1/main/av_stream', 'H.264 Kanal 1 Main', 80], ['/h264/ch1/sub/av_stream', 'H.264 Kanal 1 Sub', 80],
  ['/h265/ch1/main/av_stream', 'H.265 Kanal 1 Main', 76], ['/h265/ch1/sub/av_stream', 'H.265 Kanal 1 Sub', 76],
  ['/ch1/main/av_stream', 'Kanal 1 Main', 64], ['/ch1/sub/av_stream', 'Kanal 1 Sub', 64],
  ['/Preview_01_main', 'Reolink Main', 82], ['/Preview_01_sub', 'Reolink Sub', 82],
  ['/h264Preview_01_main', 'Reolink H.264 Main', 82], ['/h264Preview_01_sub', 'Reolink H.264 Sub', 82],
  ['/h265Preview_01_main', 'Reolink H.265 Main', 78], ['/h265Preview_01_sub', 'Reolink H.265 Sub', 78],
  ['/live/ch00_0', 'Live Kanal 00 Main', 78], ['/live/ch00_1', 'Live Kanal 00 Sub', 78],
  ['/live/ch01_0', 'Live Kanal 01 Main', 66], ['/live/ch01_1', 'Live Kanal 01 Sub', 66],
  ['/av0_0', 'AV 0 Main', 68], ['/av0_1', 'AV 0 Sub', 68], ['/av1_0', 'AV 1 Main', 54], ['/av1_1', 'AV 1 Sub', 54],
  ['/live0.264', 'Live 0 H.264', 66], ['/live1.264', 'Live 1 H.264', 64],
  ['/ch0_0.h264', 'Kanal 0 H.264 Main', 60], ['/ch0_1.h264', 'Kanal 0 H.264 Sub', 60],
  ['/onvif1', 'ONVIF Stream 1', 64], ['/onvif2', 'ONVIF Stream 2', 62],
  ['/ipcam.sdp', 'IPCam SDP', 52], ['/camera.sdp', 'Camera SDP', 50], ['/media.sdp', 'Media SDP', 50],
  ['/play1.sdp', 'Play 1 SDP', 48], ['/play2.sdp', 'Play 2 SDP', 46],
  ['/live/0/MAIN', 'Live 0 Main', 58], ['/live/0/SUB', 'Live 0 Sub', 58], ['/live/1/MAIN', 'Live 1 Main', 52], ['/live/1/SUB', 'Live 1 Sub', 52],
  ['/media/stream1', 'Media Stream 1', 50], ['/media/stream2', 'Media Stream 2', 48],
  ['/streaming/video?profile=1', 'Streaming Profil 1', 46], ['/streaming/video?profile=2', 'Streaming Profil 2', 44],
];

export function buildDeepRtspCandidates(camera, openPorts = [], { aggressive = false } = {}) {
  const open = [...new Set(openPorts.map(Number))];
  const ports = open.filter((port) => CAMERA_RTSP_PORTS.includes(port));
  const tunnelPorts = open.filter((port) => CAMERA_WEB_PORTS.includes(port) && !CAMERA_TLS_PORTS.includes(port));
  if (!ports.length && !tunnelPorts.length) return [];
  const host = camera.onvif.ip.includes(':') ? `[${camera.onvif.ip}]` : camera.onvif.ip;
  const paths = [...BASE_PATHS];
  const channelLimit = aggressive ? 8 : 2;
  for (let channel = 1; channel <= channelLimit; channel += 1) {
    paths.push([`/Streaming/Channels/${channel}01`, `Kanal ${channel} Hauptstream`, 72 - channel]);
    paths.push([`/Streaming/Channels/${channel}02`, `Kanal ${channel} Substream`, 70 - channel]);
    paths.push([`/streaming/channels/${channel}01`, `Kanal ${channel} Hauptstream (klein)`, 59 - channel]);
    paths.push([`/streaming/channels/${channel}02`, `Kanal ${channel} Substream (klein)`, 57 - channel]);
    if (aggressive) {
      paths.push([`/cam/realmonitor?channel=${channel}&subtype=0`, `Dahua Kanal ${channel} Main`, 68 - channel]);
      paths.push([`/cam/realmonitor?channel=${channel}&subtype=1`, `Dahua Kanal ${channel} Sub`, 66 - channel]);
    }
  }
  const seen = new Set();
  const output = [];
  const append = (port, path, label, confidence, probeTransport = 'tcp') => {
    const protocol = CAMERA_TLS_PORTS.includes(port) ? 'rtsps' : 'rtsp';
    const url = `${protocol}://${host}:${port}${path}`;
    const key = `${url}|${probeTransport}`;
    if (seen.has(key)) return;
    seen.add(key);
    output.push({
      label: `Tiefensuche · ${label}${probeTransport === 'http' ? ' · RTSP-over-HTTP' : ''}`,
      kind: 'rtsp',
      priority: 240 + output.length,
      enabled: true,
      origin: 'discovered',
      url,
      probeTransport,
      confidence: probeTransport === 'http' ? Math.max(20, confidence - 18) : confidence,
      catalogProvider: probeTransport === 'http' ? 'TMP RTSP-over-HTTP-Suche' : 'TMP RTSP-Tiefensuche',
      catalogFamily: 'Herstellerübergreifende RTSP-Pfade',
      matchedBy: probeTransport === 'http' ? 'FFmpeg-RTSP-over-HTTP-Test' : 'Aktiver RTSP-DESCRIBE-Test',
    });
  };
  for (const port of ports) {
    for (const [path, label, confidence] of paths) append(port, path, label, confidence, 'tcp');
  }
  const tunnelPaths = paths.filter(([, , confidence]) => confidence >= (aggressive ? 52 : 68));
  for (const port of tunnelPorts) {
    for (const [path, label, confidence] of tunnelPaths) append(port, path, label, confidence, 'http');
  }
  return output;
}
