import crypto from 'node:crypto';
import { db } from '../db/database.js';
import { encryptSecret, decryptSecret } from './credentialVault.js';
import { logger } from '../utils/logger.js';

const PORTAL_URL = 'https://support.tmp-networks.de/cam/index.php';
const SETTINGS_KEY = 'remote_https_proxy_v1';
const ID_KEY = 'remote_https_proxy_installation_id_v1';
const MAX_RESPONSE_BYTES = 2_500_000;
const MAX_BODY_BYTES = 128_000;
const WORKERS = 3;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function allowedProxyRequest(method, pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') ||
      pathname.startsWith('//') || pathname.includes('\\') ||
      /%2f|%5c|%00|\.\./i.test(pathname)) return false;
  let path;
  try {
    const parsed = new URL(pathname, 'http://camera.internal');
    if (parsed.origin !== 'http://camera.internal') return false;
    path = parsed.pathname;
  } catch { return false; }
  if (method === 'POST') return path === '/api/auth/login';
  if (method !== 'GET') return false;
  return path === '/api/cameras'
    || /^\/api\/streams\/[A-Za-z0-9_-]{1,90}\/preview$/.test(path)
    || /^\/api\/cameras\/[A-Za-z0-9_-]{1,90}\/thumbnail$/.test(path)
    || /^\/live-hls\/[A-Za-z0-9_.-]{1,180}\/(?:index\.m3u8|seg_[0-9]+\.ts)$/.test(path);
}
function readSetting(key) {
  try { return db.prepare('SELECT value FROM system_settings WHERE key=?').get(key)?.value || ''; }
  catch { return ''; }
}
function writeSetting(key, value) {
  db.prepare(`INSERT INTO system_settings (key,value,updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(key, value, new Date().toISOString());
}
function storedState() {
  try { return JSON.parse(readSetting(SETTINGS_KEY) || '{}'); }
  catch { return {}; }
}
async function postPortal(kind, identity, payload, timeoutMs = 12_000) {
  const url = new URL(PORTAL_URL);
  url.searchParams.set('agent', kind);
  if (kind !== 'register') url.searchParams.set('id', identity.id);
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'Content-Type': 'application/json',
      ...(kind !== 'register' ? { Authorization: `Bearer ${identity.key}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`PORTAL_HTTP_${response.status}`);
  return response.json();
}

export class RemoteProxyService {
  constructor() { this.running = false; this.generation = 0; this.lastContactAt = null; this.lastError = null; this.lastAgentJobs = 0; }
  installationId() {
    let id = readSetting(ID_KEY);
    if (/^[0-9a-f-]{36}$/.test(id)) return id;
    id = crypto.randomUUID();
    writeSetting(ID_KEY, id);
    return id;
  }
  status() {
    const state = storedState();
    return {
      installationId: this.installationId(),
      enabled: state.enabled === true,
      paired: state.paired === true,
      portalUrl: 'https://support.tmp-networks.de/cam',
      lastContactAt: this.lastContactAt,
      lastError: this.lastError,
      jobsServed: this.lastAgentJobs,
      outboundOnly: true,
    };
  }
  configure({ enabled, pairingCode }) {
    const state = storedState();
    if (typeof enabled !== 'boolean') throw new Error('enabled muss boolean sein');
    if (pairingCode !== undefined) {
      if (!/^[a-f0-9]{48}$/i.test(String(pairingCode))) throw new Error('Kopplungscode ungueltig');
      state.pairingCodeEncrypted = encryptSecret(pairingCode.toLowerCase());
      state.agentKeyEncrypted = encryptSecret(crypto.randomBytes(32).toString('base64url'));
      state.paired = false;
    }
    if (enabled && !state.paired && !state.pairingCodeEncrypted) throw new Error('Zuerst einmaligen Portal-Kopplungscode eingeben');
    state.enabled = enabled;
    writeSetting(SETTINGS_KEY, JSON.stringify(state));
    this.generation++;
    if (enabled) this.start();
    return this.status();
  }
  start() {
    if (this.running) return;
    const state = storedState();
    if (!state.enabled) return;
    this.running = true;
    void this.run().finally(() => {
      this.running = false;
      if (storedState().enabled) setTimeout(() => this.start(), 3000).unref?.();
    });
  }
  stop() {
    this.generation++;
    const state = storedState();
    if (state.enabled) { state.enabled = false; writeSetting(SETTINGS_KEY, JSON.stringify(state)); }
  }
  async run() {
    const generation = this.generation;
    let state = storedState();
    if (!state.enabled) return;
    const id = this.installationId();
    let key;
    try { key = decryptSecret(state.agentKeyEncrypted); }
    catch { this.lastError = 'AGENT_SECRET_UNAVAILABLE'; return; }
    if (!key) { this.lastError = 'AGENT_SECRET_MISSING'; return; }
    const identity = { id, key };
    if (!state.paired) {
      try {
        const code = decryptSecret(state.pairingCodeEncrypted);
        if (!code) throw new Error('PAIRING_CODE_MISSING');
        await postPortal('register', identity, { id, code, key, label: 'TMP Camera Server' });
        state = storedState();
        state.paired = true;
        delete state.pairingCodeEncrypted;
        writeSetting(SETTINGS_KEY, JSON.stringify(state));
        this.lastError = null;
        this.lastContactAt = new Date().toISOString();
        logger.info({ installationId: id }, 'HTTPS-Kameraproxy erfolgreich gekoppelt');
      } catch (error) {
        this.lastError = String(error?.message || error).slice(0,100);
        logger.warn({ code: this.lastError }, 'HTTPS-Kameraproxy-Kopplung fehlgeschlagen');
        return;
      }
    }
    await Promise.all(Array.from({ length: WORKERS }, () => this.pollWorker(identity, generation)));
  }
  async pollWorker(identity, generation) {
    let failures = 0;
    while (generation === this.generation && storedState().enabled) {
      try {
        const url = new URL(PORTAL_URL);
        url.searchParams.set('agent', 'poll');
        url.searchParams.set('id', identity.id);
        const response = await fetch(url, {
          redirect: 'error',
          headers: { Authorization: `Bearer ${identity.key}` },
          signal: AbortSignal.timeout(12_000),
        });
        if (response.status !== 200 && response.status !== 204) throw new Error(`PORTAL_POLL_HTTP_${response.status}`);
        failures = 0;
        this.lastContactAt = new Date().toISOString();
        this.lastError = null;
        if (response.status === 200) await this.processJob(identity, await response.json());
        else await pause(800);
      } catch (error) {
        this.lastError = String(error?.message || error).slice(0,100);
        failures++;
        await pause(Math.min(30_000, 1000 * (2 ** Math.min(5, failures))));
      }
    }
  }
  async processJob(identity, job) {
    if (!/^[0-9a-f]{32}$/.test(String(job?.id || ''))) return;
    let code = 403, type = 'application/json', data = Buffer.from('{"error":"FORBIDDEN"}');
    const method = String(job.method || '');
    const path = String(job.path || '');
    if (allowedProxyRequest(method, path)) {
      try {
        const url = new URL(path, 'http://frontend:8080');
        if (url.origin !== 'http://frontend:8080') throw new Error('INVALID_ORIGIN');
        const token = String(job.token || '');
        if (token.length > 8192) throw new Error('TOKEN_TOO_LONG');
        const body = job.body ? Buffer.from(String(job.body), 'base64') : null;
        if (body && body.byteLength > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE');
        const response = await fetch(url, {
          method, redirect: 'manual', signal: AbortSignal.timeout(15_000),
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: method === 'POST' ? body : undefined,
        });
        const statedLength = Number(response.headers.get('content-length') || 0);
        if (statedLength > MAX_RESPONSE_BYTES) throw new Error('RESPONSE_TOO_LARGE');
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > MAX_RESPONSE_BYTES) throw new Error('RESPONSE_TOO_LARGE');
        code = response.status;
        type = (response.headers.get('content-type') || 'application/octet-stream').slice(0,100);
        data = bytes;
      } catch (error) {
        code = 502;
        data = Buffer.from(JSON.stringify({ error: String(error?.message || error).slice(0,70) }));
      }
    }
    try {
      await postPortal('result', identity, {
        id: job.id, code, type, data: data.toString('base64'),
      }, 18_000);
      this.lastAgentJobs++;
    } catch (error) {
      this.lastError = `RESULT_${String(error?.message || error).slice(0,80)}`;
    }
  }
}
export const remoteProxyService = new RemoteProxyService();
