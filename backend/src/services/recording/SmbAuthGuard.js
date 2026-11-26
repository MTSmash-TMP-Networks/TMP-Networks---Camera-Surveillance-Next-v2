import { createHash } from 'node:crypto';
import { AppError } from '../../utils/errors.js';

export const SMB_AUTH_COOLDOWN_MS = 60 * 60 * 1000;
export const SMB_AUTH_FAILED = 'NETWORK_STORAGE_AUTH_FAILED';
export const SMB_AUTH_COOLDOWN = 'NETWORK_STORAGE_AUTH_COOLDOWN';

export function isSmbAuthenticationFailure(output) {
  return /session setup failed:\s*nt_status_access_denied\b|nt_status_(?:logon_failure|wrong_password|no_such_user|account_locked_out|account_disabled|account_expired|account_restriction|password_expired|password_must_change|invalid_logon_hours|invalid_workstation|logon_type_not_granted|invalid_account_name|authentication_firewall_failed)\b|logon failure|authentication failed|invalid password|login failed|account (?:is )?locked(?: out)?|password (?:has )?expired/i.test(String(output || ''));
}
export function isSmbAuthPause(error) {
  return error?.code === SMB_AUTH_FAILED || error?.code === SMB_AUTH_COOLDOWN;
}

// Share the barrier across all accounts, shares and old storage profiles on
// the configured SMB server, including different SMB ports. No credentials
// are used in the key or persisted in the cooldown record.
export function smbServerKey(profile) {
  return String(profile?.host || '').trim().toLowerCase().replace(/\.$/, '');
}
const settingKey = (key) => 'recording_smb_auth_cooldown_v1:' + createHash('sha256').update(key).digest('hex');

export class SmbAuthGuard {
  constructor(db, { now = Date.now, onPause = () => {}, onPersistError = () => {} } = {}) {
    this.db = db;
    this.now = now;
    this.onPause = onPause;
    this.onPersistError = onPersistError;
    this.memory = new Map();
    this.tails = new Map();
  }

  status(profile) {
    if (profile?.protocol !== 'smb') return null;
    const key = smbServerKey(profile);
    if (!key) return null;
    const persisted = Number(this.db.prepare('SELECT value FROM system_settings WHERE key=?').get(settingKey(key))?.value || 0);
    const until = Math.max(Number.isFinite(persisted) ? persisted : 0, this.memory.get(key) || 0);
    if (until <= this.now()) {
      this.memory.delete(key);
      return null;
    }
    return { host: key, retryAt: new Date(until).toISOString(), remainingMs: until - this.now() };
  }

  assertAvailable(profile) {
    const status = this.status(profile);
    if (status) throw new AppError(429, SMB_AUTH_COOLDOWN,
      'SMB-Anmeldung nach Authentifizierungsfehler zum Kontoschutz pausiert.', { retryAt: status.retryAt });
  }

  pause(profile) {
    const key = smbServerKey(profile);
    const until = this.now() + SMB_AUTH_COOLDOWN_MS;
    this.memory.set(key, until);
    const retryAt = new Date(until).toISOString();
    // Keep the in-process barrier even if the disk is too full for SQLite.
    try {
      this.db.prepare('INSERT INTO system_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at')
        .run(settingKey(key), String(until), new Date(this.now()).toISOString());
    } catch (error) { this.onPersistError(error); }
    this.onPause({ host: key, retryAt });
  }

  async run(profile, operation) {
    this.assertAvailable(profile);
    const key = smbServerKey(profile);
    // smbclient opens a new authenticated session for every invocation.
    // Serializing those invocations per server prevents concurrent workers
    // from causing a burst of login failures before the barrier is recorded.
    const previous = this.tails.get(key) || Promise.resolve();
    const result = previous.then(async () => {
      this.assertAvailable(profile);
      try { return await operation(); }
      catch (error) {
        if (error?.code === SMB_AUTH_FAILED) this.pause(profile);
        throw error;
      }
    });
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(key, tail);
    try { return await result; }
    finally { if (this.tails.get(key) === tail) this.tails.delete(key); }
  }
}
