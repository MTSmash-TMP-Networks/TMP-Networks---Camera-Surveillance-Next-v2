#!/usr/bin/env node
// Fail a release if its GitHub source ZIP would be rejected by older validated updaters.
// Layout contract derived from the v2.20.32 updater and backend inspector.
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const BASELINE = '2.20.32';
export const ROOT_FILES = new Set([
  '.env.example', '.gitignore', '.gitlab-ci.yml', 'CHANGELOG.md', 'FILES.sha256',
  'LICENSE_AGREEMENT.md', 'INSTALLATION.md', 'MANIFEST.txt',
  'PRIVACY_AND_DATA_PROCESSING.md', 'README.md', 'SUPPORT_POLICY.md',
  'THIRD_PARTY_NOTICES.md', 'UPDATE_PACKAGE.json', 'VALIDATION.md',
  'VERSION', 'docker-compose.yml', 'docker-compose.gpu.yml',
  'docker-compose.https.yml', 'logs.sh', 'start.sh', 'stop.sh', 'update.sh',
]);
export const ROOT_DIRS = new Set([
  '.github', 'backend', 'frontend', 'updater', 'mediamtx', 'go2rtc',
  'caddy', 'scripts', 'docs', 'documentation', 'tools', 'data',
]);

function compareVersions(a, b) {
  const aParts = String(a).split('.'), bParts = String(b).split('.');
  if (aParts.length !== 3 || bParts.length !== 3 || ![...aParts, ...bParts].every(x => /^\d+$/.test(x))) throw new Error('Versionsformat nicht kompatibel');
  for (let i = 0; i < 3; i++) { if (+aParts[i] !== +bParts[i]) return Math.sign(+aParts[i] - +bParts[i]); }
  return 0;
}

export function assertLegacyPaths(paths) {
  for (const item of paths) {
    if (item.startsWith('/') || item.includes('\\') || item.split('/').some(x => x === '..' || x === '.' || !x)) throw new Error(`Unsicherer Pfad: ${item}`);
    const top = item.split('/')[0];
    if (['.env', '.git', 'node_modules', 'dist'].includes(top)) throw new Error(`Geschuetzter Paketpfad: ${item}`);
    if (top === 'data' && item !== 'data/.gitkeep' && !item.endsWith('/.gitkeep')) throw new Error(`Laufzeitdaten im Update: ${item}`);
    if (!ROOT_FILES.has(top) && !ROOT_DIRS.has(top) && !/^UPDATE_NOTES_\d+\.\d+\.\d+\.md$/.test(top)) throw new Error(`Legacy-Updater verbietet Root-Pfad: ${item}`);
  }
}

export function checkRelease(root) {
  const allFiles = [];
  function walk(dir, prefix = '') {
    for (const name of readdirSync(dir)) {
      const rel = prefix ? `${prefix}/${name}` : name;
      // GitHub Actions checks out the repository with its own .git metadata.
      // That metadata is not part of the distributable source archive.
      if (rel === '.git' || rel.startsWith('.git/')) continue;
      const real = path.join(dir, name), stat = lstatSync(real);
      if (stat.isSymbolicLink()) throw new Error(`Symlinks sind im Update nicht erlaubt: ${rel}`);
      if (stat.isDirectory()) walk(real, rel);
      else if (stat.isFile()) allFiles.push(rel);
      else throw new Error(`Unzulaessiger Dateityp: ${rel}`);
    }
  }
  walk(root);
  allFiles.sort();
  assertLegacyPaths(allFiles);
  const mf = JSON.parse(readFileSync(path.join(root, 'UPDATE_PACKAGE.json'), 'utf8'));
  const version = readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  if (version !== mf.version) throw new Error('VERSION und UPDATE_PACKAGE.json stimmen nicht ueberein');
  if (mf.product !== 'tmp-camera-surveillance-next') throw new Error('Falsches Produkt');
  for (const key of ['minimumVersion', 'minVersion', 'compatibleFrom', 'fromVersion']) {
    if (mf[key] !== BASELINE) throw new Error(`${key} muss fuer getestete Direktupdates ${BASELINE} enthalten (Ist: ${mf[key]})`);
  }
  const preserve = [...new Set(Array.isArray(mf.preserve) ? mf.preserve : [])].sort();
  if (preserve.join('|') !== ['.env', '.git', 'data'].sort().join('|')) {
    throw new Error('preserve muss .env, .git und data unveraendert schuetzen');
  }
  if (compareVersions(version, BASELINE) <= 0) throw new Error('Zielversion muss neuer als Upgrade-Basis sein');
  if (mf.changelogFile !== `UPDATE_NOTES_${version}.md` || !allFiles.includes(mf.changelogFile)) throw new Error('Update-Notes fehlen');
  for (const file of ['backend/package.json', 'frontend/package.json', 'updater/package.json']) {
    const pkg = JSON.parse(readFileSync(path.join(root, file), 'utf8'));
    if (pkg.version !== version) throw new Error(`Falsche Paketversion in ${file}`);
  }
  if (!readFileSync(path.join(root, 'docker-compose.yml'), 'utf8').includes(`APP_VERSION: "${version}"`)) throw new Error('Compose-Appversion stimmt nicht');
  const files = allFiles.filter(x => x !== 'FILES.sha256');
  const entries = readFileSync(path.join(root, 'FILES.sha256'), 'utf8').trim().split(/\r?\n/);
  const checksums = new Map();
  for (const line of entries) {
    const m = /^([a-fA-F0-9]{64})\s+\*?(?:\.\/)?(.+)$/.exec(line);
    if (!m || checksums.has(m[2])) throw new Error('Doppelte/ungueltige Checksum-Zeile');
    checksums.set(m[2], m[1].toLowerCase());
  }
  for (const file of files) {
    const exp = checksums.get(file);
    if (!exp) throw new Error(`Fehlende Dateiprüfsumme: ${file}`);
    const actual = crypto.createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex');
    if (actual !== exp) throw new Error(`Pruefsumme falsch: ${file}`);
    checksums.delete(file);
  }
  if (checksums.size) throw new Error(`Ueberzaehlige Pruefsummen: ${[...checksums.keys()].join(', ')}`);
  if (mf.fileCount !== files.length) throw new Error(`fileCount ${mf.fileCount} statt ${files.length}`);
  const manifestLines = readFileSync(path.join(root, 'MANIFEST.txt'), 'utf8').trim().split(/\r?\n/).sort();
  if (manifestLines.join('\n') !== files.join('\n')) throw new Error('MANIFEST.txt und tatsaechliche Dateiliste weichen ab');
  return { version, baseline: BASELINE, files: files.length, protectedData: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const result = checkRelease(root);
    console.log(`UPDATE_COMPATIBILITY_OK target=${result.version} baseline=${result.baseline} checked=${result.files}`);
  } catch (err) { console.error(`UPDATE_COMPATIBILITY_FAILED ${err.message}`); process.exitCode = 1; }
}
