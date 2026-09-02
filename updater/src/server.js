import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { compactComposeError, isComposeQuietUnsupported, parseComposeVersion, renderComposeEnv } from './composePreflight.js';
import { chooseComposeProjectName, projectIdentityFromInspect } from './composeProject.js';
import { collectContainerStatus } from './containerStatus.js';

const env = process.env;
const PORT = Number(env.UPDATER_PORT || 3010);
const BIND_ADDRESS = String(env.UPDATER_BIND_ADDRESS || '0.0.0.0').trim() || '0.0.0.0';
const TOKEN = env.UPDATER_TOKEN || '';
const PROJECT_DIR = path.resolve(env.PROJECT_DIR || '/workspace');
const DATA_DIR = path.resolve(env.DATA_DIR || '/data');
const UPDATES_DIR = path.join(DATA_DIR, 'updates');
const SOCKET_PATH = path.resolve(env.UPDATER_SOCKET_PATH || path.join(UPDATES_DIR, 'tmp-camera-updater.sock'));
const SOCKET_UID = Number.isInteger(Number(env.PUID)) ? Number(env.PUID) : 1000;
const SOCKET_GID = Number.isInteger(Number(env.PGID)) ? Number(env.PGID) : 1000;
const PACKAGES_DIR = path.join(UPDATES_DIR, 'packages');
const STAGING_DIR = path.join(UPDATES_DIR, 'staging');
const STATUS_FILE = path.join(UPDATES_DIR, 'status.json');
const HISTORY_FILE = path.join(UPDATES_DIR, 'history.json');
const BACKUPS_DIR = path.resolve(env.BACKUPS_DIR || path.join(DATA_DIR, 'backups'));
const FALLBACK_BACKUPS_DIR = path.resolve(env.BACKUPS_FALLBACK_DIR || path.join(UPDATES_DIR, 'backups'));
const DOCKER_CLI_STATE_DIR = path.resolve(env.DOCKER_CLI_STATE_DIR || path.join(UPDATES_DIR, 'docker-cli'));
const DOCKER_CLI_HOME = path.join(DOCKER_CLI_STATE_DIR, 'home');
const DOCKER_CLI_CONFIG_DIR = path.join(DOCKER_CLI_STATE_DIR, 'config');
const DOCKER_BUILDX_CONFIG_DIR = path.join(DOCKER_CLI_STATE_DIR, 'buildx');
let activeBackupsDir = BACKUPS_DIR;
const PRODUCT_ID = 'tmp-camera-surveillance-next';
const MAX_LOG_LINES = 160;
const MAX_EXTRACTED_BYTES = Number(env.MAX_EXTRACTED_BYTES || 2147483648);
const IDEMPOTENCY_TTL_MS = Number(env.UPDATER_IDEMPOTENCY_TTL_MS || 15 * 60_000);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const FORCE_IMAGE_PULL = ['1', 'true', 'yes', 'on'].includes(String(env.FORCE_IMAGE_PULL || '').trim().toLowerCase());
const DOCKER_CACHE_CLEANUP_ENABLED = !['0', 'false', 'no', 'off'].includes(String(env.UPDATER_DOCKER_CACHE_CLEANUP || 'true').trim().toLowerCase());
const GPU_COMPOSE_ENABLED = ['1', 'true', 'yes', 'on'].includes(String(env.ENABLE_NVIDIA_GPU_COMPOSE || '').trim().toLowerCase());
const ALLOWED_ROOT_FILES = new Set([
  '.env.example', '.gitignore', '.gitlab-ci.yml', 'CHANGELOG.md', 'FILES.sha256', 'LICENSE_AGREEMENT.md',
  'INSTALLATION.md', 'MANIFEST.txt', 'PRIVACY_AND_DATA_PROCESSING.md', 'README.md', 'SUPPORT_POLICY.md', 'THIRD_PARTY_NOTICES.md',
  'UPDATE_PACKAGE.json', 'VALIDATION.md', 'VERSION', 'docker-compose.yml', 'docker-compose.gpu.yml', 'docker-compose.https.yml', 'logs.sh', 'start.sh',
  'stop.sh', 'update.sh',
]);
const ALLOWED_ROOT_DIRS = new Set([
  '.github', 'backend', 'frontend', 'updater', 'mediamtx', 'go2rtc', 'caddy', 'scripts', 'docs', 'documentation', 'tools', 'data',
]);

function configuredHealthEndpoint(name, fallback) {
  const configured = String(env[name] || fallback).trim();
  try {
    const parsed = new URL(configured);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
    if (parsed.username || parsed.password || parsed.hash || parsed.search) throw new Error('credentials_or_parameters');
    return { url: parsed.toString(), configured, valid: true, source: env[name] ? 'environment' : 'default' };
  } catch {
    return { url: fallback, configured: '', valid: false, source: 'fallback', issueCode: 'HEALTH_ENDPOINT_CONFIGURATION_INVALID' };
  }
}

const BACKEND_HEALTH_ENDPOINT = configuredHealthEndpoint('BACKEND_HEALTH_URL', 'http://backend:3000/health');
const FRONTEND_HEALTH_ENDPOINT = configuredHealthEndpoint('FRONTEND_HEALTH_URL', 'http://frontend:8080/healthz');

let runningJob = null;
let runtimeDockerContextCache = null;
let runtimeContainerStatusCache = null;
let statusWriteQueue = Promise.resolve();
let logPersistTimer = null;
const acceptedRequests = new Map();
let status = loadJsonSync(STATUS_FILE, {
  state: 'idle', phase: 'idle', progress: 0, message: 'Kein Update aktiv', logs: [], updatedAt: new Date().toISOString(),
});

let startupState = {
  status: 'starting',
  installReady: false,
  message: 'Update-Dienst wird initialisiert',
  issueCodes: [],
  initializedAt: null,
};

function loadJsonSync(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function requestId(req = null) {
  const supplied = String(req?.headers?.['x-updater-request-id'] || req?.headers?.['x-request-id'] || '').trim();
  return REQUEST_ID_PATTERN.test(supplied) ? supplied : crypto.randomUUID();
}

function sanitizeLogText(value, maxLength = 4000) {
  return String(value ?? '')
    .replace(/(https?:\/\/)([^\s/@]+):([^\s/@]+)@/gi, '$1[REDACTED]@')
    .replace(/\b(authorization|token|password|secret|jwt|credential)(\s*[:=]\s*)([^\s,;&]+)/gi, '$1$2[REDACTED]')
    .replace(/([?&](?:token|password|secret|key)=)[^&#\s]+/gi, '$1[REDACTED]')
    .slice(0, maxLength);
}

function sanitizeLogValue(value, key = '') {
  if (/token|password|secret|authorization|credential|jwt/i.test(key)) return '[REDACTED]';
  if (value instanceof Error) return { name: value.name, code: value.code || value.cause?.code, message: sanitizeLogText(value.message), cause: value.cause?.message ? sanitizeLogText(value.cause.message) : undefined };
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeLogValue(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 80).map(([childKey, child]) => [childKey, sanitizeLogValue(child, childKey)]));
  if (typeof value === 'string') return sanitizeLogText(value);
  return value;
}

function log(level, message, fields = {}) {
  const record = { ...sanitizeLogValue(fields), time: new Date().toISOString(), level, service: 'tmp-camera-updater', message: sanitizeLogText(message, 500) };
  const line = JSON.stringify(record);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function publicOperationError(diagnosticId, subject = 'Vorgang') {
  return `${subject} ist fehlgeschlagen. Weitere Details stehen im Updater-Protokoll. Diagnose-ID: ${diagnosticId}`;
}

function operationFailure(operation, error, fields = {}) {
  const diagnosticId = crypto.randomUUID();
  log('error', 'Updater-Vorgang fehlgeschlagen', { diagnosticId, operation, ...fields, error });
  return { diagnosticId, message: publicOperationError(diagnosticId, operation === 'rollback' ? 'Rollback' : 'Update') };
}

function dockerCliEnv(extra = {}) {
  return {
    HOME: DOCKER_CLI_HOME,
    DOCKER_CONFIG: DOCKER_CLI_CONFIG_DIR,
    BUILDX_CONFIG: DOCKER_BUILDX_CONFIG_DIR,
    COMPOSE_BAKE: String(env.COMPOSE_BAKE || 'false'),
    DOCKER_BUILDKIT: String(env.DOCKER_BUILDKIT || '0'),
    COMPOSE_DOCKER_CLI_BUILD: String(env.COMPOSE_DOCKER_CLI_BUILD || '0'),
    ...extra,
  };
}

async function ensureDockerCliWorkspace() {
  await Promise.all([
    fsp.mkdir(DOCKER_CLI_HOME, { recursive: true }),
    fsp.mkdir(DOCKER_CLI_CONFIG_DIR, { recursive: true }),
    fsp.mkdir(DOCKER_BUILDX_CONFIG_DIR, { recursive: true }),
  ]);
  const configPath = path.join(DOCKER_CLI_CONFIG_DIR, 'config.json');
  if (!fs.existsSync(configPath)) await fsp.writeFile(configPath, '{}\n', { mode: 0o600 });
}


async function canWriteDirectory(directory) {
  await fsp.mkdir(directory, { recursive: true });
  const probe = path.join(directory, `.updater-write-test-${process.pid}-${crypto.randomUUID()}`);
  await fsp.writeFile(probe, 'ok', { mode: 0o600 });
  await fsp.rm(probe, { force: true });
  try { await fsp.chmod(directory, 0o770); } catch { /* Host filesystem may not allow chmod. */ }
  return directory;
}

function numericId(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

async function repairDataPermissions(reason = 'update') {
  const uid = numericId(env.PUID, 1000);
  const gid = numericId(env.PGID, 1000);
  const quotedData = shellQuote(DATA_DIR);
  const quotedBackups = shellQuote(BACKUPS_DIR);
  const quotedFallbackBackups = shellQuote(FALLBACK_BACKUPS_DIR);
  const quotedUpdates = shellQuote(UPDATES_DIR);
  const quotedLive = shellQuote(path.join(DATA_DIR, 'live'));
  const quotedRecordings = shellQuote(path.join(DATA_DIR, 'recordings'));
  const quotedSnapshots = shellQuote(path.join(DATA_DIR, 'snapshots'));
  const script = [
    `mkdir -p ${quotedData} ${quotedLive} ${quotedRecordings} ${quotedSnapshots} ${quotedBackups} ${quotedFallbackBackups} ${quotedUpdates} ${shellQuote(PACKAGES_DIR)} ${shellQuote(STAGING_DIR)}`,
    `chown ${uid}:${gid} ${quotedData} 2>/dev/null || true`,
    `find ${quotedData} -maxdepth 1 -type f \\( -name 'kamera_server.db' -o -name 'kamera_server.db-wal' -o -name 'kamera_server.db-shm' \\) -exec chown ${uid}:${gid} {} + 2>/dev/null || true`,
    `find ${quotedData} -maxdepth 1 -type f \\( -name 'kamera_server.db' -o -name 'kamera_server.db-wal' -o -name 'kamera_server.db-shm' \\) -exec chmod ug+rw {} + 2>/dev/null || true`,
    `chown -R ${uid}:${gid} ${quotedLive} ${quotedRecordings} ${quotedSnapshots} ${quotedUpdates} ${quotedBackups} ${quotedFallbackBackups} 2>/dev/null || true`,
    `chmod 750 ${quotedData} ${quotedRecordings} 2>/dev/null || true`,
    `chmod 775 ${quotedLive} ${quotedSnapshots} 2>/dev/null || true`,
    `chmod -R ug+rwX ${quotedUpdates} ${quotedBackups} ${quotedFallbackBackups} 2>/dev/null || true`,
  ].join('; ');
  try {
    await execute('sh', ['-c', script], { cwd: DATA_DIR, timeoutMs: 180_000 });
    await appendStatusLog(`Datenbank- und Update-Speicherrechte wurden repariert (${reason})`);
  } catch (error) {
    log('warn', 'Datenbank- und Update-Speicherrechte konnten nicht vollständig repariert werden', { issueCode: 'DATA_PERMISSION_REPAIR_FAILED', reason, error });
  }
}

async function resolveWritableBackupsDir() {
  const candidates = [...new Set([BACKUPS_DIR, FALLBACK_BACKUPS_DIR])];
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const writable = await canWriteDirectory(candidate);
      if (writable !== BACKUPS_DIR) {
        log('warn', 'Primaeres Backup-Verzeichnis ist nicht beschreibbar; Updater nutzt sicheren Fallback im Update-Datenbereich', { issueCode: 'BACKUP_DIR_FALLBACK_ACTIVE' });
      }
      return writable;
    } catch (error) {
      lastError = error;
      log('warn', 'Backup-Verzeichnis ist nicht beschreibbar', { issueCode: 'BACKUP_DIR_UNWRITABLE', error });
    }
  }
  throw new Error(`Kein beschreibbares Backup-Verzeichnis verfuegbar: ${lastError?.message || 'unbekannter Rechtefehler'}`);
}

function backupRoot() {
  return activeBackupsDir || BACKUPS_DIR;
}

async function ensureDirectories() {
  await Promise.all([
    fsp.mkdir(PACKAGES_DIR, { recursive: true }),
    fsp.mkdir(STAGING_DIR, { recursive: true }),
  ]);
  await ensureDockerCliWorkspace();
  await repairDataPermissions('startup');
  activeBackupsDir = await resolveWritableBackupsDir();
}

function runtimeIssues() {
  const issues = [];
  if (!TOKEN || TOKEN.length < 32) issues.push({ code: 'UPDATER_TOKEN_INVALID', message: 'UPDATER_TOKEN fehlt oder ist kürzer als 32 Zeichen' });
  if (!fs.existsSync(path.join(PROJECT_DIR, 'VERSION'))) issues.push({ code: 'PROJECT_MOUNT_INVALID', message: 'Projekt-Mount fehlt oder enthält keine VERSION-Datei' });
  try { fs.accessSync('/var/run/docker.sock', fs.constants.R_OK | fs.constants.W_OK); }
  catch { issues.push({ code: 'DOCKER_SOCKET_UNAVAILABLE', message: 'Docker-Socket ist nicht les- und schreibbar' }); }
  if (!BACKEND_HEALTH_ENDPOINT.valid || !FRONTEND_HEALTH_ENDPOINT.valid) issues.push({ code: 'HEALTH_ENDPOINT_CONFIGURATION_INVALID', message: 'Mindestens ein interner Health-Endpunkt ist ungültig konfiguriert; sicherer Standardwert wird verwendet' });
  if (!activeBackupsDir) issues.push({ code: 'BACKUP_STORAGE_UNAVAILABLE', message: 'Kein beschreibbares Backup-Verzeichnis gefunden' });
  try { fs.accessSync(DOCKER_CLI_CONFIG_DIR, fs.constants.R_OK | fs.constants.W_OK); }
  catch { issues.push({ code: 'DOCKER_CLI_CONFIG_UNWRITABLE', message: 'Docker-CLI-Konfigurationsverzeichnis ist nicht beschreibbar' }); }
  return issues;
}

async function initializeUpdater() {
  try {
    await ensureDirectories();
    await recoverAfterSelfRestart();
    await recoverStaleFinishingStatus();
    const issues = runtimeIssues();
    startupState = {
      status: issues.length ? 'degraded' : 'ok',
      installReady: issues.length === 0,
      message: issues.length ? 'Update-Dienst ist erreichbar, aber nicht vollständig installierbereit.' : 'Interner Update-Dienst ist betriebsbereit.',
      issueCodes: issues.map((issue) => issue.code),
      initializedAt: new Date().toISOString(),
    };
    if (issues.length) log('warn', 'Updater wurde mit eingeschränkter Installationsbereitschaft initialisiert', { issueCodes: startupState.issueCodes, issues });
    else log('info', 'Updater wurde erfolgreich initialisiert', { bindAddress: BIND_ADDRESS, port: PORT });
  } catch (error) {
    const diagnosticId = crypto.randomUUID();
    startupState = {
      status: 'error',
      installReady: false,
      message: 'Der Update-Dienst konnte nicht vollständig initialisiert werden.',
      issueCodes: ['UPDATER_INITIALIZATION_FAILED'],
      diagnosticId,
      initializedAt: new Date().toISOString(),
    };
    log('error', 'Updater-Initialisierung fehlgeschlagen', { diagnosticId, error });
  }
}

async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o644 });
  await fsp.rename(temp, file);
  await fsp.chmod(file, 0o644);
}

function queueStatusWrite() {
  const snapshot = JSON.parse(JSON.stringify(status));
  statusWriteQueue = statusWriteQueue.catch(() => {}).then(() => writeJsonAtomic(STATUS_FILE, snapshot));
  return statusWriteQueue;
}

async function updateStatus(patch, logLine = null) {
  const sanitized = { ...patch };
  for (const key of ['message', 'error']) if (sanitized[key] !== undefined && sanitized[key] !== null) sanitized[key] = sanitizeLogText(sanitized[key], 2000);
  status = { ...status, ...sanitized, updatedAt: new Date().toISOString() };
  if (logLine) {
    const entry = { at: new Date().toISOString(), message: sanitizeLogText(logLine, 2000) };
    status.logs = [...(status.logs || []), entry].slice(-MAX_LOG_LINES);
  }
  return queueStatusWrite();
}

function appendStatusLog(line) {
  const entry = { at: new Date().toISOString(), message: sanitizeLogText(line, 2000) };
  status = { ...status, logs: [...(status.logs || []), entry].slice(-MAX_LOG_LINES), updatedAt: entry.at };
  if (logPersistTimer) return;
  logPersistTimer = setTimeout(() => {
    logPersistTimer = null;
    queueStatusWrite().catch((error) => log('warn', 'Statusprotokoll konnte nicht gespeichert werden', { error }));
  }, 300);
}

async function appendHistory(entry) {
  const history = loadJsonSync(HISTORY_FILE, []);
  const sanitized = { ...entry };
  if (sanitized.error) sanitized.error = sanitizeLogText(sanitized.error, 2000);
  history.unshift(sanitized);
  await writeJsonAtomic(HISTORY_FILE, history.slice(0, 50));
}

function json(res, code, body, correlationId = null) {
  const responseBody = { ...body, service: 'tmp-camera-updater', version: currentVersion() };
  const payload = Buffer.from(JSON.stringify(responseBody));
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(correlationId ? { 'X-Request-ID': correlationId } : {}),
  });
  res.end(payload);
}

async function readJson(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Anfrage ist zu groß');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function authorized(req) {
  if (!TOKEN || TOKEN.length < 32) return false;
  const supplied = String(req.headers['x-updater-token'] || '');
  const left = Buffer.from(supplied);
  const right = Buffer.from(TOKEN);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function semver(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$/);
  if (!match) throw new Error(`Ungültige Versionsnummer: ${value}`);
  return { raw: match[0], parts: match.slice(1, 4).map(Number), suffix: match[4] || '' };
}

function compareVersions(a, b) {
  const aa = semver(a); const bb = semver(b);
  for (let index = 0; index < 3; index += 1) {
    if (aa.parts[index] !== bb.parts[index]) return aa.parts[index] > bb.parts[index] ? 1 : -1;
  }
  if (aa.suffix === bb.suffix) return 0;
  if (!aa.suffix) return 1;
  if (!bb.suffix) return -1;
  return aa.suffix.localeCompare(bb.suffix);
}

function currentVersion() {
  try { return fs.readFileSync(path.join(PROJECT_DIR, 'VERSION'), 'utf8').trim(); } catch { return '0.0.0'; }
}

function safePackagePath(input) {
  const resolved = path.resolve(String(input || ''));
  const prefix = `${path.resolve(PACKAGES_DIR)}${path.sep}`;
  if (!resolved.startsWith(prefix) || path.extname(resolved).toLowerCase() !== '.zip') throw new Error('Ungültiger Paketpfad');
  return resolved;
}

function normalizeArchiveEntry(entry) {
  const normalized = entry.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) throw new Error(`Unsicherer ZIP-Eintrag: ${entry}`);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '..' || part === '.')) throw new Error(`Pfadwechsel im ZIP ist nicht erlaubt: ${entry}`);
  return normalized;
}

function execute(command, args, options = {}) {
  const { cwd = PROJECT_DIR, timeoutMs = 15 * 60_000, env: customEnv = {}, onLine = null } = options;
  return new Promise((resolve, reject) => {
    const commandEnv = command === 'docker' ? dockerCliEnv() : {};
    const child = spawn(command, args, { cwd, env: { ...process.env, ...commandEnv, ...customEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill('SIGKILL');
      reject(new Error(`${command} wurde nach ${Math.round(timeoutMs / 1000)} Sekunden beendet`));
    }, timeoutMs);
    const consume = (chunk, target) => {
      const text = chunk.toString();
      if (target === 'stdout') stdout += text; else stderr += text;
      if (onLine) text.split(/\r?\n/).filter(Boolean).forEach(onLine);
    };
    child.stdout.on('data', (chunk) => consume(chunk, 'stdout'));
    child.stderr.on('data', (chunk) => consume(chunk, 'stderr'));
    child.on('error', (error) => { clearTimeout(timer); if (!settled) { settled = true; reject(error); } });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout || `${command} wurde mit Code ${code} beendet`).trim().slice(-6000)));
    });
  });
}

async function walk(root, current = root, output = []) {
  const entries = await fsp.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
    const info = await fsp.lstat(absolute);
    if (info.isSymbolicLink()) throw new Error(`Symbolische Links sind im Update nicht erlaubt: ${relative}`);
    if (info.isDirectory()) await walk(root, absolute, output);
    else if (info.isFile()) output.push(relative);
    else throw new Error(`Nicht unterstützter Dateityp: ${relative}`);
  }
  return output;
}

function validateRootPaths(files) {
  for (const relative of files) {
    const [top] = relative.split('/');
    if (top === '.env' || top === '.git' || top === 'node_modules' || top === 'dist') throw new Error(`Geschützter Pfad im Update: ${relative}`);
    if (top === 'data') {
      if (!relative.endsWith('/.gitkeep') && relative !== 'data/.gitkeep') throw new Error(`Laufzeitdaten dürfen nicht im Update enthalten sein: ${relative}`);
      continue;
    }
    if (!ALLOWED_ROOT_FILES.has(top) && !ALLOWED_ROOT_DIRS.has(top) && !/^UPDATE_NOTES_\d+\.\d+\.\d+\.md$/.test(top)) {
      throw new Error(`Unbekannter oberster Paketpfad: ${relative}`);
    }
  }
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

async function verifyChecksums(root) {
  const manifestPath = path.join(root, 'FILES.sha256');
  const contents = await fsp.readFile(manifestPath, 'utf8');
  const declared = new Map();
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(?:\.\/)?(.+)$/);
    if (!match) throw new Error(`Ungültige Prüfsummenzeile: ${line.slice(0, 120)}`);
    const relative = normalizeArchiveEntry(match[2]);
    if (relative === 'FILES.sha256') throw new Error('FILES.sha256 darf sich nicht selbst referenzieren');
    declared.set(relative, match[1].toLowerCase());
  }
  const files = (await walk(root)).filter((item) => item !== 'FILES.sha256').sort();
  for (const relative of files) {
    const expected = declared.get(relative);
    if (!expected) throw new Error(`Datei fehlt in FILES.sha256: ${relative}`);
    const actual = await sha256File(path.join(root, relative));
    if (actual !== expected) throw new Error(`Prüfsumme stimmt nicht: ${relative}`);
    declared.delete(relative);
  }
  if (declared.size) throw new Error(`FILES.sha256 nennt nicht vorhandene Datei: ${declared.keys().next().value}`);
}

async function findPackageRoot(extractDir) {
  const entries = await fsp.readdir(extractDir, { withFileTypes: true });
  const direct = path.join(extractDir, 'UPDATE_PACKAGE.json');
  if (fs.existsSync(direct)) return extractDir;
  const directories = entries.filter((entry) => entry.isDirectory());
  if (directories.length === 1) {
    const candidate = path.join(extractDir, directories[0].name);
    if (fs.existsSync(path.join(candidate, 'UPDATE_PACKAGE.json'))) return candidate;
  }
  throw new Error('UPDATE_PACKAGE.json wurde im ZIP nicht gefunden');
}


async function validatePackageVersionConsistency(root, expectedVersion) {
  const packageFiles = ['backend/package.json', 'frontend/package.json', 'updater/package.json'];
  for (const relative of packageFiles) {
    const payload = JSON.parse(await fsp.readFile(path.join(root, relative), 'utf8'));
    if (payload.version !== expectedVersion) throw new Error(`Versionskonflikt: ${relative} meldet ${payload.version || 'unbekannt'}, erwartet wird ${expectedVersion}`);
  }
  const composeText = await fsp.readFile(path.join(root, 'docker-compose.yml'), 'utf8');
  const composeMatch = composeText.match(/APP_VERSION:\s*["']?([^"'\s]+)["']?/);
  if (!composeMatch) throw new Error('Versionskonflikt: APP_VERSION fehlt in docker-compose.yml');
  if (composeMatch[1] !== expectedVersion) throw new Error(`Versionskonflikt: docker-compose.yml meldet APP_VERSION ${composeMatch[1]}, erwartet wird ${expectedVersion}`);
}


function isExactNpmVersion(spec) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(spec || '').trim());
}

async function validateNpmLockfileConsistency(root) {
  const projects = ['backend', 'frontend'];
  for (const project of projects) {
    const packageJsonPath = path.join(root, project, 'package.json');
    const packageLockPath = path.join(root, project, 'package-lock.json');
    if (!fs.existsSync(packageJsonPath) || !fs.existsSync(packageLockPath)) continue;
    const packageJson = JSON.parse(await fsp.readFile(packageJsonPath, 'utf8'));
    const packageLock = JSON.parse(await fsp.readFile(packageLockPath, 'utf8'));
    const rootPackage = packageLock.packages?.[''];
    if (!rootPackage) throw new Error(`Lockfile-Konflikt: ${project}/package-lock.json enthaelt keinen Root-Paketeintrag`);
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const declared = packageJson[section] || {};
      const locked = rootPackage[section] || {};
      for (const [name, expectedSpec] of Object.entries(declared)) {
        const lockedSpec = locked[name];
        if (lockedSpec !== expectedSpec) {
          throw new Error(`Lockfile-Konflikt: ${project}/package.json ${section}.${name}=${expectedSpec}, package-lock.json meldet ${lockedSpec || 'fehlend'}`);
        }
        if (isExactNpmVersion(expectedSpec)) {
          const dependencyEntry = packageLock.packages?.[`node_modules/${name}`];
          if (!dependencyEntry) throw new Error(`Lockfile-Konflikt: ${project}/package-lock.json enthaelt keinen Eintrag fuer ${name}`);
          if (dependencyEntry.version !== expectedSpec) {
            throw new Error(`Lockfile-Konflikt: ${project}/package-lock.json node_modules/${name}=${dependencyEntry.version || 'unbekannt'}, erwartet ${expectedSpec}`);
          }
        }
      }
    }
  }
}

async function extractAndInspect(packagePath, destination = null) {
  const safePath = safePackagePath(packagePath);
  const list = await execute('unzip', ['-Z1', safePath], { cwd: os.tmpdir(), timeoutMs: 60_000 });
  const entries = list.stdout.split(/\r?\n/).filter(Boolean).map(normalizeArchiveEntry);
  const verbose = await execute('unzip', ['-Z', '-l', safePath], { cwd: os.tmpdir(), timeoutMs: 60_000 });
  for (const line of verbose.stdout.split(/\r?\n/)) {
    if (/^[lcbps]/.test(line)) throw new Error('Symbolische Links und spezielle Dateitypen sind im Update nicht erlaubt');
  }
  const sizeListing = await execute('unzip', ['-l', safePath], { cwd: os.tmpdir(), timeoutMs: 60_000 });
  const sizeMatch = sizeListing.stdout.match(/^\s*(\d+)\s+\d+\s+files?\s*$/m);
  if (!sizeMatch) throw new Error('Entpackte Paketgröße konnte nicht bestimmt werden');
  const extractedBytes = Number(sizeMatch[1]);
  if (!Number.isSafeInteger(extractedBytes) || extractedBytes > MAX_EXTRACTED_BYTES) throw new Error(`Entpacktes Update überschreitet das Limit von ${MAX_EXTRACTED_BYTES} Byte`);
  if (!entries.length) throw new Error('Das ZIP-Archiv ist leer');
  if (entries.length > 5000) throw new Error('Das ZIP enthält zu viele Einträge');
  const extractDir = destination || await fsp.mkdtemp(path.join(os.tmpdir(), 'tmp-camera-update-'));
  await fsp.mkdir(extractDir, { recursive: true });
  await execute('unzip', ['-q', safePath, '-d', extractDir], { cwd: os.tmpdir(), timeoutMs: 180_000 });
  const root = await findPackageRoot(extractDir);
  const files = await walk(root);
  validateRootPaths(files);
  for (const required of ['UPDATE_PACKAGE.json', 'VERSION', 'FILES.sha256', 'docker-compose.yml', 'backend/package.json', 'frontend/package.json', 'updater/package.json']) {
    if (!files.includes(required)) throw new Error(`Pflichtdatei fehlt: ${required}`);
  }
  await verifyChecksums(root);
  const manifest = JSON.parse(await fsp.readFile(path.join(root, 'UPDATE_PACKAGE.json'), 'utf8'));
  if (manifest.product !== PRODUCT_ID) throw new Error('Das Archiv gehört nicht zu TMP Camera Surveillance Next');
  const version = (await fsp.readFile(path.join(root, 'VERSION'), 'utf8')).trim();
  if (manifest.version !== version) throw new Error('Version in UPDATE_PACKAGE.json und VERSION stimmt nicht überein');
  semver(version);
  await validatePackageVersionConsistency(root, version);
  await validateNpmLockfileConsistency(root);
  const installed = currentVersion();
  const minimumVersion = manifest.minimumVersion || '2.2.0';
  if (compareVersions(installed, minimumVersion) < 0) throw new Error(`Mindestens Version ${minimumVersion} ist erforderlich; installiert ist ${installed}`);
  if (compareVersions(version, installed) <= 0 && !manifest.allowReinstall) throw new Error(`Version ${version} ist nicht neuer als die installierte Version ${installed}`);
  const changelogFile = normalizeArchiveEntry(manifest.changelogFile || `UPDATE_NOTES_${version}.md`);
  if (!files.includes(changelogFile)) throw new Error(`Änderungsdatei fehlt: ${changelogFile}`);
  const changelog = await fsp.readFile(path.join(root, changelogFile), 'utf8');
  const packageStat = await fsp.stat(safePath);
  return {
    root, extractDir, manifest, version, installedVersion: installed, minimumVersion,
    changelog: changelog.slice(0, 200_000), packageSize: packageStat.size,
    packageSha256: await sha256File(safePath), fileCount: files.length,
  };
}

async function inspectPackage(packagePath) {
  let result;
  try {
    result = await extractAndInspect(packagePath);
    return {
      product: result.manifest.product,
      version: result.version,
      installedVersion: result.installedVersion,
      minimumVersion: result.minimumVersion,
      title: result.manifest.title || `Update ${result.version}`,
      summary: result.manifest.summary || '',
      changes: Array.isArray(result.manifest.changes) ? result.manifest.changes.slice(0, 100) : [],
      changelog: result.changelog,
      createdAt: result.manifest.createdAt || null,
      packageSize: result.packageSize,
      packageSha256: result.packageSha256,
      fileCount: result.fileCount,
      compatible: true,
    };
  } finally {
    if (result?.extractDir) await fsp.rm(result.extractDir, { recursive: true, force: true });
  }
}

async function validateSourceSyntax(root) {
  const candidates = [];
  for (const directory of ['backend/src', 'updater/src']) {
    const absolute = path.join(root, directory);
    if (!fs.existsSync(absolute)) continue;
    const files = await walk(absolute);
    files.filter((file) => file.endsWith('.js')).forEach((file) => candidates.push(path.join(absolute, file)));
  }
  for (const file of candidates) await execute('node', ['--check', file], { cwd: root, timeoutMs: 30_000 });
}

function composeFileArgs(root, { https = false } = {}) {
  const args = ['-f', path.join(root, 'docker-compose.yml')];
  const gpuOverride = path.join(root, 'docker-compose.gpu.yml');
  const httpsOverride = path.join(root, 'docker-compose.https.yml');
  if (GPU_COMPOSE_ENABLED && fs.existsSync(gpuOverride)) args.push('-f', gpuOverride);
  if (https && fs.existsSync(httpsOverride)) args.push('-f', httpsOverride);
  return args;
}

let composeRuntimeCache = null;
async function composeRuntime(composeEnv = dockerCliEnv()) {
  if (composeRuntimeCache) return composeRuntimeCache;
  try {
    const result = await execute('docker', ['compose', 'version', '--short'], { cwd: PROJECT_DIR, timeoutMs: 30_000, env: composeEnv });
    composeRuntimeCache = { command: 'docker', prefix: ['compose'], flavor: 'v2', version: parseComposeVersion(result.stdout || result.stderr) || 'unbekannt' };
    return composeRuntimeCache;
  } catch { /* try legacy binary */ }
  for (const args of [['version', '--short'], ['--version']]) {
    try {
      const result = await execute('docker-compose', args, { cwd: PROJECT_DIR, timeoutMs: 30_000, env: composeEnv });
      composeRuntimeCache = { command: 'docker-compose', prefix: [], flavor: 'v1', version: parseComposeVersion(result.stdout || result.stderr) || 'unbekannt' };
      return composeRuntimeCache;
    } catch { /* try next form */ }
  }
  throw new Error('Weder Docker Compose v2 noch docker-compose v1 ist im Updater verfügbar');
}

function normalizeComposeInvocation(root, args) {
  const input = [...args];
  let https = false;
  for (let index = 0; index < input.length - 1; index += 1) {
    if (input[index] === '--profile' && input[index + 1] === 'https') {
      input.splice(index, 2);
      https = true;
      index -= 1;
    }
  }
  return { args: input, fileArgs: composeFileArgs(root, { https }) };
}

function normalizeComposeV1Args(args) {
  const output = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--status' && index + 1 < args.length) {
      output.push('--filter', `status=${args[index + 1]}`);
      index += 1;
    } else output.push(args[index]);
  }
  return output;
}

async function executeCompose(root, args, composeEnv, options = {}) {
  const runtime = await composeRuntime(composeEnv);
  const normalized = normalizeComposeInvocation(root, args);
  const commandArgs = runtime.flavor === 'v1' ? normalizeComposeV1Args(normalized.args) : normalized.args;
  const globalArgs = ['--project-directory', root, ...normalized.fileArgs];
  if (options.envFile) globalArgs.push('--env-file', options.envFile);
  const fullArgs = [...runtime.prefix, ...globalArgs, ...commandArgs];
  return execute(runtime.command, fullArgs, { cwd: root, timeoutMs: options.timeoutMs || 30 * 60_000, env: composeEnv, onLine: options.onLine });
}

function composeBuildArgs(services) {
  return ['build', ...(FORCE_IMAGE_PULL ? ['--pull'] : []), ...services];
}

function safeEnvValue(value) {
  return String(value ?? '').replace(/[\r\n\0]/g, '').trim();
}

function preflightEnvValues(context, root) {
  const projectHostPath = safeEnvValue(context?.hostProjectPath || env.PROJECT_HOST_PATH || PROJECT_DIR);
  return {
    TZ: safeEnvValue(env.TZ || 'Europe/Berlin'),
    PUID: '1000',
    PGID: '1000',
    PROJECT_DIR: path.resolve(root),
    PROJECT_HOST_PATH: projectHostPath || PROJECT_DIR,
    ADMIN_USER: 'preflight',
    ADMIN_PASSWORD: 'preflight-placeholder-change-me',
    JWT_SECRET: 'preflight-placeholder-00000000000000000000000000000000',
    MEDIA_TOKEN_SECRET: 'preflight-placeholder-00000000000000000000000000000000',
    CAMERA_CREDENTIAL_KEY: 'preflight-placeholder-00000000000000000000000000000000',
    UPDATER_TOKEN: 'preflight-placeholder-00000000000000000000000000000000',
    ENABLE_NVIDIA_GPU_STATUS: safeEnvValue(env.ENABLE_NVIDIA_GPU_STATUS || 'false') || 'false',
    ENABLE_NVIDIA_GPU_COMPOSE: safeEnvValue(env.ENABLE_NVIDIA_GPU_COMPOSE || 'false') || 'false',
    NVIDIA_VISIBLE_DEVICES: 'all',
    NVIDIA_DRIVER_CAPABILITIES: 'utility,compute,video',
    UPDATER_SERVICE_PROTOCOL: 'http',
    UPDATER_SERVICE_NAME: 'updater',
    UPDATER_SERVICE_PORT: '3010',
    UPDATER_SERVICE_BASE_PATH: '',
    UPDATER_SOCKET_PATH: '/data/updates/tmp-camera-updater.sock',
    UPDATER_URLS: '',
    UPDATER_URL: '',
    UPDATER_FALLBACK_URLS: 'http://tmp-camera-updater:3010',
    UPDATER_FALLBACK_URL: '',
    BACKEND_HEALTH_URL: 'http://backend:3000/health',
    FRONTEND_HEALTH_URL: 'http://frontend:8080/healthz',
    HTTP_PORT: '8080',
    HTTPS_PORT: '8443',
    WEBRTC_ICE_PORT: '8189',
    WEBRTC_ADDITIONAL_HOSTS: '',
    VITE_STREAM_BROWSER_PREWARM_ENABLED: 'false',
    VITE_STREAM_BROWSER_CACHE_SECONDS: '0',
  };
}

function preflightEnvText(context, root) {
  return renderComposeEnv(preflightEnvValues(context, root), [
    'Temporary sanitized environment used only for docker compose preflight validation.',
    'It is created inside the extracted staging tree and deleted immediately after validation.',
  ]);
}

async function ensurePreflightEnvFile(root, context) {
  const packageEnvFile = path.join(root, '.env');
  if (fs.existsSync(packageEnvFile)) {
    await appendStatusLog('Compose-Preflight verwendet die im Staging vorhandene .env');
    return { envFile: packageEnvFile, values: preflightEnvValues(context, root), cleanup: async () => {} };
  }
  const values = preflightEnvValues(context, root);
  await fsp.writeFile(packageEnvFile, renderComposeEnv(values, [
    'Temporary sanitized environment used only for docker compose preflight validation.',
    'It is created inside the extracted staging tree and deleted immediately after validation.',
  ]), { mode: 0o600 });
  await appendStatusLog('Compose-Preflight verwendet eine temporaere sichere .env aus der laufenden Installation');
  return {
    envFile: packageEnvFile,
    values,
    cleanup: async () => { await fsp.rm(packageEnvFile, { force: true }); },
  };
}

async function detectedComposeVersion(composeEnv) {
  try { return (await composeRuntime(composeEnv)).version; }
  catch (error) {
    log('warn', 'Docker-Compose-Version konnte vor dem Preflight nicht bestimmt werden', { issueCode: 'COMPOSE_VERSION_DETECTION_FAILED', error });
    return 'unbekannt';
  }
}

async function validateComposePackage(root, context) {
  const preflightEnv = await ensurePreflightEnvFile(root, context);
  const composeEnv = dockerCliEnv({
    ...context.composeEnv,
    ...preflightEnv.values,
    PROJECT_DIR: path.resolve(root),
    PROJECT_HOST_PATH: context.hostProjectPath,
    COMPOSE_PROJECT_NAME: context.composeProjectName,
  });
  try {
    const version = await detectedComposeVersion(composeEnv);
    await appendStatusLog(`Docker Compose ${version} wird fuer den Paket-Preflight verwendet`);
    try {
      await executeCompose(root, ['config', '--quiet'], composeEnv, { envFile: preflightEnv.envFile, timeoutMs: 60_000 });
    } catch (error) {
      if (!isComposeQuietUnsupported(error)) throw error;
      await appendStatusLog('Docker Compose unterstuetzt config --quiet nicht; kompatibler Preflight wird verwendet');
      await executeCompose(root, ['config'], composeEnv, { envFile: preflightEnv.envFile, timeoutMs: 60_000 });
    }
  } catch (error) {
    const detail = compactComposeError(error);
    await appendStatusLog(`Compose-Preflight fehlgeschlagen: ${detail}`);
    log('error', 'Compose-Konfiguration des Updatepakets ist ungueltig oder mit der installierten Compose-Version nicht kompatibel', {
      issueCode: 'UPDATE_COMPOSE_PREFLIGHT_FAILED',
      composeVersion: await detectedComposeVersion(composeEnv),
      platform: process.platform,
      architecture: process.arch,
      error,
    });
    throw new Error(`Compose-Preflight fehlgeschlagen: ${detail}`);
  } finally {
    await preflightEnv.cleanup();
  }
}

function validHostProjectPath(value) {
  const candidate = String(value || '').trim();
  return candidate.startsWith('/') && candidate !== '/' ? candidate : null;
}

async function inspectProjectIdentity(containerId) {
  if (!containerId) return { hostProjectPath: null, composeProjectName: null };
  try {
    const inspected = await execute('docker', ['inspect', containerId], { cwd: PROJECT_DIR, timeoutMs: 30_000 });
    const data = JSON.parse(inspected.stdout)[0];
    return projectIdentityFromInspect(data, PROJECT_DIR);
  } catch (error) {
    log('warn', 'Updater-Container konnte für die Compose-Projektermittlung nicht inspiziert werden', {
      containerReference: String(containerId).slice(0, 24),
      error,
    });
    return { hostProjectPath: null, composeProjectName: null };
  }
}

async function persistComposeProjectName(composeProjectName) {
  const normalized = chooseComposeProjectName({ inspectedProjectName: composeProjectName, fallback: PRODUCT_ID });
  const envFile = path.join(PROJECT_DIR, '.env');
  if (!fs.existsSync(envFile)) return normalized;
  const originalStat = await fsp.stat(envFile);
  const original = await fsp.readFile(envFile, 'utf8');
  const lines = original.split(/\r?\n/);
  let replaced = false;
  const updated = lines.map((line) => {
    if (!/^COMPOSE_PROJECT_NAME=/.test(line)) return line;
    if (replaced) return null;
    replaced = true;
    return `COMPOSE_PROJECT_NAME=${normalized}`;
  }).filter((line) => line !== null);
  if (!replaced) updated.push(`COMPOSE_PROJECT_NAME=${normalized}`);
  const rendered = `${updated.join('\n').replace(/\n+$/, '')}\n`;
  if (rendered !== original) {
    const temp = `${envFile}.compose-project-${process.pid}.tmp`;
    await fsp.writeFile(temp, rendered, { mode: originalStat.mode & 0o777 });
    await fsp.chown(temp, originalStat.uid, originalStat.gid).catch(() => {});
    await fsp.rename(temp, envFile);
    await appendStatusLog(`Aktiver Docker-Compose-Projektname wurde dauerhaft übernommen: ${normalized}`);
  }
  return normalized;
}


function isBrowserReachableHost(value) {
  const host = String(value || '').trim().toLowerCase();
  if (!host) return false;
  if (['host.docker.internal', 'localhost', '0.0.0.0', '::', '::1'].includes(host)) return false;
  if (/^127\./.test(host) || /^169\.254\./.test(host)) return false;
  return true;
}

function parseEnvText(text) {
  const values = new Map();
  String(text || '').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) return;
    values.set(match[1], match[2].replace(/^"|"$/g, ''));
  });
  return values;
}

async function upsertProjectEnv(values) {
  const envFile = path.join(PROJECT_DIR, '.env');
  if (!fs.existsSync(envFile)) return false;
  const stat = await fsp.stat(envFile);
  const original = await fsp.readFile(envFile, 'utf8');
  const keys = new Set(Object.keys(values));
  const written = new Set();
  const lines = original.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match || !keys.has(match[1])) return line;
    if (written.has(match[1])) return null;
    written.add(match[1]);
    return `${match[1]}=${values[match[1]]}`;
  }).filter((line) => line !== null);
  for (const [key, value] of Object.entries(values)) {
    if (!written.has(key)) lines.push(`${key}=${value}`);
  }
  const rendered = `${lines.join('\n').replace(/\n+$/, '')}\n`;
  if (rendered === original) return false;
  const tmp = `${envFile}.auto-network-${process.pid}.tmp`;
  await fsp.writeFile(tmp, rendered, { mode: stat.mode & 0o777 });
  await fsp.chown(tmp, stat.uid, stat.gid).catch(() => {});
  await fsp.rename(tmp, envFile);
  return true;
}

function firstValidHostFromEnvText(text) {
  const values = parseEnvText(text);
  const current = String(values.get('WEBRTC_ADDITIONAL_HOSTS') || '');
  const mode = String(values.get('WEBRTC_ADDITIONAL_HOSTS_MODE') || 'auto').trim().toLowerCase();
  if (mode === 'manual') {
    return current.split(/[\s,;]+/).map((item) => item.trim()).filter(isBrowserReachableHost).join(',');
  }
  return current.split(/[\s,;]+/).map((item) => item.trim()).filter(isBrowserReachableHost).join(',');
}

async function runAutoNetworkInit(context, reason = 'startup') {
  const envFile = path.join(PROJECT_DIR, '.env');
  if (!fs.existsSync(envFile)) return;
  const before = await fsp.readFile(envFile, 'utf8').catch(() => '');
  const currentValid = firstValidHostFromEnvText(before);
  if (currentValid) {
    await upsertProjectEnv({ WEBRTC_ADDITIONAL_HOSTS_MODE: 'auto', WEBRTC_ADDITIONAL_HOSTS: currentValid, STREAM_WEBRTC_ENABLED: 'true' });
    await appendStatusLog(`WebRTC-/Live-Hostadresse ist bereits gueltig: ${currentValid}`);
    return;
  }

  const image = await execute('docker', ['inspect', '-f', '{{.Config.Image}}', os.hostname()], { cwd: PROJECT_DIR, timeoutMs: 30_000 })
    .then((result) => result.stdout.trim())
    .catch(() => 'tmp-camera-surveillance-next-updater:latest');
  try {
    const result = await execute('docker', [
      'run', '--rm', '--network', 'host',
      '-v', `${context.hostProjectPath}:/workspace`,
      '-w', '/workspace',
      '--entrypoint', '/bin/sh', image,
      '-c', 'chmod +x ./scripts/auto-network-env.sh && ./scripts/auto-network-env.sh /workspace',
    ], { cwd: PROJECT_DIR, timeoutMs: 120_000, env: context.composeEnv });
    const after = await fsp.readFile(envFile, 'utf8').catch(() => '');
    const detected = firstValidHostFromEnvText(after);
    if (detected) {
      await appendStatusLog(`Automatische Live-/WebRTC-Netzwerkerkennung erfolgreich: ${detected}`);
      log('info', 'Automatische Live-/WebRTC-Netzwerkerkennung erfolgreich', { reason, hosts: detected });
      return;
    }
    log('warn', 'Automatische Live-/WebRTC-Netzwerkerkennung lieferte keine Hostadresse', { reason, stdout: result.stdout?.slice(-1000) || '' });
  } catch (error) {
    log('warn', 'Automatische Live-/WebRTC-Netzwerkerkennung konnte nicht im Host-Netz ausgefuehrt werden', { issueCode: 'AUTO_NETWORK_INIT_FAILED', reason, error });
  }

  await upsertProjectEnv({ WEBRTC_ADDITIONAL_HOSTS_MODE: 'auto', WEBRTC_ADDITIONAL_HOSTS: '', STREAM_WEBRTC_ENABLED: 'false' });
  await appendStatusLog('Keine sichere WebRTC-Hostadresse erkannt; WebRTC wird deaktiviert, damit Live/Kiosk nicht an ungueltigen ICE-Candidates haengen bleibt');
}

async function dockerContext({ quiet = false } = {}) {
  const configuredHostPath = validHostProjectPath(env.PROJECT_HOST_PATH);
  const configuredProjectName = env.COMPOSE_PROJECT_NAME;
  const candidates = [];
  const hostname = String(os.hostname() || '').trim();
  if (hostname) candidates.push(hostname);

  // Do not filter by COMPOSE_PROJECT_NAME here. Older DSM/Compose-v1 installs use
  // the directory-derived project name, while v2.16.4/v2.16.5 accidentally
  // injected a different fixed name into the updater container.
  try {
    const listed = await execute('docker', [
      'ps', '--filter', 'label=com.docker.compose.service=updater', '--format', '{{.ID}}',
    ], { cwd: PROJECT_DIR, timeoutMs: 30_000 });
    for (const id of listed.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      if (!candidates.includes(id)) candidates.push(id);
    }
  } catch (error) {
    log('warn', 'Compose-labelbasierte Updater-Erkennung ist fehlgeschlagen', { error });
  }

  let selected = null;
  for (const candidate of candidates) {
    const identity = await inspectProjectIdentity(candidate);
    if (!identity.composeProjectName && !identity.hostProjectPath) continue;
    const matchesConfiguredPath = configuredHostPath && identity.hostProjectPath === configuredHostPath;
    const isCurrentContainer = candidate === hostname;
    if (configuredHostPath && identity.hostProjectPath && !matchesConfiguredPath && !isCurrentContainer) continue;
    if (isCurrentContainer || matchesConfiguredPath || !selected) selected = { candidate, ...identity };
    if (isCurrentContainer && identity.composeProjectName) break;
  }

  const hostProjectPath = configuredHostPath || selected?.hostProjectPath;
  if (!hostProjectPath) {
    const diagnosticId = crypto.randomUUID();
    log('error', 'Host-Projektpfad konnte nicht ermittelt werden', {
      diagnosticId,
      configuredProjectName: configuredProjectName || null,
      candidateCount: candidates.length,
    });
    throw new Error(`Host-Projektpfad ist nicht konfiguriert oder konnte nicht über Docker Compose ermittelt werden. Diagnose-ID: ${diagnosticId}`);
  }

  const composeProjectName = chooseComposeProjectName({
    inspectedProjectName: selected?.composeProjectName,
    configuredProjectName,
    fallback: PRODUCT_ID,
  });
  await persistComposeProjectName(composeProjectName);
  if (!quiet) {
    await appendStatusLog(selected?.composeProjectName
      ? `Aktiver Compose-Projektname wurde aus dem laufenden Updater übernommen: ${composeProjectName}`
      : `Compose-Projektname wurde aus der Konfiguration übernommen: ${composeProjectName}`);
  }
  return {
    hostProjectPath,
    composeProjectName,
    composeEnv: dockerCliEnv({ PROJECT_HOST_PATH: hostProjectPath, COMPOSE_PROJECT_NAME: composeProjectName, PROJECT_DIR }),
    source: selected?.candidate === hostname ? 'container-label' : (selected ? 'compose-label' : 'environment'),
  };
}

async function compose(args, context, options = {}) {
  const report = (line) => {
    const clean = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (clean) appendStatusLog(clean);
  };
  return executeCompose(PROJECT_DIR, args, context.composeEnv, { timeoutMs: options.timeoutMs || 30 * 60_000, onLine: report });
}


async function runtimeDockerContext() {
  const now = Date.now();
  if (runtimeDockerContextCache?.expiresAt > now) return runtimeDockerContextCache.value;

  // Runtime diagnostics only need the Compose project label. Requiring the
  // host project mount here made /system/status fail on otherwise healthy
  // installations where PROJECT_HOST_PATH was not exported to the updater.
  const hostname = String(os.hostname() || '').trim();
  let inspectedProjectName = null;
  if (hostname) {
    inspectedProjectName = (await inspectProjectIdentity(hostname)).composeProjectName;
  }

  if (!inspectedProjectName) {
    try {
      const listed = await execute('docker', [
        'ps', '-a', '--filter', 'label=com.docker.compose.service=updater', '--format', '{{.ID}}',
      ], { cwd: PROJECT_DIR, timeoutMs: 20_000 });
      for (const id of listed.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
        const identity = await inspectProjectIdentity(id);
        if (!identity.composeProjectName) continue;
        inspectedProjectName = identity.composeProjectName;
        if (hostname && id.startsWith(hostname)) break;
      }
    } catch (error) {
      log('warn', 'Compose-Projektkennung konnte fuer den Containerstatus nicht ueber Service-Labels ermittelt werden', {
        issueCode: 'CONTAINER_STATUS_PROJECT_DISCOVERY_FAILED',
        error,
      });
    }
  }

  const composeProjectName = chooseComposeProjectName({
    inspectedProjectName,
    configuredProjectName: env.COMPOSE_PROJECT_NAME,
    fallback: PRODUCT_ID,
  });
  const value = {
    composeProjectName,
    composeEnv: dockerCliEnv({ COMPOSE_PROJECT_NAME: composeProjectName, PROJECT_DIR }),
    source: inspectedProjectName ? 'container-label' : 'environment',
  };
  runtimeDockerContextCache = { value, expiresAt: now + 30_000 };
  return value;
}

async function runtimeContainerStatus() {
  const now = Date.now();
  if (runtimeContainerStatusCache?.expiresAt > now) return runtimeContainerStatusCache.value;
  if (runtimeContainerStatusCache?.promise) return runtimeContainerStatusCache.promise;
  const promise = (async () => {
    try {
      const context = await runtimeDockerContext();
      return await collectContainerStatus({
        composeProjectName: context.composeProjectName,
        currentContainerId: String(os.hostname() || '').trim() || null,
        executeDocker: (args) => execute('docker', args, { cwd: PROJECT_DIR, timeoutMs: 20_000, env: context.composeEnv }),
      });
    } catch (error) {
      log('warn', 'Docker-Containerstatus konnte nicht ermittelt werden', { issueCode: 'CONTAINER_STATUS_UNAVAILABLE', error });
      return {
        status: 'unavailable',
        generatedAt: new Date().toISOString(),
        source: 'docker-engine',
        project: null,
        summary: { total: 0, running: 0, healthy: 0, warning: 0, critical: 0, restarting: 0, stopped: 0, missing: 0 },
        items: [],
        message: 'Docker-Containerstatus ist derzeit nicht verfügbar.',
      };
    }
  })();
  runtimeContainerStatusCache = { promise, value: null, expiresAt: 0 };
  const value = await promise;
  runtimeContainerStatusCache = { value, promise: null, expiresAt: Date.now() + 2_000 };
  return value;
}

async function waitForUrl(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(4000), cache: 'no-store', headers: { Accept: 'application/json' } });
      if (response.ok) return response;
      lastError = new Error(`${label}: HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`${label} wurde nicht gesund: ${lastError?.message || 'Timeout'}`);
}

function backupId(version) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `update-${stamp}-v${version}`;
}


async function createBackupInDirectory(baseDir, context, installedVersion, id) {
  const directory = path.join(baseDir, id);
  const source = path.join(directory, 'source');
  await updateStatus({ phase: 'backup', progress: 18, message: 'Quellcode und Konfiguration werden gesichert' }, `Sicherung ${id} wird erstellt`);
  await fsp.mkdir(source, { recursive: true });
  await execute('rsync', ['-a', '--delete', '--exclude', '.env', '--exclude', 'data/', '--exclude', '.git/', '--exclude', 'node_modules/', '--exclude', 'dist/', `${PROJECT_DIR}/`, `${source}/`], { timeoutMs: 10 * 60_000 });
  if (fs.existsSync(path.join(PROJECT_DIR, '.env'))) await fsp.copyFile(path.join(PROJECT_DIR, '.env'), path.join(directory, 'environment.env'));
  const dbPath = path.join(DATA_DIR, 'kamera_server.db');
  if (fs.existsSync(dbPath)) {
    await execute('sqlite3', [dbPath, `.backup '${path.join(directory, 'kamera_server.db').replaceAll("'", "''")}'`], { cwd: DATA_DIR, timeoutMs: 120_000 });
  }
  await writeJsonAtomic(path.join(directory, 'backup.json'), {
    id,
    version: installedVersion,
    createdAt: new Date().toISOString(),
    source,
    storage: baseDir === BACKUPS_DIR ? 'primary' : 'fallback',
    database: fs.existsSync(path.join(directory, 'kamera_server.db')),
  });
  return { id, directory, source };
}

function isPermissionError(error) {
  return ['EACCES', 'EPERM', 'EROFS'].includes(String(error?.code || '')) || /permission denied|read-only file system/i.test(String(error?.message || ''));
}


async function runDockerCacheCleanup(reason = 'update') {
  if (!DOCKER_CACHE_CLEANUP_ENABLED) {
    await appendStatusLog(`Docker-Cache-Bereinigung ist deaktiviert (${reason})`);
    return;
  }
  const cleanupScript = path.join(PROJECT_DIR, 'scripts', 'docker-cache-cleanup.sh');
  if (!fs.existsSync(cleanupScript)) {
    log('warn', 'Docker-Cache-Bereinigungsskript fehlt', { issueCode: 'DOCKER_CACHE_CLEANUP_SCRIPT_MISSING', reason });
    return;
  }
  try {
    const result = await execute('sh', [cleanupScript, reason], { cwd: PROJECT_DIR, timeoutMs: 15 * 60_000 });
    const summary = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' | ');
    await appendStatusLog(summary ? `Docker-Speicherbereinigung: ${summary}` : `Docker-Speicherbereinigung abgeschlossen (${reason})`);
  } catch (error) {
    // Cache maintenance must never turn an otherwise valid application update
    // into a rollback. Build cache is disposable, so log and continue.
    log('warn', 'Docker-Cache-Bereinigung ist fehlgeschlagen und wird ignoriert', { issueCode: 'DOCKER_CACHE_CLEANUP_FAILED', reason, error });
    await appendStatusLog(`Docker-Speicherbereinigung konnte nicht vollständig ausgeführt werden (${reason}); Update wird fortgesetzt`);
  }
}

async function createBackup(context, installedVersion) {
  const id = backupId(installedVersion);
  const candidates = [...new Set([backupRoot(), FALLBACK_BACKUPS_DIR])];
  let lastError = null;
  for (const candidate of candidates) {
    try {
      await canWriteDirectory(candidate);
      activeBackupsDir = candidate;
      return await createBackupInDirectory(candidate, context, installedVersion, id);
    } catch (error) {
      lastError = error;
      await fsp.rm(path.join(candidate, id), { recursive: true, force: true }).catch(() => {});
      log('warn', 'Backup-Erstellung in diesem Verzeichnis fehlgeschlagen', { issueCode: 'BACKUP_CREATE_FAILED', error });
      if (!isPermissionError(error)) break;
    }
  }
  throw new Error(`Backup konnte nicht erstellt werden: ${lastError?.message || 'unbekannter Fehler'}`);
}

async function restoreBackup(backup, context) {
  await updateStatus({ phase: 'rollback', progress: 82, message: 'Fehlgeschlagenes Update wird automatisch zurückgerollt' }, `Rollback auf ${backup.id}`);
  try { await compose(['stop', 'backend', 'frontend', 'mediamtx'], context, { timeoutMs: 180_000 }); } catch { /* continue */ }
  await execute('rsync', ['-a', '--delete', '--exclude', '.env', '--exclude', 'data/', '--exclude', '.git/', `${backup.source}/`, `${PROJECT_DIR}/`], { timeoutMs: 10 * 60_000 });
  const savedEnv = path.join(backup.directory, 'environment.env');
  if (fs.existsSync(savedEnv)) await fsp.copyFile(savedEnv, path.join(PROJECT_DIR, '.env'));
  const savedDb = path.join(backup.directory, 'kamera_server.db');
  if (fs.existsSync(savedDb)) {
    await fsp.copyFile(savedDb, path.join(DATA_DIR, 'kamera_server.db'));
    await fsp.rm(path.join(DATA_DIR, 'kamera_server.db-wal'), { force: true });
    await fsp.rm(path.join(DATA_DIR, 'kamera_server.db-shm'), { force: true });
  }
  await repairDataPermissions('rollback');
  try {
    await replaceComposeService(context, 'backend', { noBuild: true });
    await replaceComposeService(context, 'mediamtx', { noBuild: true });
    await replaceComposeService(context, 'frontend', { noBuild: true });
  } catch (error) {
    log('warn', 'Rollback konnte vorhandene Images nicht direkt starten; Images werden neu gebaut', { issueCode: 'ROLLBACK_NO_BUILD_START_FAILED', error });
    await compose(['build', 'backend', 'frontend', 'updater'], context, { timeoutMs: 45 * 60_000 });
    await replaceComposeService(context, 'backend');
    await replaceComposeService(context, 'mediamtx');
    await replaceComposeService(context, 'frontend');
  }
  await waitForUrl(BACKEND_HEALTH_ENDPOINT.url, 120_000, 'Backend nach Rollback');
  await waitForUrl(FRONTEND_HEALTH_ENDPOINT.url, 120_000, 'Frontend nach Rollback');
}


async function composeServiceContainerIds(context, service) {
  const result = await execute('docker', [
    'ps', '-aq',
    '--filter', `label=com.docker.compose.project=${context.composeProjectName}`,
    '--filter', `label=com.docker.compose.service=${service}`,
    '--format', '{{.ID}}',
  ], { cwd: PROJECT_DIR, timeoutMs: 30_000, env: context.composeEnv });
  return result.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

async function replaceComposeService(context, service, options = {}) {
  const ids = await composeServiceContainerIds(context, service);
  if (ids.length) {
    await appendStatusLog(`${service}: ${ids.length} alter Compose-Container wird vor dem Neustart entfernt`);
    await execute('docker', ['rm', '-f', ...ids], { cwd: PROJECT_DIR, timeoutMs: 180_000, env: context.composeEnv });
  }
  const args = [...(options.profile ? ['--profile', options.profile] : []), 'up', '-d', '--no-deps', ...(options.noBuild ? ['--no-build'] : []), service];
  return compose(args, context, { timeoutMs: options.timeoutMs || 10 * 60_000 });
}

async function recreateApplicationService(context, service, progress, label, healthEndpoint = null) {
  await updateStatus({ phase: 'regular_restart', progress, message: `${label} wird neu gestartet` }, `${label} wird per Docker Compose neu erstellt und gestartet`);
  await replaceComposeService(context, service, { timeoutMs: 10 * 60_000 });
  if (healthEndpoint) await waitForUrl(healthEndpoint.url, 180_000, `${label} nach regulärem Neustart`);
}

async function emergencyStartApplicationServices(context, runningServices = []) {
  await appendStatusLog('Recovery-Start: Backend, go2rtc und Frontend werden ohne vorherigen Stop wieder gestartet');
  await repairDataPermissions('regular-restart-recovery');
  for (const service of ['backend', 'mediamtx', 'frontend']) {
    try { await compose(['up', '-d', '--no-deps', service], context, { timeoutMs: 10 * 60_000 }); }
    catch (error) { log('warn', 'Recovery-Start fuer Dienst fehlgeschlagen', { issueCode: 'REGULAR_RESTART_RECOVERY_SERVICE_FAILED', service, error }); }
  }
  if (runningServices.includes('caddy')) {
    try { await compose(['--profile', 'https', 'up', '-d', '--no-deps', 'caddy'], context, { timeoutMs: 10 * 60_000 }); }
    catch (error) { log('warn', 'Recovery-Start fuer HTTPS-Dienst fehlgeschlagen', { issueCode: 'REGULAR_RESTART_RECOVERY_CADDY_FAILED', error }); }
  }
}

async function regularApplicationRestart(context, runningServices = []) {
  await updateStatus({ phase: 'regular_restart', progress: 90, message: 'Regulärer Neustart nach dem Update wird durchgeführt' }, 'Backend, go2rtc und Frontend werden sequenziell neu gestartet');
  await repairDataPermissions('regular-restart');
  await runAutoNetworkInit(context, 'regular-restart');
  try {
    // Wichtig: Nicht mehr alle Dienste zuerst gemeinsam stoppen. Genau dieser harte Stop konnte
    // dazu führen, dass Backend und Frontend unten blieben und die Update-Anzeige bei 90% hing.
    await recreateApplicationService(context, 'backend', 91, 'Backend', BACKEND_HEALTH_ENDPOINT);
    await recreateApplicationService(context, 'mediamtx', 94, 'go2rtc');
    await recreateApplicationService(context, 'frontend', 96, 'Frontend', FRONTEND_HEALTH_ENDPOINT);
    if (runningServices.includes('caddy')) await recreateApplicationService(context, 'caddy', 97, 'HTTPS-Dienst');
  } catch (error) {
    log('warn', 'Regulaerer Neustart nach Update war unvollstaendig; Recovery-Start wird ausgefuehrt', { issueCode: 'REGULAR_RESTART_INCOMPLETE', error });
    await emergencyStartApplicationServices(context, runningServices);
    await waitForUrl(BACKEND_HEALTH_ENDPOINT.url, 180_000, 'Backend nach Recovery-Start');
    await waitForUrl(FRONTEND_HEALTH_ENDPOINT.url, 180_000, 'Frontend nach Recovery-Start');
  }
  await updateStatus({ phase: 'regular_restart_done', progress: 98, message: 'Regulärer Neustart wurde abgeschlossen' }, 'Backend, go2rtc und Frontend laufen nach dem Neustart');
}

async function performInstall(input) {
  const startedAt = new Date().toISOString();
  const packagePath = safePackagePath(input.packagePath);
  const stage = path.join(STAGING_DIR, input.packageId);
  let inspected = null;
  let backup = null;
  let context = null;
  let newUpdaterImage = null;
  try {
    await updateStatus({ state: 'running', phase: 'validating', progress: 5, message: 'Update-Paket wird erneut vollständig geprüft', packageId: input.packageId, logs: [], startedAt, error: null, diagnosticId: input.requestId });
    await fsp.rm(stage, { recursive: true, force: true });
    inspected = await extractAndInspect(packagePath, stage);
    await updateStatus({ targetVersion: inspected.version, phase: 'preparing', progress: 10, message: `Update ${inspected.version} wird vorbereitet` }, `${inspected.fileCount} Dateien und alle Prüfsummen sind gültig`);
    await appendStatusLog('Docker- und Host-Projektkontext wird ermittelt');
    context = await dockerContext();
    await runAutoNetworkInit(context, 'before-update-preflight');
    await appendStatusLog('Quellcode-Syntax wird geprüft');
    await updateStatus({ phase: 'preflight', progress: 14, message: 'Quellcode und Compose-Konfiguration werden vorab geprüft' });
    await validateSourceSyntax(inspected.root);
    await appendStatusLog('Compose-Konfiguration des Updatepakets wird geprüft');
    await validateComposePackage(inspected.root, context);
    await appendStatusLog('Laufende Compose-Dienste werden ermittelt');
    const runningServices = (await compose(['ps', '--services', '--status', 'running'], context, { timeoutMs: 60_000 })).stdout.split(/\r?\n/).filter(Boolean);
    await updateStatus({ phase: 'cleanup', progress: 16, message: 'Alter Docker-Build-Cache wird bereinigt' });
    await runDockerCacheCleanup('pre-update-build');
    await appendStatusLog('Backup-Speicher wird geprueft und Sicherung wird vorbereitet');
    backup = await createBackup(context, inspected.installedVersion);
    await updateStatus({ backupId: backup.id, phase: 'installing', progress: 28, message: 'Neue Programmdateien werden installiert' });
    await execute('rsync', ['-a', '--delete', '--exclude', '.env', '--exclude', 'data/', '--exclude', '.git/', '--exclude', 'node_modules/', '--exclude', 'dist/', `${inspected.root}/`, `${PROJECT_DIR}/`], { timeoutMs: 10 * 60_000 });
    await repairDataPermissions('before-build');
    await updateStatus({ phase: 'building', progress: 42, message: 'Docker-Images werden neu gebaut' });
    await compose(composeBuildArgs(['backend', 'frontend']), context, { timeoutMs: 60 * 60_000 });
    try {
      await compose(composeBuildArgs(['updater']), context, { timeoutMs: 60 * 60_000 });
      newUpdaterImage = (await compose(['images', '-q', 'updater'], context, { timeoutMs: 60_000 })).stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
      if (newUpdaterImage) await execute('docker', ['run', '--rm', '--entrypoint', 'node', newUpdaterImage, '--check', '/app/src/server.js'], { cwd: PROJECT_DIR, timeoutMs: 60_000 });
    } catch (error) {
      log('warn', 'Updater-Image konnte waehrend der Installation nicht neu gebaut werden; Anwendung wird trotzdem aktualisiert und der Updater kann spaeter per start.sh/repair-updater.sh neu gebaut werden', { issueCode: 'UPDATER_IMAGE_BUILD_DEFERRED', error });
      await appendStatusLog('Updater-Image-Build wurde verschoben; Backend und Frontend werden weiter aktualisiert');
      newUpdaterImage = null;
    }
    await updateStatus({ phase: 'restarting', progress: 65, message: 'Anwendungsdienste werden nacheinander aktualisiert' });
    await repairDataPermissions('before-service-start');
    await runAutoNetworkInit(context, 'before-service-start');
    await replaceComposeService(context, 'backend');
    await waitForUrl(BACKEND_HEALTH_ENDPOINT.url, 150_000, 'Backend');
    await replaceComposeService(context, 'mediamtx');
    await replaceComposeService(context, 'frontend');
    if (runningServices.includes('caddy')) await replaceComposeService(context, 'caddy', { profile: 'https' });
    await updateStatus({ phase: 'verifying', progress: 88, message: 'Neue Version wird per Healthcheck geprüft' });
    await waitForUrl(FRONTEND_HEALTH_ENDPOINT.url, 150_000, 'Frontend');
    const backendHealth = await waitForUrl(BACKEND_HEALTH_ENDPOINT.url, 150_000, 'Backend');
    const backendPayload = await backendHealth.json().catch(() => ({}));
    if (backendPayload.version !== inspected.version) throw new Error(`Backend meldet Version ${backendPayload.version || 'unbekannt'}, erwartet wurde ${inspected.version}`);
    await regularApplicationRestart(context, runningServices);
    const versionAfterInstall = currentVersion();
    if (versionAfterInstall !== inspected.version) throw new Error(`Installierte VERSION ist ${versionAfterInstall}, erwartet wurde ${inspected.version}`);
    await updateStatus({ phase: 'cleanup', progress: 99, message: 'Nicht mehr benötigte Docker-Images und Build-Caches werden entfernt' });
    await runDockerCacheCleanup('post-update');
    await appendHistory({ id: crypto.randomUUID(), packageId: input.packageId, fromVersion: inspected.installedVersion, toVersion: inspected.version, status: 'installed', backupId: backup.id, startedAt, completedAt: new Date().toISOString(), installedBy: input.installedBy || null });
    const updaterLog = newUpdaterImage
      ? 'Neues Updater-Image wurde vorbereitet. Der laufende Update-Agent bleibt fuer diese Transaktion unveraendert und wird erst bei einem normalen Host-Start oder einer expliziten Updater-Reparatur aktiviert.'
      : 'Updater-Image-Build wurde uebersprungen; der laufende Update-Agent bleibt unveraendert.';
    await updateStatus({
      state: 'completed',
      phase: 'completed',
      progress: 100,
      message: `Update auf Version ${inspected.version} vollständig abgeschlossen`,
      installedVersion: inspected.version,
      completedAt: new Date().toISOString(),
    }, updaterLog);

    // Do NOT replace the updater from inside its own update transaction.
    // Field tests on both Debian and Synology showed that self-replacement can
    // leave the control agent detached from the application network even after
    // an otherwise successful update. The already-running updater is therefore
    // deliberately kept alive. A freshly built updater image is staged for the
    // next normal host-side start/repair, where Compose is controlled from the
    // host rather than by the service that is replacing itself.
    if (newUpdaterImage) {
      await appendStatusLog('Updater-Image ist vorbereitet; der aktive Update-Agent bleibt bis zum naechsten Host-Start unveraendert');
    }
  } catch (error) {
    const failure = operationFailure('install', error, { requestId: input.requestId, phase: status.phase, packageId: input.packageId, targetVersion: inspected?.version });
    await updateStatus({ state: 'running', phase: 'failed', progress: 78, message: 'Update ist fehlgeschlagen', error: failure.message, diagnosticId: failure.diagnosticId }, failure.message);
    if (backup && context) {
      try {
        await restoreBackup(backup, context);
        await updateStatus({ state: 'rolled_back', phase: 'rolled_back', progress: 100, message: 'Update fehlgeschlagen; vorherige Version wurde automatisch wiederhergestellt', error: failure.message, diagnosticId: failure.diagnosticId, completedAt: new Date().toISOString() }, 'Automatischer Rollback erfolgreich');
        await appendHistory({ id: crypto.randomUUID(), packageId: input.packageId, fromVersion: inspected?.installedVersion || null, toVersion: inspected?.version || null, status: 'rolled_back', backupId: backup.id, startedAt, completedAt: new Date().toISOString(), error: failure.message, diagnosticId: failure.diagnosticId, installedBy: input.installedBy || null });
      } catch (rollbackError) {
        const rollbackFailure = operationFailure('rollback', rollbackError, { requestId: input.requestId, backupId: backup.id, originalDiagnosticId: failure.diagnosticId });
        const publicFailure = `${failure.message} ${rollbackFailure.message}`;
        await updateStatus({ state: 'failed', phase: 'rollback_failed', progress: 100, message: 'Update und automatischer Rollback sind fehlgeschlagen', error: publicFailure, diagnosticId: rollbackFailure.diagnosticId, completedAt: new Date().toISOString() }, rollbackFailure.message);
        await appendHistory({ id: crypto.randomUUID(), packageId: input.packageId, fromVersion: inspected?.installedVersion || null, toVersion: inspected?.version || null, status: 'failed', backupId: backup.id, startedAt, completedAt: new Date().toISOString(), error: publicFailure, diagnosticId: rollbackFailure.diagnosticId, installedBy: input.installedBy || null });
      }
    } else {
      await updateStatus({ state: 'failed', phase: 'failed', progress: 100, message: 'Update konnte vor der Installation nicht vorbereitet werden', error: failure.message, diagnosticId: failure.diagnosticId, completedAt: new Date().toISOString() });
      await appendHistory({ id: crypto.randomUUID(), packageId: input.packageId, fromVersion: inspected?.installedVersion || currentVersion(), toVersion: inspected?.version || null, status: 'failed', startedAt, completedAt: new Date().toISOString(), error: failure.message, diagnosticId: failure.diagnosticId, installedBy: input.installedBy || null });
    }
  } finally {
    runningJob = null;
    if (inspected?.extractDir) await fsp.rm(inspected.extractDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function performSystemRestart(input) {
  const startedAt = new Date().toISOString();
  try {
    const context = await dockerContext();
    const runningServices = (await compose(['ps', '--services', '--status', 'running'], context, { timeoutMs: 60_000 })).stdout.split(/\r?\n/).filter(Boolean);
    log('info', 'Manueller Neustart des Kamera-Systems wurde gestartet', {
      diagnosticId: input.requestId,
      restartId: input.restartId,
      requestedBy: input.requestedBy || null,
      startedAt,
    });
    await repairDataPermissions('manual-system-restart');
    try {
      await replaceComposeService(context, 'backend', { timeoutMs: 10 * 60_000 });
      await waitForUrl(BACKEND_HEALTH_ENDPOINT.url, 180_000, 'Backend nach manuellem Neustart');
      await replaceComposeService(context, 'mediamtx', { timeoutMs: 10 * 60_000 });
      await replaceComposeService(context, 'frontend', { timeoutMs: 10 * 60_000 });
      await waitForUrl(FRONTEND_HEALTH_ENDPOINT.url, 180_000, 'Frontend nach manuellem Neustart');
      if (runningServices.includes('caddy')) {
        await replaceComposeService(context, 'caddy', { profile: 'https', timeoutMs: 10 * 60_000 });
      }
    } catch (error) {
      log('warn', 'Manueller Neustart war unvollstaendig; Recovery-Start wird ausgefuehrt', {
        diagnosticId: input.requestId,
        restartId: input.restartId,
        issueCode: 'SYSTEM_RESTART_RECOVERY_REQUIRED',
        error,
      });
      await emergencyStartApplicationServices(context, runningServices);
      await waitForUrl(BACKEND_HEALTH_ENDPOINT.url, 180_000, 'Backend nach Neustart-Recovery');
      await waitForUrl(FRONTEND_HEALTH_ENDPOINT.url, 180_000, 'Frontend nach Neustart-Recovery');
    }
    log('info', 'Manueller Neustart des Kamera-Systems wurde abgeschlossen', {
      diagnosticId: input.requestId,
      restartId: input.restartId,
      requestedBy: input.requestedBy || null,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    log('error', 'Manueller Neustart des Kamera-Systems ist fehlgeschlagen', {
      diagnosticId: input.requestId,
      restartId: input.restartId,
      issueCode: 'SYSTEM_RESTART_FAILED',
      error,
    });
  } finally {
    runningJob = null;
  }
}

async function performRollback(input) {
  const startedAt = new Date().toISOString();
  try {
    const backupDir = path.resolve(backupRoot(), String(input.backupId || ''));
    if (!backupDir.startsWith(`${path.resolve(backupRoot())}${path.sep}`)) throw new Error('Ungültige Sicherungs-ID');
    const metadata = loadJsonSync(path.join(backupDir, 'backup.json'), null);
    if (!metadata?.id || metadata.id !== input.backupId) throw new Error('Sicherung nicht gefunden');
    const context = await dockerContext();
    await updateStatus({ state: 'running', phase: 'rollback', progress: 5, message: `Rollback auf ${metadata.version} wird vorbereitet`, logs: [], startedAt, backupId: metadata.id, error: null, diagnosticId: input.requestId });
    await restoreBackup({ id: metadata.id, directory: backupDir, source: path.join(backupDir, 'source') }, context);
    await updateStatus({ state: 'completed', phase: 'completed', progress: 100, message: `Rollback auf Version ${metadata.version} erfolgreich`, installedVersion: metadata.version, completedAt: new Date().toISOString() });
    await appendHistory({ id: crypto.randomUUID(), status: 'manual_rollback', backupId: metadata.id, toVersion: metadata.version, startedAt, completedAt: new Date().toISOString(), installedBy: input.installedBy || null });
  } catch (error) {
    const failure = operationFailure('rollback', error, { requestId: input.requestId, backupId: input.backupId, phase: status.phase });
    await updateStatus({ state: 'failed', phase: 'rollback_failed', progress: 100, message: 'Manueller Rollback ist fehlgeschlagen', error: failure.message, diagnosticId: failure.diagnosticId, completedAt: new Date().toISOString() }, failure.message);
    await appendHistory({ id: crypto.randomUUID(), status: 'rollback_failed', backupId: input.backupId || null, startedAt, completedAt: new Date().toISOString(), error: failure.message, diagnosticId: failure.diagnosticId, installedBy: input.installedBy || null });
  } finally { runningJob = null; }
}

async function recoverAfterSelfRestart() {
  if (status.phase === 'updater_restarting') {
    await updateStatus({ state: 'completed', phase: 'completed', progress: 100, message: `Update auf Version ${status.installedVersion || currentVersion()} vollständig abgeschlossen`, installedVersion: status.installedVersion || currentVersion(), completedAt: new Date().toISOString() }, 'Update-Dienst verwendet jetzt ebenfalls die neue Version');
  }
}

async function recoverStaleFinishingStatus() {
  if (status.state !== 'running') return;
  const finishingPhases = new Set(['restarting', 'verifying', 'regular_restart', 'regular_restart_done', 'updater_restarting']);
  if (!finishingPhases.has(status.phase)) return;
  const updatedAt = Date.parse(status.updatedAt || '');
  const ageMs = Number.isFinite(updatedAt) ? Date.now() - updatedAt : Number.POSITIVE_INFINITY;
  if (ageMs < 60_000) return;
  const version = status.installedVersion || currentVersion();
  await updateStatus({
    state: 'completed',
    phase: 'completed',
    progress: 100,
    message: `Update auf Version ${version} vollständig abgeschlossen`,
    installedVersion: version,
    completedAt: new Date().toISOString(),
  }, 'Hängender Abschlussstatus wurde beim Updater-Start automatisch bereinigt');
}

function purgeAcceptedRequests() {
  const threshold = Date.now() - IDEMPOTENCY_TTL_MS;
  for (const [key, item] of acceptedRequests) if (item.acceptedAt < threshold) acceptedRequests.delete(key);
}

function replayFor(route, correlationId) {
  purgeAcceptedRequests();
  return acceptedRequests.get(`${route}:${correlationId}`) || null;
}

function rememberAccepted(route, correlationId, response) {
  purgeAcceptedRequests();
  acceptedRequests.set(`${route}:${correlationId}`, { ...response, acceptedAt: Date.now() });
}

function requestError(error, correlationId, req) {
  const diagnosticId = correlationId || crypto.randomUUID();
  const message = String(error?.message || error || '');
  const invalidRequest = error instanceof SyntaxError || /Anfrage ist zu groß|Paket-ID fehlt|Ungültiger Paketpfad|Sicherungs-ID|Sicherung nicht gefunden|Neustart-Bestaetigung|Neustart-Bestätigung/i.test(message);
  log(invalidRequest ? 'warn' : 'error', 'Updater-Anfrage konnte nicht verarbeitet werden', { diagnosticId, method: req?.method, path: req?.url, error });
  return {
    statusCode: invalidRequest ? 400 : 500,
    body: {
      error: invalidRequest ? 'UPDATER_REQUEST_INVALID' : 'UPDATER_REQUEST_FAILED',
      message: invalidRequest ? 'Die Anfrage an den Update-Dienst ist ungültig.' : 'Der Update-Dienst konnte die Anfrage nicht verarbeiten. Details stehen im Updater-Protokoll.',
      diagnosticId,
    },
  };
}

async function updaterRequestHandler(req, res) {
  const correlationId = requestId(req);
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') {
      const code = startupState.status === 'error' ? 503 : 200;
      return json(res, code, {
        ...startupState,
        service: 'tmp-camera-updater',
        version: currentVersion(),
        busy: Boolean(runningJob),
      }, correlationId);
    }
    if (!authorized(req)) {
      log('warn', 'Interne Updater-Authentifizierung fehlgeschlagen', { diagnosticId: correlationId, method: req.method, path: url.pathname });
      return json(res, 401, { error: 'UPDATER_AUTH_FAILED', message: 'Interne Updater-Authentifizierung fehlgeschlagen', diagnosticId: correlationId }, correlationId);
    }
    if (req.method === 'GET' && url.pathname === '/runtime/containers') {
      return json(res, 200, await runtimeContainerStatus(), correlationId);
    }
    if (startupState.status === 'starting') return json(res, 503, { error: 'UPDATER_STARTING', message: 'Update-Dienst wird noch initialisiert', diagnosticId: correlationId }, correlationId);
    if (startupState.status === 'error') return json(res, 503, { error: 'UPDATER_INITIALIZATION_FAILED', message: startupState.message, issueCodes: startupState.issueCodes, diagnosticId: startupState.diagnosticId || correlationId }, correlationId);
    if (!startupState.installReady) return json(res, 503, { error: 'UPDATER_NOT_READY', message: startupState.message, issueCodes: startupState.issueCodes, diagnosticId: correlationId }, correlationId);
    if (req.method === 'POST' && url.pathname === '/inspect') {
      const body = await readJson(req);
      return json(res, 200, await inspectPackage(body.packagePath), correlationId);
    }
    if (req.method === 'POST' && url.pathname === '/install') {
      const replay = replayFor('install', correlationId);
      if (replay) return json(res, 202, { accepted: true, replayed: true, packageId: replay.packageId, diagnosticId: correlationId }, correlationId);
      if (runningJob) return json(res, 409, { error: 'UPDATE_BUSY', message: 'Es läuft bereits ein Update oder Rollback', diagnosticId: correlationId }, correlationId);
      const body = await readJson(req);
      safePackagePath(body.packagePath);
      if (!body.packageId) throw new Error('Paket-ID fehlt');
      const accepted = { packageId: body.packageId };
      rememberAccepted('install', correlationId, accepted);
      runningJob = performInstall({ ...body, requestId: correlationId });
      log('info', 'Update-Installation wurde angenommen', { diagnosticId: correlationId, packageId: body.packageId });
      return json(res, 202, { accepted: true, packageId: body.packageId, diagnosticId: correlationId }, correlationId);
    }
    if (req.method === 'POST' && url.pathname === '/restart') {
      const replay = replayFor('restart', correlationId);
      if (replay) return json(res, 202, { accepted: true, replayed: true, restartId: replay.restartId, diagnosticId: correlationId }, correlationId);
      if (runningJob) return json(res, 409, { error: 'UPDATE_BUSY', message: 'Es läuft bereits ein Update, Rollback oder Neustart', diagnosticId: correlationId }, correlationId);
      const body = await readJson(req);
      if (body.confirmation !== 'NEUSTART') throw new Error('Neustart-Bestaetigung fehlt');
      const restartId = crypto.randomUUID();
      const accepted = { restartId };
      rememberAccepted('restart', correlationId, accepted);
      runningJob = performSystemRestart({ ...body, restartId, requestId: correlationId });
      log('info', 'Manueller Neustart wurde angenommen', { diagnosticId: correlationId, restartId, requestedBy: body.requestedBy || null });
      return json(res, 202, { accepted: true, restartId, diagnosticId: correlationId }, correlationId);
    }
    if (req.method === 'POST' && url.pathname === '/rollback') {
      const replay = replayFor('rollback', correlationId);
      if (replay) return json(res, 202, { accepted: true, replayed: true, backupId: replay.backupId, diagnosticId: correlationId }, correlationId);
      if (runningJob) return json(res, 409, { error: 'UPDATE_BUSY', message: 'Es läuft bereits ein Update oder Rollback', diagnosticId: correlationId }, correlationId);
      const body = await readJson(req);
      if (!/^update-[A-Za-z0-9_.:-]+$/.test(String(body.backupId || ''))) throw new Error('Ungültige Sicherungs-ID');
      const accepted = { backupId: body.backupId };
      rememberAccepted('rollback', correlationId, accepted);
      runningJob = performRollback({ ...body, requestId: correlationId });
      log('info', 'Rollback wurde angenommen', { diagnosticId: correlationId, backupId: body.backupId });
      return json(res, 202, { accepted: true, backupId: body.backupId, diagnosticId: correlationId }, correlationId);
    }
    return json(res, 404, { error: 'NOT_FOUND', message: 'Updater-Endpunkt nicht gefunden', diagnosticId: correlationId }, correlationId);
  } catch (error) {
    const failure = requestError(error, correlationId, req);
    return json(res, failure.statusCode, failure.body, correlationId);
  }
}

const server = http.createServer(updaterRequestHandler);
const socketServer = http.createServer(updaterRequestHandler);
let socketListening = false;

function attachClientErrorHandler(target, transport) {
  target.on('clientError', (error, socket) => {
    const diagnosticId = crypto.randomUUID();
    log('warn', 'Ungültige HTTP-Anfrage am Updater', { diagnosticId, transport, error });
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
}

attachClientErrorHandler(server, 'tcp');
attachClientErrorHandler(socketServer, 'unix');

server.on('error', (error) => {
  log('error', 'Updater-HTTP-Serverfehler', { error, bindAddress: BIND_ADDRESS, port: PORT });
  process.exitCode = 1;
  setImmediate(() => process.exit(1));
});

socketServer.on('error', (error) => {
  // TCP remains as a compatibility fallback if the host filesystem cannot
  // expose Unix sockets. Do not terminate the updater only because local IPC
  // is unavailable.
  log('warn', 'Lokaler Updater-IPC-Kanal konnte nicht gestartet werden', { error, socketPath: SOCKET_PATH });
});

async function prepareSocketPath() {
  await fsp.mkdir(path.dirname(SOCKET_PATH), { recursive: true });
  await fsp.unlink(SOCKET_PATH).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}

async function applySocketPermissions() {
  await fsp.chmod(SOCKET_PATH, 0o660).catch((error) => log('warn', 'IPC-Socketrechte konnten nicht gesetzt werden', { error, socketPath: SOCKET_PATH }));
  await fsp.chown(SOCKET_PATH, SOCKET_UID, SOCKET_GID).catch((error) => log('warn', 'IPC-Socketbesitzer konnte nicht gesetzt werden', { error, socketPath: SOCKET_PATH, uid: SOCKET_UID, gid: SOCKET_GID }));
}

function closeServer(target) {
  return new Promise((resolve) => {
    if (!target.listening) return resolve(null);
    target.close((error) => resolve(error || null));
  });
}

function shutdown(signal) {
  log('info', 'Updater wird beendet', { signal });
  void Promise.all([closeServer(server), closeServer(socketServer)])
    .then(async (errors) => {
      await fsp.unlink(SOCKET_PATH).catch(() => {});
      const error = errors.find(Boolean);
      if (error) log('error', 'Updater konnte nicht sauber beendet werden', { error });
      process.exit(error ? 1 : 0);
    });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function startServers() {
  try {
    await prepareSocketPath();
    socketServer.listen(SOCKET_PATH, () => {
      socketListening = true;
      void applySocketPermissions();
      log('info', 'Lokaler Updater-IPC-Kanal gestartet', { socketPath: SOCKET_PATH, uid: SOCKET_UID, gid: SOCKET_GID });
    });
  } catch (error) {
    log('warn', 'Lokaler Updater-IPC-Kanal konnte nicht vorbereitet werden', { error, socketPath: SOCKET_PATH });
  }

  server.listen(PORT, BIND_ADDRESS, () => {
    log('info', 'Updater-HTTP-Server gestartet', { bindAddress: BIND_ADDRESS, port: PORT, ipcEnabled: socketListening });
    void initializeUpdater();
  });
}

void startServers();
