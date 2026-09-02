function ipv4ToInt(value) {
  const parts = String(value || '').trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

export function isPrivateDiscoveryIpv4(value) {
  const number = ipv4ToInt(value);
  if (number === null) return false;
  const first = number >>> 24;
  const second = (number >>> 16) & 255;
  if (first === 10) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 169 && second === 254) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 198 && (second === 18 || second === 19)) return true;
  return false;
}

/**
 * SSDP LOCATION is controlled by any device that can answer multicast probes.
 * Restrict it to a credential-free HTTP(S) URL on the exact private IPv4
 * address that sent the response. This prevents discovery from becoming an
 * arbitrary URL fetcher or credential-forwarding client.
 */
export function isSafeSsdpLocation(location, remoteAddress = null) {
  if (!location || String(location).length > 2048) return false;
  let parsed;
  try { parsed = new URL(String(location).trim()); } catch { return false; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return false;
  if (ipv4ToInt(parsed.hostname) === null || !isPrivateDiscoveryIpv4(parsed.hostname)) return false;
  if (remoteAddress) {
    const remoteNumber = ipv4ToInt(remoteAddress);
    if (remoteNumber === null || ipv4ToInt(parsed.hostname) !== remoteNumber) return false;
  }
  const port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
  return Number.isInteger(port) && port > 0 && port <= 65535;
}
