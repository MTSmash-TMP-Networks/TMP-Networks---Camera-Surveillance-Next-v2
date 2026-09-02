import net from 'node:net';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const ENCODED_PATH_SEPARATOR = /%(?:2e|2f|5c)/i;

function values(input) {
  if (Array.isArray(input)) return input.flatMap((item) => values(item));
  return String(input || '')
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function validatePath(value, subject) {
  const text = String(value || '');
  if (ENCODED_PATH_SEPARATOR.test(text)) throw new Error(`${subject} enthält nicht zulässige kodierte Pfadbestandteile`);
  let decoded;
  try { decoded = decodeURIComponent(text); } catch { throw new Error(`${subject} ist nicht korrekt URL-kodiert`); }
  if (decoded.includes('\\') || /[\u0000-\u001f\u007f]/.test(decoded)) throw new Error(`${subject} enthält nicht zulässige Zeichen`);
  if (decoded.split('/').some((part) => part === '.' || part === '..')) throw new Error(`${subject} enthält einen nicht zulässigen Pfadwechsel`);
}

function normalizeServiceHost(input) {
  const value = String(input || '').trim();
  if (!value) throw new Error('Der Service-Name fehlt');
  const unwrapped = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  if (net.isIP(unwrapped)) return unwrapped.includes(':') ? `[${unwrapped}]` : unwrapped;
  if (value.length > 253 || value.includes('..')) throw new Error('Der Service-Name ist ungültig');
  const labels = value.split('.');
  if (labels.some((label) => !/^[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$/.test(label))) {
    throw new Error('Der Service-Name darf nur gültige DNS- oder Compose-Zeichen enthalten');
  }
  return value;
}

function normalizeBasePath(value) {
  const text = String(value || '').trim();
  if (!text || text === '/') return '';
  if (!text.startsWith('/') || text.includes('?') || text.includes('#')) throw new Error('Der Service-Basispfad ist ungültig');
  validatePath(text, 'Der Service-Basispfad');
  return text.replace(/\/+$/, '');
}

function normalizeBaseUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Die Updater-URL ist leer');
  if (/[\u0000-\u001f\u007f]/.test(raw)) throw new Error('Die Updater-URL enthält nicht zulässige Zeichen');
  const parsed = new URL(raw);
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) throw new Error('Nur HTTP- und HTTPS-Endpunkte sind zulässig');
  if (parsed.username || parsed.password) throw new Error('Zugangsdaten dürfen nicht Bestandteil der Updater-URL sein');
  if (parsed.search || parsed.hash) throw new Error('Query-Parameter und Fragmente sind in der Updater-Basis-URL nicht zulässig');
  if (!parsed.hostname) throw new Error('Die Updater-URL enthält keinen Hostnamen');
  const withoutScheme = raw.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, '');
  const pathStart = withoutScheme.indexOf('/');
  validatePath(pathStart >= 0 ? withoutScheme.slice(pathStart) : '', 'Der URL-Pfad');
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

function endpointCandidate(value, source, index, displayName) {
  return { transport: 'http', value, source, id: `${source}-${index + 1}`, displayName };
}

function socketCandidate(value) {
  return { transport: 'unix', value, source: 'local-ipc', id: 'local-ipc-1', displayName: 'Lokaler IPC-Kanal' };
}

function normalizeSocketPath(input) {
  const value = String(input || '').trim();
  if (!value) throw new Error('Der lokale IPC-Pfad ist leer');
  if (!value.startsWith('/')) throw new Error('Der lokale IPC-Pfad muss absolut sein');
  if (value.length > 240 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Der lokale IPC-Pfad ist ungültig');
  const parts = value.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) throw new Error('Der lokale IPC-Pfad enthält einen nicht zulässigen Pfadwechsel');
  return value;
}

export function resolveUpdaterEndpoints(settings) {
  const candidates = [];
  values(settings.updaterUrls).forEach((value, index) => {
    candidates.push(endpointCandidate(value, 'configured', index, `Konfigurierter Endpunkt ${index + 1}`));
  });

  if (String(settings.updaterUrl || '').trim()) {
    candidates.push(endpointCandidate(settings.updaterUrl, 'legacy', 0, 'Kompatibilitäts-Endpunkt'));
  }

  if (String(settings.updaterSocketPath || '').trim()) {
    candidates.push(socketCandidate(settings.updaterSocketPath));
  }

  const serviceName = String(settings.updaterServiceName || '').trim();
  if (serviceName) {
    try {
      const protocol = String(settings.updaterServiceProtocol || 'http').trim().replace(/:$/, '').toLowerCase();
      if (!['http', 'https'].includes(protocol)) throw new Error('Das Service-Protokoll muss http oder https sein');
      const port = Number(settings.updaterServicePort || 3010);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Der Service-Port ist ungültig');
      const host = normalizeServiceHost(serviceName);
      const basePath = normalizeBasePath(settings.updaterServiceBasePath);
      candidates.push(endpointCandidate(`${protocol}://${host}:${port}${basePath}`, 'service-discovery', 0, 'Interne Service Discovery'));
    } catch (error) {
      candidates.push({
        source: 'service-discovery-error',
        id: 'service-discovery-error-1',
        displayName: 'Interne Service Discovery',
        configurationError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const fallbacks = [...values(settings.updaterFallbackUrls), ...values(settings.updaterFallbackUrl)];
  fallbacks.forEach((value, index) => {
    candidates.push(endpointCandidate(value, 'fallback', index, `Fallback-Endpunkt ${index + 1}`));
  });

  const endpoints = [];
  const issues = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (candidate.configurationError) {
      issues.push({ source: candidate.source, endpoint: candidate.displayName, code: 'UPDATER_CONFIGURATION_INVALID', message: candidate.configurationError });
      continue;
    }
    try {
      if (candidate.transport === 'unix') {
        const socketPath = normalizeSocketPath(candidate.value);
        const identity = `unix:${socketPath}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        endpoints.push({
          id: candidate.id,
          source: candidate.source,
          displayName: candidate.displayName,
          transport: 'unix',
          socketPath,
          safeTarget: 'unix://local-updater',
        });
        continue;
      }
      const baseUrl = normalizeBaseUrl(candidate.value);
      if (seen.has(baseUrl)) continue;
      seen.add(baseUrl);
      const parsed = new URL(baseUrl);
      endpoints.push({
        id: candidate.id,
        source: candidate.source,
        displayName: candidate.displayName,
        transport: 'http',
        baseUrl,
        safeTarget: `${parsed.protocol}//${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`,
      });
    } catch (error) {
      issues.push({ source: candidate.source, endpoint: candidate.displayName, code: 'UPDATER_CONFIGURATION_INVALID', message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { endpoints, issues };
}

export function joinUpdaterEndpoint(baseUrl, endpointPath) {
  const parsed = new URL(baseUrl);
  const suffix = String(endpointPath || '').replace(/^\/+/, '');
  const prefix = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
  parsed.pathname = `${prefix}/${suffix}`.replace(/\/{2,}/g, '/');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}
