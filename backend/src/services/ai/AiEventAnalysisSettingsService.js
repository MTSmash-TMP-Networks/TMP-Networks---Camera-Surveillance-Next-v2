import { db } from '../../db/database.js';
import { encryptSecret, decryptSecret } from '../credentialVault.js';
import { EMAIL_LANGUAGES } from '../notifications/NotificationSettingsService.js';

const SETTINGS_KEY = 'ai_event_analysis_v1';
const API_KEY_KEY = 'ai_event_analysis_api_key_v1';

export const AI_ANALYSIS_LANGUAGES = ['auto', ...EMAIL_LANGUAGES];
export const AI_PROVIDERS = ['openai', 'compatible'];
export const AI_API_MODES = ['responses', 'chat_completions'];
export const AI_REASONING_EFFORTS = ['none', 'low', 'medium', 'high'];
export const AI_IMAGE_DETAILS = ['low', 'high', 'auto'];

export const DEFAULT_AI_EVENT_ANALYSIS_SETTINGS = Object.freeze({
  enabled: false,
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiMode: 'responses',
  model: 'gpt-5.6-luna',
  reasoningEffort: 'low',
  imageDetail: 'low',
  frameCount: 4,
  frameIntervalMs: 900,
  language: 'auto',
  analysisCooldownSeconds: 20,
  includeInEmail: true,
  onlyRelevantNotifications: false,
  requestTimeoutMs: 30000,
  analyze: Object.freeze({ motion: true, manualRecording: true, continuousRecording: false }),
});

function parse(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function getValue(key) {
  return db.prepare('SELECT value FROM system_settings WHERE key=?').get(key)?.value ?? null;
}

function setValue(key, value) {
  db.prepare(`INSERT INTO system_settings(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(key, value, new Date().toISOString());
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function normalizeBaseUrl(value, provider) {
  if (provider === 'openai') return 'https://api.openai.com/v1';
  const source = String(value || '').trim();
  if (!source) return 'http://127.0.0.1:1234/v1';
  try {
    const url = new URL(source);
    if (!['http:', 'https:'].includes(url.protocol)) return 'http://127.0.0.1:1234/v1';
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return 'http://127.0.0.1:1234/v1';
  }
}

function merge(value = {}) {
  const provider = AI_PROVIDERS.includes(value.provider) ? value.provider : DEFAULT_AI_EVENT_ANALYSIS_SETTINGS.provider;
  const defaults = DEFAULT_AI_EVENT_ANALYSIS_SETTINGS;
  return {
    ...defaults,
    ...value,
    enabled: Boolean(value.enabled ?? defaults.enabled),
    provider,
    baseUrl: normalizeBaseUrl(value.baseUrl ?? defaults.baseUrl, provider),
    apiMode: provider === 'openai' ? 'responses' : (AI_API_MODES.includes(value.apiMode) ? value.apiMode : defaults.apiMode),
    model: String(value.model || defaults.model).trim().slice(0, 160) || defaults.model,
    reasoningEffort: AI_REASONING_EFFORTS.includes(value.reasoningEffort) ? value.reasoningEffort : defaults.reasoningEffort,
    imageDetail: AI_IMAGE_DETAILS.includes(value.imageDetail) ? value.imageDetail : defaults.imageDetail,
    frameCount: clampNumber(value.frameCount, 1, 5, defaults.frameCount),
    frameIntervalMs: clampNumber(value.frameIntervalMs, 0, 5000, defaults.frameIntervalMs),
    language: AI_ANALYSIS_LANGUAGES.includes(value.language) ? value.language : defaults.language,
    analysisCooldownSeconds: clampNumber(value.analysisCooldownSeconds, 0, 3600, defaults.analysisCooldownSeconds),
    includeInEmail: Boolean(value.includeInEmail ?? defaults.includeInEmail),
    onlyRelevantNotifications: Boolean(value.onlyRelevantNotifications ?? defaults.onlyRelevantNotifications),
    requestTimeoutMs: clampNumber(value.requestTimeoutMs, 5000, 120000, defaults.requestTimeoutMs),
    analyze: {
      ...defaults.analyze,
      ...(value.analyze || {}),
      motion: Boolean(value.analyze?.motion ?? defaults.analyze.motion),
      manualRecording: Boolean(value.analyze?.manualRecording ?? defaults.analyze.manualRecording),
      continuousRecording: Boolean(value.analyze?.continuousRecording ?? defaults.analyze.continuousRecording),
    },
  };
}

export class AiEventAnalysisSettingsService {
  get() {
    const settings = merge(parse(getValue(SETTINGS_KEY), {}));
    return { ...settings, apiKeyConfigured: Boolean(getValue(API_KEY_KEY)) };
  }

  transport() {
    const settings = this.get();
    const encrypted = getValue(API_KEY_KEY);
    return { ...settings, apiKey: encrypted ? decryptSecret(encrypted) : '' };
  }

  save(input = {}) {
    const current = this.get();
    const next = merge({
      ...current,
      ...input,
      analyze: { ...current.analyze, ...(input.analyze || {}) },
    });
    delete next.apiKey;
    delete next.apiKeyConfigured;
    delete next.clearApiKey;
    setValue(SETTINGS_KEY, JSON.stringify(next));
    if (input.clearApiKey) db.prepare('DELETE FROM system_settings WHERE key=?').run(API_KEY_KEY);
    else if (typeof input.apiKey === 'string' && input.apiKey.trim()) setValue(API_KEY_KEY, encryptSecret(input.apiKey.trim()));
    return this.get();
  }
}

export const aiEventAnalysisSettingsService = new AiEventAnalysisSettingsService();
