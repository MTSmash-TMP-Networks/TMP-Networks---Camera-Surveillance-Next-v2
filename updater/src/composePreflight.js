export function sanitizeComposeEnvValue(value) {
  return String(value ?? '').replace(/[\r\n\0]/g, '').trim();
}

export function quoteComposeEnvValue(value) {
  const sanitized = sanitizeComposeEnvValue(value);
  return `'${sanitized.replaceAll("'", "\\'")}'`;
}

export function renderComposeEnv(values, comments = []) {
  const header = comments.map((line) => `# ${sanitizeComposeEnvValue(line)}`);
  const entries = Object.entries(values).map(([key, value]) => {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new Error(`Ungültiger Compose-Umgebungsname: ${key}`);
    return `${key}=${quoteComposeEnvValue(value)}`;
  });
  return [...header, ...entries, ''].join('\n');
}

export function parseComposeVersion(output) {
  const match = String(output || '').match(/(?:^|\s)v?(\d+\.\d+\.\d+)(?:[-+\s]|$)/i);
  return match?.[1] || null;
}

export function isComposeQuietUnsupported(error) {
  const message = String(error?.message || error || '');
  return /unknown (?:flag|option).*--quiet|unknown shorthand flag.*['"]?q|flag provided but not defined.*quiet|no such option.*--quiet/i.test(message);
}

export function compactComposeError(error, maxLength = 1200) {
  const cleaned = String(error?.message || error || 'Unbekannter Compose-Fehler')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\b(authorization|token|password|secret|jwt|credential)(\s*[:=]\s*)([^\s,;&]+)/gi, '$1$2[REDACTED]')
    .replace(/([?&](?:token|password|secret|key)=)[^&#\s]+/gi, '$1[REDACTED]')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join(' | ');
  return cleaned.slice(0, maxLength);
}
