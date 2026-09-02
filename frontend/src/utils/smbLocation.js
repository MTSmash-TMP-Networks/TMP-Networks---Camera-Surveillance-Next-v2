/**
 * Parse common SMB locations copied from Windows, Synology File Station or a
 * browser-like smb:// URI. Plain host names/IP addresses intentionally return
 * null so the normal form-editing path remains untouched.
 */
export function parseSmbLocationText(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const isLocation = /^(?:smb:\/\/|\\\\|\/\/)/i.test(raw);
  const hostPortOnly = /^[^/\\]+:\d+$/.test(raw);
  if (!isLocation && !hostPortOnly) return null;

  const normalized = raw
    .replace(/^smb:\/\//i, '')
    .replace(/^\\\\/, '')
    .replace(/^\/\//, '')
    .replace(/\\/g, '/');

  const parts = normalized.split('/').filter(Boolean);
  let authority = parts.shift() || '';
  let port = 445;

  const bracketed = authority.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracketed) {
    authority = bracketed[1];
    if (bracketed[2]) port = Number(bracketed[2]);
  } else {
    const hostPort = authority.match(/^(.+):(\d+)$/);
    if (hostPort && !hostPort[1].includes(':')) {
      authority = hostPort[1];
      port = Number(hostPort[2]);
    }
  }

  return {
    host: authority,
    port,
    share: parts.shift() || '',
    basePath: parts.join('/'),
  };
}
