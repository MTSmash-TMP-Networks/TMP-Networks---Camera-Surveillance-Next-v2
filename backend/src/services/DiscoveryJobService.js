import crypto from 'node:crypto';
import { db } from '../db/database.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import { NetworkCameraDiscovery, cameraDiscoveryDefaults } from './NetworkCameraDiscovery.js';
import { cameraRepository } from './cameraRepository.js';
import { adminAlertService } from './AdminAlertService.js';

const INITIAL_DISCOVERY_SETTING = 'initial_discovery_completed_at';
const PUBLIC_ERROR_MESSAGE = 'Die Kamerasuche konnte nicht abgeschlossen werden. Details stehen im Backend-Protokoll.';

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function stableKey(input) {
  const normalized = {
    activeScan: Boolean(input.activeScan),
    includeUnverified: Boolean(input.includeUnverified),
    scanRanges: [...(input.scanRanges || [])].map(String).sort(),
    ports: [...(input.ports || [])].map(Number).sort((a, b) => a - b),
    timeoutMs: Number(input.timeoutMs || config.discoveryAutoTimeoutMs),
    retries: Number(input.retries || 0),
    scanConcurrency: Number(input.scanConcurrency || config.discoveryScanConcurrency),
    perHostConcurrency: Number(input.perHostConcurrency || config.discoveryPerHostConcurrency),
    fingerprintConcurrency: Number(input.fingerprintConcurrency || config.discoveryFingerprintConcurrency),
    portTimeoutMs: Number(input.portTimeoutMs || config.discoveryPortTimeoutMs),
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    mode: job.mode,
    origin: job.origin || 'manual',
    startedAt: job.startedAt,
    completedAt: job.completedAt || null,
    progress: job.progress || null,
    items: job.status === 'completed' ? (job.items || []) : [],
    diagnostics: job.diagnostics || null,
    error: job.error || null,
  };
}

function safeError(error) {
  return {
    code: error?.code || 'DISCOVERY_JOB_FAILED',
    message: error instanceof AppError && error.status < 500 ? error.message : PUBLIC_ERROR_MESSAGE,
  };
}

function setting(key) {
  return db.prepare('SELECT value FROM system_settings WHERE key=?').get(key)?.value || null;
}

function saveSetting(key, value) {
  db.prepare(`INSERT INTO system_settings(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(key, String(value), new Date().toISOString());
}

function rowToJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    mode: row.mode,
    origin: row.origin || 'manual',
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    progress: { stage: row.status, updatedAt: row.completed_at || row.started_at },
    items: parseJson(row.results_json, []),
    diagnostics: parseJson(row.diagnostics_json, null),
    error: row.error_code ? { code: row.error_code, message: row.error_message || PUBLIC_ERROR_MESSAGE } : null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class DiscoveryJobService {
  constructor() {
    this.jobs = new Map();
    this.runningByKey = new Map();
    this.bootstrapTimer = null;
    this.bootstrapRunning = false;
    this.staleRunsRecovered = false;
  }

  cleanup() {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (job.status !== 'running' && now - new Date(job.completedAt || job.startedAt).getTime() > config.discoveryJobRetentionMs) this.jobs.delete(id);
    }
    const finished = [...this.jobs.values()]
      .filter((job) => job.status !== 'running')
      .sort((left, right) => new Date(left.completedAt || left.startedAt) - new Date(right.completedAt || right.startedAt));
    while (this.jobs.size > config.discoveryMaxJobs && finished.length) this.jobs.delete(finished.shift().id);
  }

  start(input, { userId = null, origin = 'manual' } = {}) {
    this.cleanup();
    const normalizedInput = {
      activeScan: Boolean(input.activeScan),
      includeUnverified: Boolean(input.includeUnverified),
      scanRanges: [...(input.scanRanges || [])],
      ports: [...(input.ports || cameraDiscoveryDefaults.ports)],
      timeoutMs: Number(input.timeoutMs || config.discoveryAutoTimeoutMs),
      retries: Number.isInteger(input.retries) ? input.retries : config.discoveryProtocolRetries,
      scanConcurrency: Number(input.scanConcurrency || config.discoveryScanConcurrency),
      perHostConcurrency: Number(input.perHostConcurrency || config.discoveryPerHostConcurrency),
      fingerprintConcurrency: Number(input.fingerprintConcurrency || config.discoveryFingerprintConcurrency),
      portTimeoutMs: Number(input.portTimeoutMs || config.discoveryPortTimeoutMs),
    };
    const key = stableKey(normalizedInput);
    const existingId = this.runningByKey.get(key);
    if (existingId && this.jobs.has(existingId)) return { job: publicJob(this.jobs.get(existingId)), reused: true };

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const job = {
      id,
      key,
      userId,
      origin,
      mode: normalizedInput.activeScan ? 'manual-range' : 'automatic',
      status: 'running',
      startedAt: now,
      completedAt: null,
      progress: { stage: 'queued', completed: 0, total: 0, updatedAt: now },
      items: [],
      diagnostics: null,
      error: null,
      input: normalizedInput,
      promise: null,
    };
    this.jobs.set(id, job);
    this.runningByKey.set(key, id);
    db.prepare(`INSERT INTO discovery_runs(id,mode,status,started_at,request_json,result_count,filtered_count,origin)
      VALUES(?,?,?,?,?,0,0,?)`).run(id, job.mode, job.status, now, JSON.stringify({
      activeScan: normalizedInput.activeScan,
      includeUnverified: normalizedInput.includeUnverified,
      scanRanges: normalizedInput.scanRanges,
      timeoutMs: normalizedInput.timeoutMs,
      portCount: normalizedInput.ports.length,
      scanConcurrency: normalizedInput.scanConcurrency,
      perHostConcurrency: normalizedInput.perHostConcurrency,
      portTimeoutMs: normalizedInput.portTimeoutMs,
    }), origin);
    logger.info({ discoveryJobId: id, origin, mode: job.mode, rangeCount: normalizedInput.scanRanges.length, portCount: normalizedInput.ports.length }, 'Kamera-Suchauftrag wurde gestartet');
    job.promise = this.run(job);
    job.promise.catch(() => {});
    return { job: publicJob(job), reused: false };
  }

  async run(job) {
    try {
      const result = await NetworkCameraDiscovery.discoverDetailed({
        ...job.input,
        onProgress: (progress) => {
          job.progress = { ...job.progress, ...progress, updatedAt: new Date().toISOString() };
        },
      });
      if (!result.diagnostics?.successfulProtocols) {
        throw new AppError(503, 'DISCOVERY_PROTOCOLS_UNAVAILABLE', 'Keines der Suchprotokolle konnte ausgeführt werden.');
      }

      const visible = [];
      const filtered = [];
      for (const device of result.items) {
        const duplicate = cameraRepository.findDiscoveryDuplicate(device);
        if (duplicate) filtered.push({ cameraId: duplicate.cameraId, identity: duplicate.matchType, ip: device.ip });
        else visible.push(device);
      }
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.items = visible;
      job.diagnostics = {
        ...result.diagnostics,
        discoveredCount: result.items.length,
        resultCount: visible.length,
        filteredExisting: filtered.length,
        filteredMatchTypes: filtered.reduce((counts, item) => ({ ...counts, [item.identity || 'unknown']: (counts[item.identity || 'unknown'] || 0) + 1 }), {}),
      };
      job.progress = { stage: 'completed', completed: visible.length, total: visible.length, updatedAt: job.completedAt };
      db.prepare(`UPDATE discovery_runs SET status='completed',completed_at=?,diagnostics_json=?,results_json=?,result_count=?,filtered_count=? WHERE id=?`)
        .run(job.completedAt, JSON.stringify(job.diagnostics), JSON.stringify(visible), visible.length, filtered.length, job.id);
      logger.info({ discoveryJobId: job.id, origin: job.origin, durationMs: job.diagnostics.durationMs, discovered: result.items.length, visible: visible.length, filteredExisting: filtered.length }, 'Kamera-Suchauftrag wurde abgeschlossen');
      return publicJob(job);
    } catch (error) {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      job.error = safeError(error);
      job.progress = { stage: 'failed', updatedAt: job.completedAt };
      db.prepare(`UPDATE discovery_runs SET status='failed',completed_at=?,error_code=?,error_message=? WHERE id=?`)
        .run(job.completedAt, job.error.code, job.error.message, job.id);
      logger.error({ discoveryJobId: job.id, origin: job.origin, code: error?.code, err: error }, 'Kamera-Suchauftrag ist fehlgeschlagen');
      adminAlertService.notify({ level: 'error', code: 'DISCOVERY_JOB_FAILED', message: job.error.message, details: { discoveryJobId: job.id, origin: job.origin, mode: job.mode } }).catch(() => {});
      throw error;
    } finally {
      this.runningByKey.delete(job.key);
      this.cleanup();
    }
  }

  get(id) {
    this.cleanup();
    const job = this.jobs.get(id);
    if (job) return publicJob(job);
    const stored = rowToJob(db.prepare('SELECT * FROM discovery_runs WHERE id=?').get(id));
    if (!stored) throw new AppError(404, 'DISCOVERY_JOB_NOT_FOUND', 'Suchauftrag nicht gefunden oder bereits abgelaufen');
    return stored;
  }

  latest({ origin = null } = {}) {
    const running = [...this.jobs.values()]
      .filter((job) => !origin || job.origin === origin)
      .sort((left, right) => new Date(right.startedAt) - new Date(left.startedAt))[0];
    if (running) return publicJob(running);
    const row = origin
      ? db.prepare('SELECT * FROM discovery_runs WHERE origin=? ORDER BY started_at DESC LIMIT 1').get(origin)
      : db.prepare('SELECT * FROM discovery_runs ORDER BY started_at DESC LIMIT 1').get();
    return rowToJob(row);
  }

  recent(limit = 20) {
    return db.prepare('SELECT id,mode,origin,status,started_at,completed_at,result_count,filtered_count,error_code,error_message FROM discovery_runs ORDER BY started_at DESC LIMIT ?')
      .all(Math.max(1, Math.min(100, Number(limit)))).map((row) => ({
        id: row.id,
        mode: row.mode,
        origin: row.origin || 'manual',
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        resultCount: row.result_count,
        filteredExisting: row.filtered_count,
        error: row.error_code ? { code: row.error_code, message: row.error_message || PUBLIC_ERROR_MESSAGE } : null,
      }));
  }

  recoverInterruptedRuns() {
    if (this.staleRunsRecovered) return 0;
    this.staleRunsRecovered = true;
    const completedAt = new Date().toISOString();
    const result = db.prepare(`UPDATE discovery_runs
      SET status='failed', completed_at=?, error_code='DISCOVERY_INTERRUPTED_RESTART',
          error_message=?
      WHERE status='running'`)
      .run(completedAt, 'Die Kamerasuche wurde durch einen Neustart unterbrochen und kann erneut gestartet werden.');
    if (result.changes) {
      logger.warn({ interruptedDiscoveryRuns: result.changes }, 'Unterbrochene Kamera-Suchaufträge wurden beim Start bereinigt');
    }
    return result.changes;
  }

  bootstrap() {
    this.recoverInterruptedRuns();
    if (!config.discoveryInitialEnabled || this.bootstrapTimer || this.bootstrapRunning) return;
    if (setting(INITIAL_DISCOVERY_SETTING) || cameraRepository.list().length > 0) return;
    this.bootstrapTimer = setTimeout(() => {
      this.bootstrapTimer = null;
      this.runInitialDiscovery().catch((error) => logger.error({ err: error }, 'Initiale Kamerasuche konnte nicht abgeschlossen werden'));
    }, config.discoveryInitialDelayMs);
    this.bootstrapTimer.unref?.();
    logger.info({ delayMs: config.discoveryInitialDelayMs, attempts: config.discoveryInitialAttempts }, 'Initiale Kamerasuche wurde eingeplant');
  }

  shutdown() {
    if (this.bootstrapTimer) clearTimeout(this.bootstrapTimer);
    this.bootstrapTimer = null;
  }

  async runInitialDiscovery() {
    if (this.bootstrapRunning || setting(INITIAL_DISCOVERY_SETTING) || cameraRepository.list().length > 0) return null;
    this.bootstrapRunning = true;
    let lastError = null;
    try {
      for (let attempt = 1; attempt <= config.discoveryInitialAttempts; attempt += 1) {
        try {
          const { job } = this.start({
            activeScan: false,
            includeUnverified: false,
            scanRanges: [],
            ports: cameraDiscoveryDefaults.ports,
            timeoutMs: config.discoveryAutoTimeoutMs,
            scanConcurrency: config.discoveryInitialScanConcurrency,
            perHostConcurrency: config.discoveryInitialPerHostConcurrency,
            fingerprintConcurrency: config.discoveryInitialFingerprintConcurrency,
          }, { origin: 'startup' });
          const internalJob = this.jobs.get(job.id);
          const completed = internalJob?.promise ? await internalJob.promise : this.get(job.id);
          if (completed.items.length === 0 && attempt < config.discoveryInitialAttempts) {
            logger.info({ discoveryJobId: completed.id, attempt, attempts: config.discoveryInitialAttempts }, 'Initiale Kamerasuche war leer und wird nach der Netzwerk-Initialisierung erneut ausgeführt');
            await sleep(config.discoveryInitialRetryDelayMs * attempt);
            continue;
          }
          saveSetting(INITIAL_DISCOVERY_SETTING, completed.completedAt || new Date().toISOString());
          logger.info({ discoveryJobId: completed.id, attempt, resultCount: completed.items.length }, 'Initiale Kamerasuche wurde erfolgreich ausgeführt');
          return completed;
        } catch (error) {
          lastError = error;
          logger.warn({ attempt, attempts: config.discoveryInitialAttempts, code: error?.code, err: error }, 'Initiale Kamerasuche wird nach einem Fehler erneut versucht');
          if (attempt < config.discoveryInitialAttempts) await sleep(config.discoveryInitialRetryDelayMs * attempt);
        }
      }
      throw lastError || new Error('Initial discovery failed');
    } finally {
      this.bootstrapRunning = false;
    }
  }
}

export const discoveryJobService = new DiscoveryJobService();
