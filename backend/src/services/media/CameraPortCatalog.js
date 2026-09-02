const PORTS = [
  { port: 80, service: 'http', label: 'HTTP/Web', vendors: [] },
  { port: 81, service: 'http', label: 'Alternativer HTTP-Port', vendors: [] },
  { port: 82, service: 'http', label: 'Alternativer HTTP-Port', vendors: [] },
  { port: 83, service: 'http', label: 'Alternativer HTTP-Port', vendors: [] },
  { port: 88, service: 'http', label: 'Foscam/OEM Web', vendors: ['Foscam'] },
  { port: 322, service: 'rtsps', label: 'RTSP over TLS', vendors: [] },
  { port: 443, service: 'https', label: 'HTTPS/Web', vendors: [] },
  { port: 554, service: 'rtsp', label: 'RTSP', vendors: [] },
  { port: 558, service: 'rtsp', label: 'Hanwha NVR RTSP', vendors: ['Hanwha'] },
  { port: 1756, service: 'vendor', label: 'Bosch RCP+', vendors: ['Bosch'] },
  { port: 1935, service: 'rtmp', label: 'RTMP', vendors: ['Reolink'] },
  { port: 1936, service: 'rtmps', label: 'RTMP over TLS', vendors: [] },
  { port: 2020, service: 'onvif', label: 'TP-Link VIGI/Tapo ONVIF', vendors: ['TP-Link'] },
  { port: 4520, service: 'vendor', label: 'Hanwha/Wisenet Device-Port', vendors: ['Hanwha'] },
  { port: 4524, service: 'rtsp', label: 'Hanwha Legacy-DVR RTSP', vendors: ['Hanwha'] },
  { port: 5000, service: 'http', label: 'Alternativer ONVIF-/Web-Port', vendors: [] },
  { port: 7070, service: 'vendor', label: 'Hikvision IP-Server', vendors: ['Hikvision'] },
  { port: 7071, service: 'vendor', label: 'Hikvision IP-Server', vendors: ['Hikvision'] },
  { port: 7441, service: 'rtsp', label: 'UniFi Protect RTSP', vendors: ['Ubiquiti'] },
  { port: 7447, service: 'rtsps', label: 'UniFi Protect RTSPS', vendors: ['Ubiquiti'] },
  { port: 7681, service: 'vendor', label: 'Hikvision WebSocket', vendors: ['Hikvision'] },
  { port: 7682, service: 'vendor', label: 'Hikvision WebSocket TLS', vendors: ['Hikvision'] },
  { port: 8000, service: 'vendor', label: 'Hikvision/Uniview SDK', vendors: ['Hikvision', 'Uniview'] },
  { port: 8080, service: 'http', label: 'Alternativer HTTP-/ONVIF-Port', vendors: [] },
  { port: 8081, service: 'http', label: 'Alternativer HTTP-Port', vendors: [] },
  { port: 8082, service: 'http', label: 'Alternativer HTTP-Port', vendors: [] },
  { port: 8088, service: 'http', label: 'Alternativer HTTP-Port', vendors: [] },
  { port: 8443, service: 'https', label: 'HTTPS/VIGI Stream', vendors: ['TP-Link'] },
  { port: 8554, service: 'rtsp', label: 'Alternativer RTSP-Port', vendors: [] },
  { port: 8800, service: 'vendor', label: 'TP-Link VIGI Video-Service', vendors: ['TP-Link'] },
  { port: 8888, service: 'http', label: 'Alternativer Kamera-Webport', vendors: [] },
  { port: 8899, service: 'onvif', label: 'Alternativer ONVIF-Port', vendors: [] },
  { port: 9000, service: 'vendor', label: 'Reolink Basic/Media Service', vendors: ['Reolink'] },
  { port: 10080, service: 'http', label: 'Alternativer Kamera-Webport', vendors: [] },
  { port: 10554, service: 'rtsp', label: 'Hikvision alternativer RTSP-Port', vendors: ['Hikvision'] },
  { port: 34567, service: 'vendor', label: 'Xiongmai/XMEye Media-Service', vendors: ['Xiongmai'] },
  { port: 37777, service: 'vendor', label: 'Dahua TCP-Service', vendors: ['Dahua'] },
  { port: 50000, service: 'vendor', label: 'OEM DVR/NVR Media-Service', vendors: [] },
];

export const CAMERA_PORT_DEFINITIONS = Object.freeze(PORTS.map((item) => Object.freeze({ ...item })));
export const DEFAULT_CAMERA_SCAN_PORTS = Object.freeze(PORTS.map((item) => item.port));
export const CAMERA_WEB_PORTS = Object.freeze(PORTS.filter((item) => item.service === 'http' || item.service === 'https').map((item) => item.port));
export const CAMERA_TLS_PORTS = Object.freeze(PORTS.filter((item) => ['https', 'rtsps', 'rtmps'].includes(item.service)).map((item) => item.port));
export const CAMERA_RTSP_PORTS = Object.freeze(PORTS.filter((item) => item.service === 'rtsp' || item.service === 'rtsps').map((item) => item.port));
export const CAMERA_VENDOR_PORTS = Object.freeze(PORTS.filter((item) => ['vendor', 'onvif'].includes(item.service)).map((item) => item.port));

// Diese Ports werden auf jedem Ziel geprüft. Seltenere Ports folgen erst, sobald ein Host auf einem Ankerport antwortet.
export const CAMERA_PRIMARY_SCAN_PORTS = Object.freeze([
  80, 81, 82, 83, 88, 443, 554, 558, 1935, 2020, 4520, 4524,
  7441, 7681, 8000, 8080, 8081, 8088, 8443, 8554, 8800, 8899,
  9000, 10554, 34567, 37777,
]);

export const CAMERA_HTTP_PROBE_PATHS = Object.freeze([
  '/',
  '/onvif/device_service',
  '/ISAPI/System/deviceInfo',
  '/cgi-bin/magicBox.cgi?action=getSystemInfo',
  '/axis-cgi/param.cgi?action=list&group=Properties.System',
  '/cgi-bin/CGIProxy.fcgi?cmd=getDevInfo',
  '/cgi-bin/api.cgi?cmd=GetDevInfo',
  '/LAPI/V1.0/System/DeviceInfo',
]);

export function cameraPortDefinition(port) {
  return CAMERA_PORT_DEFINITIONS.find((item) => item.port === Number(port)) || null;
}

export function inferCameraPortSignature(openPorts = []) {
  const ports = new Set(openPorts.map(Number).filter(Number.isInteger));
  const webPorts = CAMERA_WEB_PORTS.filter((port) => ports.has(port));
  const web = webPorts.length > 0;
  const rtsp = CAMERA_RTSP_PORTS.some((port) => ports.has(port));
  const has = (...values) => values.some((value) => ports.has(value));

  // Portsignaturen sind nur dann ein Kameranachweis, wenn mindestens ein echter
  // Video-, ONVIF- oder Herstellerdienst beteiligt ist. Reine Webkombinationen
  // wie 80+443 oder 443+8888 sind absichtlich niemals Kamera-Signaturen.
  if (ports.has(7681) && ports.has(8000) && rtsp && web) return { manufacturer: 'Hikvision', confidence: 94, reason: 'Hikvision WebSocket/SDK zusammen mit Web und RTSP', strong: true };
  if (ports.has(1935) && rtsp && web) return { manufacturer: null, confidence: 88, reason: 'Video-Appliance mit Web, RTSP und RTMP', strong: true };
  if (ports.has(37777) && (rtsp || web)) return { manufacturer: 'Dahua', confidence: 90, reason: 'Dahua TCP-Port zusammen mit Web/RTSP', strong: true };
  if (ports.has(9000) && (rtsp || web || ports.has(1935))) return { manufacturer: 'Reolink', confidence: 88, reason: 'Reolink Media-Port zusammen mit Web/RTSP/RTMP', strong: true };
  if (ports.has(2020) && (rtsp || web || ports.has(8800))) return { manufacturer: 'TP-Link', confidence: 87, reason: 'VIGI/Tapo ONVIF-Port zusammen mit Kamera-Diensten', strong: true };
  if (ports.has(8800) && (rtsp || web)) return { manufacturer: 'TP-Link', confidence: 84, reason: 'VIGI Video-Service zusammen mit Web/RTSP', strong: true };
  if (ports.has(8000) && rtsp && web) return { manufacturer: null, confidence: 86, reason: 'Typische Kamera-SDK-, Web- und RTSP-Portkombination', strong: true };
  if (ports.has(8000) && web) return { manufacturer: null, confidence: 72, reason: 'Typischer Kamera-SDK-Port zusammen mit Webdienst', strong: false };
  if (has(4520, 4524, 558) && web) return { manufacturer: 'Hanwha', confidence: 83, reason: 'Hanwha/Wisenet Device-/RTSP-Port zusammen mit Web', strong: true };
  if (ports.has(1756) && (web || rtsp)) return { manufacturer: 'Bosch', confidence: 82, reason: 'Bosch RCP+ zusammen mit Web/RTSP', strong: true };
  if (has(34567, 50000) && (web || rtsp)) return { manufacturer: 'Xiongmai', confidence: 80, reason: 'OEM/XMEye Media-Port zusammen mit Web/RTSP', strong: true };
  if (has(7441, 7447) && web) return { manufacturer: 'Ubiquiti', confidence: 78, reason: 'UniFi Protect RTSP/RTSPS zusammen mit Web', strong: true };
  if (ports.has(88) && rtsp) return { manufacturer: 'Foscam', confidence: 75, reason: 'Foscam/OEM Webport zusammen mit RTSP', strong: false };
  if (rtsp && web) return { manufacturer: null, confidence: 54, reason: 'Web- und möglicher RTSP-Port antworten', strong: false };
  if (has(37777, 9000, 2020, 8800, 8000, 4520, 1756, 34567, 50000)) return { manufacturer: null, confidence: 52, reason: 'Ein herstellertypischer Kamera-Port antwortet', strong: false };
  if (rtsp) return { manufacturer: null, confidence: 46, reason: 'RTSP-Port antwortet', strong: false };
  return { manufacturer: null, confidence: 0, reason: null, strong: false };
}
