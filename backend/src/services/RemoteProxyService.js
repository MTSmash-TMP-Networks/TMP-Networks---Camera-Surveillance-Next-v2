import crypto from 'node:crypto';
import { db } from '../db/database.js';
import { encryptSecret, decryptSecret } from './credentialVault.js';
import { logger } from '../utils/logger.js';
import { allowedProxyRequest } from './remoteProxyPolicy.js';
import { encodeRemoteProxyResult, REMOTE_PROXY_MAX_RESPONSE_BYTES } from './remoteProxyTransfer.js';

const PORTAL_URL = 'https://support.tmp-networks.de/cam/index.php';
const SETTINGS_KEY = 'remote_https_proxy_v1';
const ID_KEY = 'remote_https_proxy_installation_id_v1';
const MAX_RESPONSE_BYTES = REMOTE_PROXY_MAX_RESPONSE_BYTES;
const MAX_BODY_BYTES = 128_000;
const WORKERS = 3;
const AUTO_REGISTRATION_PROTOCOL = 2;
const CLOUD_AUTO_ENABLE_MIGRATION = 1; // 2.20.86: enable older disabled installations once
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
// Automatic enrollment is opt-in at the PRODUCT level. An installed server
// keeps its generated identity and encrypted device key across normal updates.
// Unlike the v1 installer, no human-entered pairing code is necessary.
function ensureAutomaticState() {
  const state = storedState();
  let changed = false;
  if (!state.agentKeyEncrypted) {
    state.agentKeyEncrypted = encryptSecret(crypto.randomBytes(32).toString('base64url'));
    state.paired = false;
    changed = true;
  }
  if (state.autoRegistrationV2 !== true) {
    state.autoRegistrationV2 = true;
    changed = true;
  }
  // 2.20.86 performs exactly one automatic switch-on for legacy installations.
  // A later explicit local administrator disable remains respected on restarts.
  if (state.cloudAutoEnableMigration !== CLOUD_AUTO_ENABLE_MIGRATION) {
    state.enabled = true;
    state.cloudAutoEnableMigration = CLOUD_AUTO_ENABLE_MIGRATION;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(state, 'pairingCodeEncrypted')) {
    delete state.pairingCodeEncrypted;
    changed = true;
  }
  if (changed) writeSetting(SETTINGS_KEY, JSON.stringify(state));
  return state;
}

async function postPortal(kind, identity, payload, timeoutMs = 25_000) {
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
  constructor() {
    this.running = false;
    this.generation = 0;
    this.shuttingDown = false;
    this.lastContactAt = null;
    this.lastError = null;
    this.lastAgentJobs = 0;
  }
  installationId() {
    let id = readSetting(ID_KEY);
    if (/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)) return id;
    id = crypto.randomUUID();
    writeSetting(ID_KEY, id);
    return id;
  }
  status() {
    const state = ensureAutomaticState();
    return {
      installationId: this.installationId(),
      enabled: state.enabled !== false,
      paired: state.paired === true,
      automaticRegistration: true,
      portalUrl: 'https://support.tmp-networks.de/cam',
      lastContactAt: this.lastContactAt,
      lastError: this.lastError,
      jobsServed: this.lastAgentJobs,
      outboundOnly: true,
    };
  }
  configure({ enabled }) {
    if (typeof enabled !== 'boolean') throw new Error('enabled muss boolean sein');
    const state = ensureAutomaticState();
    state.enabled = enabled;
    writeSetting(SETTINGS_KEY, JSON.stringify(state));
    this.generation++;
    if (enabled) this.start();
    return this.status();
  }
  start() {
    if (this.running || this.shuttingDown) return;
    const state = ensureAutomaticState();
    if (state.enabled === false) return;
    this.running = true;
    void this.run().catch((error) => {
      this.lastError = String(error?.message || error).slice(0,100);
      logger.warn({ code: this.lastError }, 'Automatische HTTPS-Kamera-Registrierung fehlgeschlagen');
    }).finally(() => {
      this.running = false;
      if (!this.shuttingDown && ensureAutomaticState().enabled !== false) {
        setTimeout(() => this.start(), 5000).unref?.();
      }
    });
  }
  stop() {
    // Preserve the user setting and permanent installation key on updates.
    this.shuttingDown = true;
    this.generation++;
  }
  async run() {
    const generation = this.generation;
    let state = ensureAutomaticState();
    if (state.enabled === false) return;
    const id = this.installationId();
    let key;
    try { key = decryptSecret(state.agentKeyEncrypted); }
    catch { this.lastError = 'DEVICE_KEY_UNAVAILABLE'; return; }
    // Never silently rotate a key when decryption fails: this could permit
    // an identity takeover on the cloud side.
    if (!key || key.length < 42) { this.lastError = 'DEVICE_KEY_INVALID'; return; }
    const identity = { id, key };
    if (!state.paired) {
      try {
        // Registration uses first-claim pinning: an existing ID may only be
        // refreshed by the same device key; blocked IDs cannot self-unblock.
        await postPortal('register', identity, {
          id, key, protocol: AUTO_REGISTRATION_PROTOCOL,
        });
        state = ensureAutomaticState();
        state.paired = true;
        writeSetting(SETTINGS_KEY, JSON.stringify(state));
        this.lastError = null;
        this.lastContactAt = new Date().toISOString();
        logger.info({ installationId: id, protocol: 2 }, 'Kamera-Installation automatisch am HTTPS-Portal angemeldet');
      } catch (error) {
        this.lastError = String(error?.message || error).slice(0,100);
        logger.warn({ code: this.lastError }, 'Automatische HTTPS-Kamera-Registrierung fehlgeschlagen');
        return;
      }
    }
    await Promise.all(Array.from({ length: WORKERS }, () => this.pollWorker(identity, generation)));
  }
  async pollWorker(identity, generation) {
    let failures = 0;
    while (generation === this.generation && ensureAutomaticState().enabled !== false) {
      try {
        const url = new URL(PORTAL_URL);
        url.searchParams.set('agent', 'poll');
        url.searchParams.set('id', identity.id);
        const response = await fetch(url, {
          redirect: 'error',
          headers: { Authorization: `Bearer ${identity.key}` },
          signal: AbortSignal.timeout(25_000),
        });
        if (response.status === 401) {
          const state = ensureAutomaticState();
          state.paired = false;
          writeSetting(SETTINGS_KEY, JSON.stringify(state));
          throw new Error('PORTAL_AGENT_REENROLL_REQUIRED');
        }
        if (response.status !== 200 && response.status !== 204) throw new Error(`PORTAL_POLL_HTTP_${response.status}`);
        failures = 0;
        this.lastContactAt = new Date().toISOString();
        this.lastError = null;
        if (response.status === 200) await this.processJob(identity, await response.json());
        else await pause(800);
      } catch (error) {
        this.lastError = 'POLL_' + String(error?.message || error).slice(0,92);
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
          method, redirect: 'manual', signal: AbortSignal.timeout(/^\/api\/recordings\/[1-9][0-9]*\/cloud\/download\/\d+\.mp4$/.test(url.pathname) ? 24_000 : 15_000),
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
      const uploads = encodeRemoteProxyResult(job.id, code, type, data);
      for (const upload of uploads) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await postPortal(upload.kind, identity, upload.payload, 28_000);
            break;
          } catch (error) {
            const reason = String(error?.message || error);
            // Authentication, revocation, or an invalid request cannot recover by retry.
            if (attempt >= 2 || /PORTAL_HTTP_(?:400|401|403|404|409|413|426)/.test(reason)) throw error;
            await pause(500 * (attempt + 1));
          }
        }
      }
      this.lastAgentJobs++;
      this.lastError = null;
    } catch (error) {
      this.lastError = 'RESULT_' + String(error?.message || error).slice(0,80);
      logger.warn({ issueCode: 'CLOUD_MEDIA_RESULT_FAILED', code: this.lastError, jobId: String(job.id).slice(0,8) }, 'HTTPS-Kamera-Medienantwort konnte nicht uebertragen werden');
    }
  }
}
export const remoteProxyService = new RemoteProxyService();
