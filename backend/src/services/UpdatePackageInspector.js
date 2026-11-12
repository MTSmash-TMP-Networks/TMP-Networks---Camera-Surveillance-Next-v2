import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { config } from '../config.js';

const PACKAGES_DIR = path.join(config.updatesDir, 'packages');
const PRODUCT_ID = 'tmp-camera-surveillance-next';
const MAX_EXTRACTED_BYTES = Number(process.env.MAX_EXTRACTED_BYTES || 2147483648);
const ALLOWED_ROOT_FILES = new Set([
  '.env.example', '.gitignore', '.gitlab-ci.yml', 'CHANGELOG.md', 'FILES.sha256', 'LICENSE_AGREEMENT.md',
  'INSTALLATION.md', 'MANIFEST.txt', 'PRIVACY_AND_DATA_PROCESSING.md', 'README.md', 'SUPPORT_POLICY.md', 'THIRD_PARTY_NOTICES.md',
  'UPDATE_PACKAGE.json', 'VALIDATION.md', 'VERSION', 'docker-compose.yml', 'docker-compose.gpu.yml', 'docker-compose.https.yml', 'logs.sh', 'start.sh',
  'stop.sh', 'update.sh',
]);
const ALLOWED_ROOT_DIRS = new Set([
  '.github', 'backend', 'frontend', 'desktop-client', 'updater', 'mediamtx', 'go2rtc', 'caddy', 'scripts', 'docs', 'documentation', 'tools', 'data',
]);

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

function currentVersion() { return config.appVersion; }

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
  const { cwd = process.cwd(), timeoutMs = 15 * 60_000, env: customEnv = {}, onLine = null } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...customEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
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

export async function inspectUpdatePackage(packagePath) {
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

