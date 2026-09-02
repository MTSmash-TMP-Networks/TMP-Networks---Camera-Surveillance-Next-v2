const ONVIF_MEDIA_ONLY_PORTS = new Set([554, 8554, 1935, 1936]);
const ONVIF_PORT_PRIORITY = [80, 8080, 8000, 8899, 2020, 443, 8443, 7681];

export function endpointPort(xaddr) {
  try {
    const parsed = new URL(String(xaddr || ''));
    return Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  } catch { return null; }
}

export function onvifProbeCandidates(input = {}) {
  const result = [];
  const seen = new Set();
  const push = (candidate, source) => {
    const port = Number(candidate.port || endpointPort(candidate.xaddr) || 80);
    const key = `${String(candidate.xaddr || '').trim()}|${port}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ ...input, ...candidate, port, probeSource: source });
  };

  if (String(input.xaddr || '').trim()) {
    push({ xaddr: String(input.xaddr).trim(), port: endpointPort(input.xaddr) || input.port || 80 }, 'discovery-xaddr');
  }

  const explicitPort = Number(input.port || 0);
  const ports = [...new Set([explicitPort, ...(input.openPorts || []).map(Number)])]
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535 && !ONVIF_MEDIA_ONLY_PORTS.has(port));
  ports.sort((a, b) => {
    if (a === explicitPort && b !== explicitPort) return -1;
    if (b === explicitPort && a !== explicitPort) return 1;
    const ai = ONVIF_PORT_PRIORITY.indexOf(a); const bi = ONVIF_PORT_PRIORITY.indexOf(b);
    if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    return a - b;
  });
  for (const port of ports.slice(0, 10)) push({ port, xaddr: null }, port === explicitPort ? 'selected-port' : 'open-port');
  if (!result.length) push({ port: explicitPort || 80, xaddr: null }, 'default-port');
  return result;
}
