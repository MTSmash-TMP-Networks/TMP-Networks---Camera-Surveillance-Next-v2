import { db } from '../../db/database.js';
import { encryptSecret, decryptSecret } from '../credentialVault.js';

const SETTINGS_KEY = 'email_notifications_v1';
const PASSWORD_KEY = 'email_notifications_password_v1';
export const EMAIL_LANGUAGES = ['de','en','fr','es','it','nl','pl','pt-BR','tr','cs','da','sv','nb','fi','ro','hu','el','uk','ru','ar','zh-CN','zh-TW','ja','ko'];
export const DEFAULT_EMAIL_SETTINGS = Object.freeze({
  enabled: false, host: '', port: 587, security: 'starttls', username: '', fromName: 'TMP Camera Surveillance', fromAddress: '', recipients: [], language: 'en',
  rejectUnauthorized: true, cooldownSeconds: 60,
  rules: { motion: true, cameraStatus: true, streamFailures: true, recordingFailures: true, systemErrors: true, updateOperations: false },
});
function parse(value, fallback) { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function merge(value = {}) { return { ...DEFAULT_EMAIL_SETTINGS, ...value, rules: { ...DEFAULT_EMAIL_SETTINGS.rules, ...(value.rules || {}) } }; }
function getValue(key) { return db.prepare('SELECT value FROM system_settings WHERE key=?').get(key)?.value ?? null; }
function setValue(key, value) { db.prepare(`INSERT INTO system_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(key, value, new Date().toISOString()); }
export class NotificationSettingsService {
  get() { const settings = merge(parse(getValue(SETTINGS_KEY), {})); return { ...settings, passwordConfigured: Boolean(getValue(PASSWORD_KEY)) }; }
  transport() { const settings = this.get(); const encrypted = getValue(PASSWORD_KEY); return { ...settings, password: encrypted ? decryptSecret(encrypted) : '' }; }
  save(input = {}) {
    const current = this.get(); const next = merge({ ...current, ...input, rules: { ...current.rules, ...(input.rules || {}) } }); delete next.password; delete next.passwordConfigured; delete next.clearPassword;
    next.recipients = [...new Set((next.recipients || []).map((item) => String(item).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
    next.language = EMAIL_LANGUAGES.includes(next.language) ? next.language : 'en';
    setValue(SETTINGS_KEY, JSON.stringify(next));
    if (input.clearPassword) db.prepare('DELETE FROM system_settings WHERE key=?').run(PASSWORD_KEY);
    else if (typeof input.password === 'string' && input.password.length) setValue(PASSWORD_KEY, encryptSecret(input.password));
    return this.get();
  }
}
export const notificationSettingsService = new NotificationSettingsService();
