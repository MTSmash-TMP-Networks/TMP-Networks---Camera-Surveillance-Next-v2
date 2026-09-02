import bcrypt from 'bcryptjs';
import { db } from '../db/database.js';
import { DemoUserService } from './DemoUserService.js';

const SETTINGS_KEY = 'public_demo_mode_v2';
const DEFAULT_SETTINGS = Object.freeze({ enabled: false, allowExports: false });
const demoUserService = new DemoUserService(db, { hashPassword: (password) => bcrypt.hashSync(password, 12) });

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parse(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function merge(value = {}) {
  return {
    enabled: Boolean(value.enabled ?? DEFAULT_SETTINGS.enabled),
    allowExports: Boolean(value.allowExports ?? DEFAULT_SETTINGS.allowExports),
  };
}

function row() {
  return db.prepare('SELECT value,updated_at FROM system_settings WHERE key=?').get(SETTINGS_KEY) || null;
}

function setValue(value) {
  const updatedAt = new Date().toISOString();
  db.prepare(`INSERT INTO system_settings(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(SETTINGS_KEY, JSON.stringify(value), updatedAt);
  return updatedAt;
}

function atomic(operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export class DemoModeSettingsService {
  get() {
    const current = row();
    const settings = merge(parse(current?.value, {}));
    return { ...settings, updatedAt: current?.updated_at || null, demoUser: demoUserService.get() };
  }

  status() {
    const settings = this.get();
    return Object.freeze({
      demoMode: settings.enabled,
      readOnly: settings.enabled,
      allowExports: Boolean(settings.enabled && settings.allowExports),
    });
  }

  save(input = {}) {
    const current = this.get();
    const next = merge({
      ...current,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.allowExports !== undefined ? { allowExports: input.allowExports } : {}),
    });
    return atomic(() => {
      const updatedAt = setValue(next);
      if (next.enabled) demoUserService.enable();
      else if (current.enabled) demoUserService.disable();
      return { ...next, updatedAt, demoUser: demoUserService.get() };
    });
  }

  initializeFromLegacyEnv() {
    const existing = row();
    if (existing) {
      const current = this.get();
      if (current.enabled) demoUserService.enable();
      return { ...this.get(), demoUser: demoUserService.get() };
    }
    const hasLegacySetting = process.env.DEMO_MODE !== undefined || process.env.DEMO_MODE_ALLOW_EXPORTS !== undefined;
    const next = hasLegacySetting ? {
      enabled: parseBoolean(process.env.DEMO_MODE, false),
      allowExports: parseBoolean(process.env.DEMO_MODE_ALLOW_EXPORTS, false),
    } : DEFAULT_SETTINGS;
    return atomic(() => {
      const updatedAt = setValue(next);
      if (next.enabled) demoUserService.enable();
      return { ...next, updatedAt, demoUser: demoUserService.get() };
    });
  }
}

export const demoModeSettingsService = new DemoModeSettingsService();
