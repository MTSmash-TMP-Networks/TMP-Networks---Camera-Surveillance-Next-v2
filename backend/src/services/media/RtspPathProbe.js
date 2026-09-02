import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { config } from '../../config.js';

const CAMERA_USER_AGENT = `TMP-Camera-Surveillance/${config.appVersion}`;

function hash(algorithm, value) {
  const normalized = String(algorithm || 'MD5').toLowerCase().replace('-sess', '');
  const supported = normalized === 'sha-256' ? 'sha256' : 'md5';
  return crypto.createHash(supported).update(value).digest('hex');
}

export function parseAuthChallenge(value = '') {
  const text = String(value || '').trim();
  const schemeMatch = text.match(/^(Digest|Basic)\s+/i);
  if (!schemeMatch) return null;
  const scheme = schemeMatch[1].toLowerCase();
  const params = {};
  const remainder = text.slice(schemeMatch[0].length);
  const expression = /([A-Za-z0-9_-]+)\s*=\s*(?:"((?:\\.|[^"])*)"|([^,\s]+))/g;
  for (const match of remainder.matchAll(expression)) {
    params[match[1].toLowerCase()] = (match[2] ?? match[3] ?? '').replace(/\\"/g, '"');
  }
  return { scheme, params };
}

export function buildAuthorization(challenge, { username = '', password = '', method, uri, nonceCount = 1, cnonce = null } = {}) {
  if (!challenge || !username) return null;
  if (challenge.scheme === 'basic') return `Basic ${Buffer.from(`${username}:${password || ''}`).toString('base64')}`;
  if (challenge.scheme !== 'digest') return null;
  const realm = challenge.params.realm || '';
  const nonce = challenge.params.nonce || '';
  if (!nonce) return null;
  const algorithm = challenge.params.algorithm || 'MD5';
  const qops = String(challenge.params.qop || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  const qop = qops.includes('auth') ? 'auth' : null;
  const nc = Number(nonceCount || 1).toString(16).padStart(8, '0');
  const clientNonce = cnonce || crypto.randomBytes(8).toString('hex');
  let ha1 = hash(algorithm, `${username}:${realm}:${password || ''}`);
  if (/sess$/i.test(algorithm)) ha1 = hash(algorithm, `${ha1}:${nonce}:${clientNonce}`);
  const ha2 = hash(algorithm, `${method}:${uri}`);
  const response = qop
    ? hash(algorithm, `${ha1}:${nonce}:${nc}:${clientNonce}:${qop}:${ha2}`)
    : hash(algorithm, `${ha1}:${nonce}:${ha2}`);
  const values = [
    `username="${String(username).replaceAll('"', '\\"')}"`,
    `realm="${String(realm).replaceAll('"', '\\"')}"`,
    `nonce="${String(nonce).replaceAll('"', '\\"')}"`,
    `uri="${String(uri).replaceAll('"', '\\"')}"`,
    `response="${response}"`,
  ];
  if (algorithm) values.push(`algorithm=${algorithm}`);
  if (challenge.params.opaque) values.push(`opaque="${challenge.params.opaque}"`);
  if (qop) values.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${clientNonce}"`);
  return `Digest ${values.join(', ')}`;
}

export function parseRtspResponse(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
  const separator = text.indexOf('\r\n\r\n') >= 0 ? '\r\n\r\n' : '\n\n';
  const splitAt = text.indexOf(separator);
  const headerText = splitAt >= 0 ? text.slice(0, splitAt) : text;
  const body = splitAt >= 0 ? text.slice(splitAt + separator.length) : '';
  const lines = headerText.split(/\r?\n/);
  const status = lines.shift()?.match(/^RTSP\/\d(?:\.\d)?\s+(\d{3})(?:\s+(.*))?$/i);
  const headers = {};
  for (const line of lines) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
  }
  return {
    statusCode: status ? Number(status[1]) : null,
    statusText: status?.[2] || '',
    headers,
    body,
  };
}

function readResponse(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let completed = false;
    let quietTimer = null;
    const finish = (error = null) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      clearTimeout(quietTimer);
      socket.destroy();
      if (error) reject(error);
      else resolve(Buffer.concat(chunks));
    };
    const timeout = setTimeout(() => finish(new Error('RTSP-Antwortzeit überschritten')), timeoutMs);
    socket.on('data', (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total > 2 * 1024 * 1024) return finish(new Error('RTSP-Antwort ist zu groß'));
      const buffer = Buffer.concat(chunks);
      const text = buffer.toString('latin1');
      const boundary = text.indexOf('\r\n\r\n');
      if (boundary >= 0) {
        const header = text.slice(0, boundary);
        const length = Number(header.match(/\r\nContent-Length:\s*(\d+)/i)?.[1] || 0);
        if (buffer.length >= boundary + 4 + length) return finish();
        clearTimeout(quietTimer);
        quietTimer = setTimeout(() => finish(), 180);
      }
    });
    socket.once('end', () => finish());
    socket.once('error', (error) => finish(error));
  });
}

async function requestRtsp(url, { method = 'DESCRIBE', authorization = null, timeoutMs = 2200, cseq = 1 } = {}) {
  const parsed = new URL(url);
  const secure = parsed.protocol === 'rtsps:';
  const port = Number(parsed.port || (secure ? 322 : 554));
  const socket = secure
    ? tls.connect({ host: parsed.hostname, port, rejectUnauthorized: false })
    : net.createConnection({ host: parsed.hostname, port });
  const connected = new Promise((resolve, reject) => {
    socket.setTimeout(timeoutMs, () => reject(new Error('RTSP-Verbindung hat das Zeitlimit überschritten')));
    socket.once(secure ? 'secureConnect' : 'connect', resolve);
    socket.once('error', reject);
  });
  await connected;
  socket.setTimeout(0);
  const headers = [
    `${method} ${url} RTSP/1.0`,
    `CSeq: ${cseq}`,
    `User-Agent: ${CAMERA_USER_AGENT}`,
    'Accept: application/sdp',
    'Connection: close',
  ];
  if (authorization) headers.push(`Authorization: ${authorization}`);
  socket.write(`${headers.join('\r\n')}\r\n\r\n`);
  return parseRtspResponse(await readResponse(socket, timeoutMs));
}

function classify(response, authenticated = false) {
  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  const hasVideo = /(?:^|\r?\n)m=video\s+/im.test(response.body || '');
  return {
    statusCode: response.statusCode,
    statusText: response.statusText,
    server: response.headers.server || null,
    publicMethods: response.headers.public || null,
    contentType: contentType || null,
    authenticated,
    hasVideo,
    validPath: response.statusCode === 200 && hasVideo,
    sdpBytes: Buffer.byteLength(response.body || ''),
  };
}

export class RtspPathProbe {
  constructor({ username = '', password = '', timeoutMs = 2200 } = {}) {
    this.username = username;
    this.password = password;
    this.timeoutMs = timeoutMs;
    this.challengeByAuthority = new Map();
    this.nonceCount = 0;
  }

  async describe(url) {
    const parsed = new URL(url);
    const authority = `${parsed.protocol}//${parsed.host}`;
    let challenge = this.challengeByAuthority.get(authority) || null;
    let authorization = challenge ? buildAuthorization(challenge, {
      username: this.username,
      password: this.password,
      method: 'DESCRIBE',
      uri: url,
      nonceCount: ++this.nonceCount,
    }) : null;
    let response = await requestRtsp(url, { authorization, timeoutMs: this.timeoutMs, cseq: 1 });
    if (response.statusCode === 401 && response.headers['www-authenticate']) {
      challenge = parseAuthChallenge(response.headers['www-authenticate']);
      if (challenge) this.challengeByAuthority.set(authority, challenge);
      authorization = buildAuthorization(challenge, {
        username: this.username,
        password: this.password,
        method: 'DESCRIBE',
        uri: url,
        nonceCount: ++this.nonceCount,
      });
      if (authorization) response = await requestRtsp(url, { authorization, timeoutMs: this.timeoutMs, cseq: 2 });
      // Einige ältere OEM-Kameras vergleichen im Digest-Header nur Pfad und Query,
      // obwohl die RTSP-Request-Line die absolute URI enthält.
      if (response.statusCode === 401 && challenge?.scheme === 'digest') {
        const shortUri = `${parsed.pathname || '/'}${parsed.search || ''}`;
        const legacyAuthorization = buildAuthorization(challenge, {
          username: this.username,
          password: this.password,
          method: 'DESCRIBE',
          uri: shortUri,
          nonceCount: ++this.nonceCount,
        });
        if (legacyAuthorization) response = await requestRtsp(url, { authorization: legacyAuthorization, timeoutMs: this.timeoutMs, cseq: 3 });
      }
    }
    return {
      ...classify(response, Boolean(authorization)),
      authScheme: challenge?.scheme || null,
      authRequired: response.statusCode === 401 || Boolean(challenge),
    };
  }
}
