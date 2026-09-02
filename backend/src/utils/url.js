export function injectCredentials(rawUri, username, password) {
  const url = new URL(rawUri);
  if (['rtsp:', 'rtsps:', 'http:', 'https:', 'rtmp:', 'rtmps:'].includes(url.protocol.toLowerCase())) {
    url.username = username || '';
    url.password = password || '';
  }
  return url.toString();
}

export function stripCredentials(rawUri) {
  if (!rawUri) return null;
  const url = new URL(rawUri);
  url.username = '';
  url.password = '';
  return url.toString();
}

/**
 * ONVIF cameras frequently advertise an internal hostname, a stale address or
 * 0.0.0.0 in GetStreamUri. The camera address entered/discovered by the user is
 * the trusted endpoint and is therefore always preferred for media access.
 */
export function normalizeCameraUri(rawUri, cameraIp, { forceCameraHost = true } = {}) {
  const url = new URL(rawUri);
  if (!['rtsp:', 'rtsps:', 'http:', 'https:'].includes(url.protocol)) throw new Error(`Nicht erlaubtes Medienprotokoll: ${url.protocol}`);
  const invalidHosts = new Set(['0.0.0.0', '127.0.0.1', 'localhost', '::', '[::]']);
  if (cameraIp && (forceCameraHost || invalidHosts.has(url.hostname))) url.hostname = cameraIp;
  return url.toString();
}

function addCandidate(results, seen, url, reason) {
  const value = url.toString();
  if (seen.has(value)) return;
  seen.add(value);
  results.push({ uri: value, reason });
}

/**
 * Builds conservative endpoint fallbacks from one ONVIF GetStreamUri result.
 * Credentials are deliberately not added here.
 */
export function cameraMediaUriCandidates(rawUri, cameraIp) {
  const normalized = new URL(normalizeCameraUri(rawUri, cameraIp));
  normalized.username = '';
  normalized.password = '';
  const results = [];
  const seen = new Set();
  addCandidate(results, seen, normalized, 'onvif-uri-camera-host');

  if (['rtsp:', 'rtsps:'].includes(normalized.protocol)) {
    // A number of inexpensive cameras advertise the ONVIF HTTP port in their
    // RTSP URI. Try the advertised endpoint first, then the standard RTSP port.
    const advertisedPort = normalized.port || '554';
    if (advertisedPort !== '554') {
      const standardRtsp = new URL(normalized);
      standardRtsp.port = '554';
      addCandidate(results, seen, standardRtsp, 'rtsp-standard-port-fallback');
    }
  } else {
    // Some cameras return an HTTP device-service URL as media URI. Keep the
    // advertised URL for diagnostics, but also derive the conventional RTSP
    // endpoint with the same path. The caller only applies RTSP transport flags
    // to the RTSP candidate.
    const host = normalized.hostname.includes(':') ? `[${normalized.hostname}]` : normalized.hostname;
    const rtspFallback = new URL(`rtsp://${host}:554${normalized.pathname || '/'}${normalized.search || ''}`);
    addCandidate(results, seen, rtspFallback, 'http-to-rtsp-fallback');
  }

  return results;
}

export function safeMediaEndpoint(rawUri) {
  const url = new URL(rawUri);
  const defaultPort = ['rtsp:', 'rtsps:'].includes(url.protocol) ? '554' : url.protocol === 'https:' ? '443' : ['rtmp:', 'rtmps:'].includes(url.protocol) ? '1935' : url.protocol === 'srt:' ? '' : '80';
  return {
    scheme: url.protocol.replace(':', ''),
    host: url.hostname,
    port: url.port || defaultPort,
    path: (url.pathname || '/').slice(0, 500),
    queryKeys: [...url.searchParams.keys()].slice(0, 20),
  };
}

export function safePathPart(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}
