import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { AppError } from '../utils/errors.js';
import { inspectUpdatePackage } from './UpdatePackageInspector.js';
import { updaterClient } from './updater/UpdaterClient.js';
import { publicContainerImage } from '../utils/containerBranding.js';

const packagesDir = path.join(config.updatesDir, 'packages');
const statusFile = path.join(config.updatesDir, 'status.json');
const historyFile = path.join(config.updatesDir, 'history.json');
const backupsDir = path.join(config.dataDir, 'backups');

async function ensureDirectories() {
  await fsp.mkdir(packagesDir, { recursive: true, mode: 0o775 });
  await fsp.mkdir(backupsDir, { recursive: true, mode: 0o750 });
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}

async function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o640 });
  await fsp.rename(temp, file);
}

function packageId(value) {
  if (!/^[a-f0-9-]{20,80}$/i.test(String(value || ''))) throw new AppError(400, 'UPDATE_PACKAGE_INVALID', 'Ungültige Update-Paket-ID');
  return String(value);
}

function metadataPath(id) { return path.join(packagesDir, `${packageId(id)}.json`); }
function archivePath(id) { return path.join(packagesDir, `${packageId(id)}.zip`); }

function cleanFilename(value) {
  const base = path.basename(String(value || 'update.zip')).replace(/[^A-Za-z0-9._+-]/g, '_').slice(0, 180);
  return base.toLowerCase().endsWith('.zip') ? base : `${base}.zip`;
}

function publicUpdateText(value, maxLength = 2000) {
  return String(value || '')
    .replace(/(https?:\/\/)([^\s/@]+):([^\s/@]+)@/gi, '$1[REDACTED]@')
    .replace(/https?:\/\/[^\s,;]+/gi, '[interner Endpunkt]')
    .replace(/\bfetch failed\b/gi, 'Verbindung zum internen Dienst fehlgeschlagen')
    .replace(/getaddrinfo\s+(?:ENOTFOUND|EAI_AGAIN)\s+[^\s,;]+/gi, 'Namensauflösung des internen Dienstes fehlgeschlagen')
    .replace(/\b(token|password|secret|authorization|credential)(\s*[:=]\s*)([^\s,;&]+)/gi, '$1$2[REDACTED]')
    .replace(/(?:\/workspace|\/data|\/var\/run\/docker\.sock)(?:\/[^\s,;]*)?/g, '[interner Pfad]')
    .slice(0, maxLength);
}

function publicStatus(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    state: String(input.state || 'idle'),
    phase: String(input.phase || 'idle'),
    progress: Number.isFinite(Number(input.progress)) ? Number(input.progress) : 0,
    message: publicUpdateText(input.message || 'Kein Update aktiv'),
    error: input.error ? publicUpdateText(input.error) : null,
    logs: Array.isArray(input.logs) ? input.logs.slice(-160).map((entry) => ({ at: entry?.at || null, message: publicUpdateText(entry?.message) })) : [],
    updatedAt: input.updatedAt || null,
    packageId: input.packageId || null,
    targetVersion: input.targetVersion || null,
    backupId: input.backupId || null,
    startedAt: input.startedAt || null,
    completedAt: input.completedAt || null,
    installedVersion: input.installedVersion || null,
    diagnosticId: input.diagnosticId || null,
  };
}

function publicHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map((entry) => ({
    id: entry?.id || crypto.randomUUID(),
    packageId: entry?.packageId || null,
    fromVersion: entry?.fromVersion || null,
    toVersion: entry?.toVersion || null,
    status: entry?.status || 'unknown',
    backupId: entry?.backupId || null,
    startedAt: entry?.startedAt || null,
    completedAt: entry?.completedAt || null,
    error: entry?.error ? publicUpdateText(entry.error) : null,
    diagnosticId: entry?.diagnosticId || null,
  }));
}

function isUpdaterSelfRestartStatus(value) {
  return value?.state === 'running'
    && value?.phase === 'updater_restarting'
    && String(value?.installedVersion || '') === String(config.appVersion || '')
    && Number(value?.progress || 0) >= 99;
}

function updaterHealthIsOffline(value) {
  return value?.reachable === false || value?.status === 'offline' || value?.code === 'UPDATER_UNAVAILABLE';
}

async function recoverCompletedUpdaterSelfRestart(status, updaterHealth) {
  if (!isUpdaterSelfRestartStatus(status)) return status;
  const updatedAtMs = Date.parse(status.updatedAt || '');
  const stale = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs > 20_000 : true;
  if (!stale && !updaterHealthIsOffline(updaterHealth)) return status;
  const completed = {
    ...status,
    state: 'completed',
    phase: 'completed',
    progress: 100,
    message: `Update auf Version ${status.installedVersion || config.appVersion} vollständig abgeschlossen`,
    error: null,
    completedAt: status.completedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    logs: [
      ...(Array.isArray(status.logs) ? status.logs : []),
      { at: new Date().toISOString(), message: 'Backend hat den hängenden Updater-Selbstneustart nach erfolgreicher Versionsübernahme abgeschlossen.' },
    ].slice(-160),
  };
  try { await writeJsonAtomic(statusFile, completed); } catch { /* Statusanzeige trotzdem enthaengen */ }
  return completed;
}

async function listPackages() {
  await ensureDirectories();
  const entries = await fsp.readdir(packagesDir, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const item = await readJson(path.join(packagesDir, entry.name), null);
    if (item?.id) items.push(item);
  }
  return items.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
}

function safeContainerText(value, maxLength = 240) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength) || null;
}


function publicContainerStatus(payload) {
  const allowedStatus = new Set(['ok', 'warning', 'critical', 'unavailable']);
  const allowedRuntimeStates = new Set(['healthy', 'running', 'starting', 'restarting', 'paused', 'created', 'removing', 'unhealthy', 'dead', 'stopped', 'missing', 'unknown']);
  const items = Array.isArray(payload?.items) ? payload.items.slice(0, 32).map((item) => ({
    id: safeContainerText(item?.id, 16),
    service: safeContainerText(item?.service, 80),
    name: safeContainerText(item?.name, 160),
    image: publicContainerImage(item),
    status: allowedRuntimeStates.has(String(item?.status)) ? String(item.status) : 'unknown',
    severity: ['ok', 'warning', 'critical'].includes(String(item?.severity)) ? String(item.severity) : 'warning',
    essential: Boolean(item?.essential),
    running: Boolean(item?.running),
    health: ['healthy', 'unhealthy', 'starting'].includes(String(item?.health)) ? String(item.health) : null,
    healthFailingStreak: Math.max(0, Number(item?.healthFailingStreak || 0)),
    healthLastCheckedAt: item?.healthLastCheckedAt || null,
    restartCount: Math.max(0, Number(item?.restartCount || 0)),
    exitCode: Number.isFinite(Number(item?.exitCode)) ? Number(item.exitCode) : null,
    oomKilled: Boolean(item?.oomKilled),
    startedAt: item?.startedAt || null,
    finishedAt: item?.finishedAt || null,
    uptimeSeconds: Number.isFinite(Number(item?.uptimeSeconds)) ? Math.max(0, Number(item.uptimeSeconds)) : null,
  })) : [];
  const summaryInput = payload?.summary || {};
  const summary = Object.fromEntries(['total', 'running', 'healthy', 'warning', 'critical', 'restarting', 'stopped', 'missing']
    .map((key) => [key, Math.max(0, Number(summaryInput[key] || 0))]));
  return {
    status: allowedStatus.has(String(payload?.status)) ? String(payload.status) : 'unavailable',
    generatedAt: payload?.generatedAt || new Date().toISOString(),
    source: payload?.source === 'docker-engine' ? 'docker-engine' : null,
    project: safeContainerText(payload?.project, 160),
    summary,
    items,
    message: safeContainerText(payload?.message, 500),
  };
}

async function listBackups() {
  try {
    const entries = await fsp.readdir(backupsDir, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('update-')) continue;
      const item = await readJson(path.join(backupsDir, entry.name, 'backup.json'), null);
      if (item?.id) items.push({ id: item.id, version: item.version, createdAt: item.createdAt, database: Boolean(item.database) });
    }
    return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 20);
  } catch { return []; }
}

// Hard-coded official repository: do not allow arbitrary update URLs supplied by clients.
const GITHUB_REPO = 'MTSmash-TMP-Networks/TMP-Networks---Camera-Surveillance-Next-v2';
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/commits/main`;
const GITHUB_MAX_REDIRECTS = 3;
const GITHUB_ALLOWED_HOSTS = new Set(['codeload.github.com', 'github.com', 'objects.githubusercontent.com']);
let githubPreparation = null;

function compareGitHubVersions(a, b) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
    if (!m) throw new AppError(502, 'GITHUB_VERSION_INVALID', 'GitHub meldet eine ungültige Versionsnummer');
    return m.slice(1).map(Number);
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

async function githubRequest(url, { timeoutMs = 12000, redirects = 0, archive = false } = {}) {
  const target = new URL(url);
  const allowed = archive ? GITHUB_ALLOWED_HOSTS : new Set(['api.github.com', 'raw.githubusercontent.com']);
  if (target.protocol !== 'https:' || !allowed.has(target.hostname) || target.username || target.password || target.port) {
    throw new AppError(502, 'GITHUB_HOST_INVALID', 'GitHub hat eine unzulässige Download-Adresse geliefert');
  }
  let response;
  try {
    response = await fetch(target, {
      redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'TMP-Camera-Update-Center', Accept: archive ? 'application/zip' : 'application/json, text/plain' },
    });
  } catch (cause) {
    const code = String(cause?.cause?.code || cause?.code || '');
    const explanation = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
      ? 'DNS-Auflösung ist fehlgeschlagen; bitte DNS und Internetzugriff des Backend-Containers prüfen'
      : code === 'ETIMEDOUT' || cause?.name === 'TimeoutError'
        ? 'Zeitüberschreitung bei der GitHub-Verbindung'
        : code.includes('CERT') || code.includes('TLS')
          ? 'TLS-Zertifikat konnte nicht geprüft werden; Systemzeit und Zertifikatskette prüfen'
          : 'GitHub konnte nicht erreicht werden; bitte Netzwerk/Firewall des Backend-Containers prüfen';
    throw new AppError(502, 'GITHUB_UNREACHABLE', explanation);
  }
  if (archive && [301, 302, 303, 307, 308].includes(response.status)) {
    if (redirects >= GITHUB_MAX_REDIRECTS) throw new AppError(502, 'GITHUB_REDIRECT_FAILED', 'Zu viele Weiterleitungen bei GitHub');
    const next = response.headers.get('location');
    if (!next) throw new AppError(502, 'GITHUB_REDIRECT_FAILED', 'GitHub hat kein Download-Ziel geliefert');
    await response.body?.cancel();
    return githubRequest(new URL(next, target).toString(), { timeoutMs, redirects: redirects + 1, archive: true });
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError(502, 'GITHUB_RESPONSE_FAILED', response.status === 403 || response.status === 429 ? 'GitHub-API-Limit erreicht oder Zugriff gesperrt; später erneut prüfen' : `GitHub antwortete mit HTTP ${response.status}`);
  }
  return response;
}

async function githubLatest() {
  const commitResponse = await githubRequest(GITHUB_API);
  const commitData = await commitResponse.json();
  const sha = String(commitData?.sha || '');
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new AppError(502, 'GITHUB_COMMIT_INVALID', 'GitHub hat keinen gültigen Commit geliefert');
  const versionResponse = await githubRequest(`https://raw.githubusercontent.com/${GITHUB_REPO}/${sha}/VERSION`);
  const latestVersion = (await versionResponse.text()).trim();
  const available = compareGitHubVersions(latestVersion, config.appVersion) > 0;
  return {
    repository: GITHUB_REPO,
    branch: 'main',
    commit: sha,
    currentVersion: config.appVersion,
    latestVersion,
    available,
    checkedAt: new Date().toISOString(),
    commitUrl: `https://github.com/${GITHUB_REPO}/commit/${sha}`,
  };
}

async function prepareGithubPackage(expectedSha, uploadedBy) {
  if (githubPreparation) throw new AppError(409, 'GITHUB_PREPARATION_BUSY', 'Ein GitHub-Download wird bereits vorbereitet');
  githubPreparation = true;
  try {
    const latest = await githubLatest();
    if (!latest.available) throw new AppError(409, 'GITHUB_NO_UPDATE', 'Es gibt keine neuere GitHub-Version');
    if (latest.commit !== expectedSha) throw new AppError(409, 'GITHUB_COMMIT_CHANGED', 'GitHub wurde inzwischen aktualisiert. Bitte erneut nach Updates suchen');
    await ensureDirectories();
    const response = await githubRequest(`https://codeload.github.com/${GITHUB_REPO}/zip/${latest.commit}`, { archive: true, timeoutMs: 30000 });
    if (!response.body) throw new AppError(502, 'GITHUB_DOWNLOAD_EMPTY', 'GitHub lieferte kein Archiv');
    let item;
    try {
      item = await updateService.upload(
        // Node fetch supplies a web stream; convert it to a Node stream for the existing guarded ZIP pipeline.
        Readable.fromWeb(response.body), `GitHub-${latest.latestVersion}-${latest.commit.slice(0, 12)}.zip`, uploadedBy,
        response.headers.get('content-length') || null,
      );
    } catch (error) {
      if (/FILE[S]?\.sha256|Prüfsumme|Datei fehlt|nicht vorhandene Datei|Unbekannter oberster Paketpfad/i.test(String(error?.message || ''))) {
        throw new AppError(422, 'GITHUB_MANIFEST_INCONSISTENT', 'Das GitHub-Archiv stimmt nicht mit dem Dateimanifest überein. Bitte die Release-Dateiliste auf GitHub korrigieren.');
      }
      throw error;
    }
    if (item.inspection.version !== latest.latestVersion) {
      await updateService.remove(item.id);
      throw new AppError(502, 'GITHUB_PACKAGE_VERSION_MISMATCH', 'GitHub-Versionsdatei und geprüftes ZIP stimmen nicht überein');
    }
    // The archive passes the identical path, checksums, version and archive checks as a manual ZIP upload.
    const annotated = { ...item, source: 'github', github: { repository: latest.repository, commit: latest.commit, commitUrl: latest.commitUrl } };
    await writeJsonAtomic(metadataPath(item.id), annotated);
    return annotated;
  } finally {
    githubPreparation = null;
  }
}

export const updateService = {
  githubLatest,
  prepareGithubPackage,
  async containerStatus({ requestId } = {}) {
    try {
      return publicContainerStatus(await updaterClient.get('/runtime/containers', {
        requestId,
        timeoutMs: Math.max(3000, config.updaterHealthTimeoutMs),
      }));
    } catch {
      return publicContainerStatus({
        status: 'unavailable',
        generatedAt: new Date().toISOString(),
        source: null,
        project: null,
        summary: {},
        items: [],
        message: 'Containerstatus konnte nicht vom internen Laufzeitdienst geladen werden.',
      });
    }
  },

  async overview({ requestId } = {}) {
    const [packages, backups, health, rawStatus, history] = await Promise.all([
      listPackages(), listBackups(), updaterClient.health({ requestId }), readJson(statusFile, { state: 'idle', phase: 'idle', progress: 0, message: 'Kein Update aktiv', logs: [] }), readJson(historyFile, []),
    ]);
    const status = await recoverCompletedUpdaterSelfRestart(rawStatus, health);
    const publicUpdaterHealth = health;
    return {
      currentVersion: config.appVersion,
      maxUploadBytes: config.maxUpdateBytes,
      updater: publicUpdaterHealth,
      installationAttemptAllowed: !publicUpdaterHealth.restarting,
      status: publicStatus(status),
      packages,
      backups,
      history: publicHistory(history),
    };
  },

  async upload(readable, originalName, uploadedBy, declaredLength = null) {
    await ensureDirectories();
    const announced = declaredLength === null ? null : Number(declaredLength);
    if (announced !== null && (!Number.isFinite(announced) || announced < 1)) throw new AppError(400, 'UPDATE_FILE_REQUIRED', 'Bitte eine Update-ZIP auswählen');
    if (announced !== null && announced > config.maxUpdateBytes) throw new AppError(413, 'UPDATE_TOO_LARGE', `Das Update darf höchstens ${config.maxUpdateBytes} Byte groß sein`);
    const id = crypto.randomUUID();
    const zipPath = archivePath(id);
    const temp = `${zipPath}.uploading`;
    const hash = crypto.createHash('sha256');
    let size = 0;
    let signature = Buffer.alloc(0);
    const guard = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > config.maxUpdateBytes) return callback(new AppError(413, 'UPDATE_TOO_LARGE', `Das Update darf höchstens ${config.maxUpdateBytes} Byte groß sein`));
        if (signature.length < 4) signature = Buffer.concat([signature, chunk]).subarray(0, 4);
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(readable, guard, fs.createWriteStream(temp, { mode: 0o640, flags: 'wx' }));
      if (size < 4) throw new AppError(400, 'UPDATE_FILE_REQUIRED', 'Bitte eine Update-ZIP auswählen');
      if (!(signature[0] === 0x50 && signature[1] === 0x4b && [0x03, 0x05, 0x07].includes(signature[2]))) throw new AppError(400, 'UPDATE_NOT_ZIP', 'Die hochgeladene Datei ist kein gültiges ZIP-Archiv');
      await fsp.rename(temp, zipPath);
      const inspection = await inspectUpdatePackage(zipPath);
      const item = {
        id,
        filename: cleanFilename(originalName),
        uploadedAt: new Date().toISOString(),
        uploadedBy,
        size,
        sha256: hash.digest('hex'),
        inspection,
      };
      await writeJsonAtomic(metadataPath(id), item);
      return item;
    } catch (error) {
      await fsp.rm(temp, { force: true });
      await fsp.rm(zipPath, { force: true });
      await fsp.rm(metadataPath(id), { force: true });
      throw error;
    }
  },

  async install(id, installedBy, requestId = undefined) {
    const safeId = packageId(id);
    const metadata = await readJson(metadataPath(safeId), null);
    if (!metadata?.id || !fs.existsSync(archivePath(safeId))) throw new AppError(404, 'UPDATE_PACKAGE_NOT_FOUND', 'Update-Paket wurde nicht gefunden');
    const status = await readJson(statusFile, {});
    if (status.state === 'running') throw new AppError(409, 'UPDATE_BUSY', 'Es läuft bereits ein Update oder Rollback');
    return updaterClient.post('/install', { packageId: safeId, packagePath: archivePath(safeId), installedBy }, { requestId });
  },

  async rollback(backupId, installedBy, requestId = undefined) {
    if (!/^update-[A-Za-z0-9_.:-]+$/.test(String(backupId || ''))) throw new AppError(400, 'BACKUP_INVALID', 'Ungültige Sicherungs-ID');
    const status = await readJson(statusFile, {});
    if (status.state === 'running') throw new AppError(409, 'UPDATE_BUSY', 'Es läuft bereits ein Update oder Rollback');
    return updaterClient.post('/rollback', { backupId, installedBy }, { requestId });
  },

  async remove(id) {
    const safeId = packageId(id);
    const status = await readJson(statusFile, {});
    if (status.state === 'running' && status.packageId === safeId) throw new AppError(409, 'UPDATE_PACKAGE_ACTIVE', 'Das aktuell installierte Update kann nicht gelöscht werden');
    const existed = fs.existsSync(metadataPath(safeId)) || fs.existsSync(archivePath(safeId));
    await Promise.all([fsp.rm(metadataPath(safeId), { force: true }), fsp.rm(archivePath(safeId), { force: true })]);
    if (!existed) throw new AppError(404, 'UPDATE_PACKAGE_NOT_FOUND', 'Update-Paket wurde nicht gefunden');
  },
};
