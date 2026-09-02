import { readFileSync } from 'node:fs';
import { chmod, copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const compose = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8');
const page = readFileSync(resolve(root, 'frontend/src/pages/UpdatePage.jsx'), 'utf8');
const server = readFileSync(resolve(root, 'updater/src/server.js'), 'utf8');
const updateMessages = readFileSync(resolve(root, 'frontend/src/i18n/updatePageMessages.js'), 'utf8');
const inspector = readFileSync(resolve(root, 'backend/src/services/UpdatePackageInspector.js'), 'utf8');
const updaterClient = readFileSync(resolve(root, 'backend/src/services/updater/UpdaterClient.js'), 'utf8');
const updaterResolver = readFileSync(resolve(root, 'backend/src/services/updater/UpdaterEndpointResolver.js'), 'utf8');
const projectVersion = readFileSync(resolve(root, 'VERSION'), 'utf8').trim();

 test('Updater benötigt keine Host-Port-Bindung und bevorzugt lokalen IPC vor Docker-DNS', () => {
  assert.match(compose, /expose:\s*\n\s*- "\$\{UPDATER_SERVICE_PORT:-3010\}"/);
  assert.doesNotMatch(compose, /127\.0\.0\.1:\$\{UPDATER_HOST_PORT/);
  assert.match(compose, /UPDATER_SOCKET_PATH: \$\{UPDATER_SOCKET_PATH:-\/data\/updates\/tmp-camera-updater\.sock\}/);
  assert.match(compose, /UPDATER_SERVICE_NAME: \$\{UPDATER_SERVICE_NAME:-updater\}/);
  assert.match(server, /socketServer\.listen\(SOCKET_PATH/);
  assert.match(updaterResolver, /source: 'local-ipc'/);
  assert.match(updaterClient, /endpoint\.transport === 'unix'/);
});

test('Frontend erlaubt einen erneut lokalisierten Installationsversuch', () => {
  assert.match(page, /update\.action\.installTry/);
  assert.match(updateMessages, /'Installation versuchen'/);
  assert.match(updateMessages, /'Try installation'/);
  assert.doesNotMatch(page, /disabled=\{busy \|\| running \|\| !updaterOnline\}/);
});

test('Healthcheck meldet sichere Installationsvoraussetzungen', () => {
  assert.match(server, /installReady/);
  assert.match(server, /DOCKER_SOCKET_UNAVAILABLE/);
  assert.match(server, /PROJECT_MOUNT_INVALID/);
  assert.match(server, /UPDATER_TOKEN_INVALID/);
  assert.doesNotMatch(server, /projectDir:\s*PROJECT_DIR/);
  assert.doesNotMatch(server, /dataDir:\s*DATA_DIR/);
});

test('Updater maskiert Protokolle und unterstützt idempotente Anfragen', () => {
  assert.match(server, /sanitizeLogText/);
  assert.match(server, /X-Request-ID/);
  assert.match(server, /acceptedRequests/);
  assert.match(server, /diagnosticId/);
});

test('Paketprüfer akzeptieren den offiziellen tools-Ordner', () => {
  assert.match(server, /'tools'/);
  assert.match(inspector, /'tools'/);
});

test('Paketprüfer akzeptieren die mitgelieferten CI-Konfigurationen', () => {
  assert.match(server, /'\.gitlab-ci\.yml'/);
  assert.match(inspector, /'\.gitlab-ci\.yml'/);
  assert.match(server, /'\.github'/);
  assert.match(inspector, /'\.github'/);
});


test('Paketprüfer akzeptieren Lizenz-, Dokumentations- und Vertriebsunterlagen', () => {
  for (const source of [server, inspector]) {
    assert.match(source, /'LICENSE_AGREEMENT\.md'/);
    assert.match(source, /'THIRD_PARTY_NOTICES\.md'/);
    assert.match(source, /'SUPPORT_POLICY\.md'/);
    assert.match(source, /'PRIVACY_AND_DATA_PROCESSING\.md'/);
    assert.match(source, /'docs'/);
    assert.match(source, /'documentation'/);
  }
});


test('Updater kennzeichnet jede JSON-Antwort eindeutig als eigenen Dienst', () => {
  assert.match(server, /service: 'tmp-camera-updater'/);
  assert.match(server, /const responseBody = \{ \.\.\.body, service: 'tmp-camera-updater', version: currentVersion\(\) \}/);
});

test('Update-Center zeigt einen initialen Backendfehler mit Wiederholungsaktion', () => {
  assert.match(page, /Update-Center nicht erreichbar/);
  assert.match(page, /Erneut versuchen/);
});



test('Optionale GPU-Compose-Datei bleibt updatefähig und explizit aktiviert', () => {
  const gpuCompose = readFileSync(resolve(root, 'docker-compose.gpu.yml'), 'utf8');
  const composeScript = readFileSync(resolve(root, 'scripts/docker-compose.sh'), 'utf8');
  assert.match(gpuCompose, /capabilities:\s*\[gpu\]/);
  assert.match(compose, /ENABLE_NVIDIA_GPU_STATUS/);
  assert.match(compose, /ENABLE_NVIDIA_GPU_COMPOSE: \${ENABLE_NVIDIA_GPU_COMPOSE:-false}/);
  assert.match(composeScript, /ENABLE_NVIDIA_GPU_COMPOSE/);
  assert.doesNotMatch(composeScript, /ENABLE_NVIDIA_GPU_STATUS=.*docker-compose\.gpu/);
  assert.match(composeScript, /docker-compose\.gpu\.yml/);
  assert.match(server, /docker-compose\.gpu\.yml/);
  assert.match(inspector, /docker-compose\.gpu\.yml/);
});

test('Updatepaket erzwingt konsistente Versionsangaben', () => {
  assert.match(server, /validatePackageVersionConsistency/);
  assert.match(server, /APP_VERSION/);
  assert.match(inspector, /validatePackageVersionConsistency/);
  assert.match(compose, new RegExp(`APP_VERSION: \"${projectVersion.replaceAll('.', '\\.')}\"`));
});


test('Compose-Preflight nutzt eine temporaere sichere .env statt einer paketinternen echten .env', () => {
  assert.match(server, /ensurePreflightEnvFile/);
  assert.match(server, /preflightEnvText/);
  assert.match(server, /temporaere sichere \.env/);
  assert.match(server, /--env-file/);
  assert.match(server, /preflight-placeholder/);
});



test('Backend env_file bleibt mit Docker Compose vor 2.24 und macOS kompatibel', () => {
  assert.match(compose, /env_file:\s*\n\s*- \$\{PROJECT_DIR:-\.\}\/\.env/);
  assert.doesNotMatch(compose, /env_file:\s*\n\s*- path:/);
  assert.doesNotMatch(compose, /required:\s*false/);
  assert.match(server, /PROJECT_DIR:\s*path\.resolve\(root\)/);
  assert.match(server, /Docker Compose \$\{version\} wird fuer den Paket-Preflight verwendet/);
  assert.match(server, /Compose-Preflight fehlgeschlagen:/);
});


test('Updater nutzt beschreibbaren Backup-Fallback statt bei EACCES hart abzubrechen', () => {
  assert.match(compose, /BACKUPS_DIR: \/data\/backups/);
  assert.match(compose, /BACKUPS_FALLBACK_DIR: \/data\/updates\/backups/);
  assert.match(server, /FALLBACK_BACKUPS_DIR/);
  assert.match(server, /canWriteDirectory/);
  assert.match(server, /BACKUP_DIR_FALLBACK_ACTIVE/);
  assert.match(server, /BACKUP_CREATE_FAILED/);
});

test('Updater setzt Docker CLI auf beschreibbaren Datenpfad statt /root/.docker', () => {
  assert.match(compose, /DOCKER_CLI_STATE_DIR: \/data\/updates\/docker-cli/);
  assert.match(compose, /DOCKER_CONFIG: \/data\/updates\/docker-cli\/config/);
  assert.match(compose, /HOME: \/data\/updates\/docker-cli\/home/);
  assert.match(compose, /COMPOSE_BAKE: \$\{COMPOSE_BAKE:-false\}/);
  assert.match(server, /ensureDockerCliWorkspace/);
  assert.match(server, /DOCKER_CLI_CONFIG_DIR/);
  assert.match(server, /dockerCliEnv/);
  assert.doesNotMatch(server, /HOME:\s*['"]\/root/);
});

test('Rollback versucht zuerst vorhandene Images ohne erneuten Build', () => {
  assert.match(server, /--no-build/);
  assert.match(server, /ROLLBACK_NO_BUILD_START_FAILED/);
});

test('Frontend package.json und package-lock.json sind fuer npm ci synchron', () => {
  const packageJson = JSON.parse(readFileSync(resolve(root, 'frontend/package.json'), 'utf8'));
  const packageLock = JSON.parse(readFileSync(resolve(root, 'frontend/package-lock.json'), 'utf8'));
  assert.equal(packageLock.packages[''].dependencies['@reduxjs/toolkit'], packageJson.dependencies['@reduxjs/toolkit']);
  assert.equal(packageLock.packages['node_modules/@reduxjs/toolkit'].version, packageJson.dependencies['@reduxjs/toolkit']);
});

test('Paketpruefer validiert npm-Lockfiles vor dem Docker-Build', () => {
  assert.match(server, /validateNpmLockfileConsistency\(root\)/);
  assert.match(inspector, /validateNpmLockfileConsistency\(root\)/);
  assert.match(server, /Lockfile-Konflikt/);
  assert.match(inspector, /Lockfile-Konflikt/);
});


test('Updater staged das neue eigene Image ohne den aktiven Agenten zu ersetzen', () => {
  assert.doesNotMatch(server, /phase:\s*'updater_restarting'/);
  assert.match(server, /state:\s*'completed'/);
  assert.match(server, /phase:\s*'completed'/);
  assert.match(server, /progress:\s*100/);
  assert.match(server, /Neues Updater-Image wurde vorbereitet/);
  assert.match(server, /aktive Update-Agent bleibt bis zum naechsten Host-Start unveraendert/);
  assert.doesNotMatch(server, /finalizeUpdaterReplacement\(/);
});

test('Regulaerer Update-Neustart stoppt nicht mehr alle Dienste gemeinsam', () => {
  assert.match(server, /regularApplicationRestart/);
  assert.match(server, /recreateApplicationService/);
  assert.match(server, /REGULAR_RESTART_INCOMPLETE/);
  assert.match(server, /emergencyStartApplicationServices/);
  assert.doesNotMatch(server, /compose\(\['stop', \.\.\.services\]/);
  assert.doesNotMatch(server, /const services = \['frontend', 'go2rtc', 'backend'\]/);
});

test('Updater bereinigt haengenden Abschlussstatus nach Dienstneustart', () => {
  assert.match(server, /recoverStaleFinishingStatus/);
  assert.match(server, /regular_restart_done/);
  assert.match(server, /Haengender Abschlussstatus wurde beim Updater-Start automatisch bereinigt|Hängender Abschlussstatus wurde beim Updater-Start automatisch bereinigt/);
});


test('Systemstatus kann den Anwendungsstapel sicher neu starten', () => {
  const systemRoute = readFileSync(resolve(root, 'backend/src/routes/system.js'), 'utf8');
  const controlService = readFileSync(resolve(root, 'backend/src/services/SystemControlService.js'), 'utf8');
  assert.match(systemRoute, /post\('\/restart'/);
  assert.match(systemRoute, /confirmation: z\.literal\('NEUSTART'\)/);
  assert.match(controlService, /SYSTEM_RESTART_BUSY/);
  assert.match(controlService, /updaterClient\.post\('\/restart'/);
  assert.match(server, /url\.pathname === '\/restart'/);
  assert.match(server, /performSystemRestart/);
  assert.match(server, /SYSTEM_RESTART_RECOVERY_REQUIRED/);
});

test('Updater repariert vor dem Dienststart auch den lokalen HLS-Ring', () => {
  assert.match(server, /path\.join\(DATA_DIR, 'live'\)/);
  assert.match(server, /quotedLive/);
  assert.match(server, /chmod 775 \$\{quotedLive\}/);
  assert.match(compose, /GO2RTC_API: http:\/\/mediamtx:1984\/media\/go2rtc/);
});

test('Updater-Rechte-Reparatur maskiert POSIX-Klammern fuer dash und BusyBox sh', () => {
  assert.ok(server.includes(String.raw`-type f \\( -name`));
  assert.ok(server.includes(String.raw`db-shm' \\) -exec`));
  assert.match(server, /replaceAll\("'"/);
});

test('Updater kann auch einen bei 65 Prozent verbliebenen Neustartstatus bereinigen', () => {
  assert.match(server, /new Set\(\['restarting', 'verifying', 'regular_restart'/);
});

test('Updater übernimmt den tatsächlichen Compose-Projektnamen statt einen zweiten Stack zu erzeugen', () => {
  assert.match(server, /projectIdentityFromInspect/);
  assert.match(server, /Aktiver Compose-Projektname wurde aus dem laufenden Updater übernommen/);
  assert.match(server, /COMPOSE_PROJECT_NAME: context\.composeProjectName/);
  assert.doesNotMatch(server, /--filter', `label=com\.docker\.compose\.project=\$\{env\.COMPOSE_PROJECT_NAME/);
  assert.match(compose, /COMPOSE_PROJECT_NAME: \$\{COMPOSE_PROJECT_NAME:-tmp-camera-surveillance-next\}/);
});

test('Dienstneustart entfernt alle alten Container desselben Compose-Dienstes vor dem Start', () => {
  assert.match(server, /composeServiceContainerIds/);
  assert.match(server, /label=com\.docker\.compose\.project=\$\{context\.composeProjectName\}/);
  assert.match(server, /execute\('docker', \['rm', '-f', \.\.\.ids\]/);
  assert.match(server, /replaceComposeService\(context, 'mediamtx'\)/);
});


test('Normaler Start erzwingt die Aktualisierung des internen Updater-Dienstes', () => {
  const start = readFileSync(resolve(root, 'start.sh'), 'utf8');
  assert.match(start, /up -d --no-deps --force-recreate updater/);
  assert.match(start, /up -d backend mediamtx frontend/);
});

test('Containerstatus ermittelt nur die Compose-Projektkennung und verlangt keinen Host-Projektpfad', () => {
  assert.match(server, /Runtime diagnostics only need the Compose project label/);
  assert.match(server, /currentContainerId: String\(os\.hostname\(\)/);
  const runtimeBlock = server.slice(server.indexOf('async function runtimeDockerContext'), server.indexOf('async function runtimeContainerStatus'));
  assert.doesNotMatch(runtimeBlock, /dockerContext\(\{ quiet: true \}\)/);
  assert.doesNotMatch(runtimeBlock, /hostProjectPath/);
});


test('In-App-Update ersetzt den laufenden Updater nicht mehr selbst', () => {
  const composeScript = readFileSync(resolve(root, 'scripts/docker-compose.sh'), 'utf8');
  assert.match(composeScript, /UPDATER_SELF_REPLACE/);
  assert.match(composeScript, /self-replacement intentionally deferred/);
  assert.match(composeScript, /exit 0/);
  assert.doesNotMatch(composeScript, /stabilize_after_updater_recreate/);
  assert.doesNotMatch(composeScript, /down --remove-orphans/);
  assert.match(server, /Do NOT replace the updater from inside its own update transaction/);
  assert.doesNotMatch(server, /finalizeUpdaterReplacement\(/);
});

test('2.20.16-Finalizer-Aufruf wird ohne Docker-Compose-Aktion sicher abgefangen', async () => {
  const dir = await mkdtemp(resolve(os.tmpdir(), 'tmp-camera-finalizer-'));
  try {
    const script = resolve(dir, 'docker-compose.sh');
    await copyFile(resolve(root, 'scripts/docker-compose.sh'), script);
    await chmod(script, 0o755);
    const result = spawnSync('/bin/sh', [script, 'up', '-d', '--no-deps', '--force-recreate', 'updater'], {
      cwd: dir,
      env: {
        ...process.env,
        HOME: '/tmp/home',
        DOCKER_CONFIG: '/tmp/docker-config',
        PROJECT_HOST_PATH: '/opt/tmp-camera-surveillance-next',
        COMPOSE_PROJECT_NAME: 'tmp-camera-surveillance-next',
        PATH: '/usr/bin:/bin',
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const log = await readFile(resolve(dir, 'data/updates/updater-finalizer.log'), 'utf8');
    assert.match(log, /self-replacement intentionally deferred/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Backend maskiert einen ausgefallenen Updater nach dem Update nicht mehr als erwarteten Neustart', () => {
  const updateService = readFileSync(resolve(root, 'backend/src/services/UpdateService.js'), 'utf8');
  assert.doesNotMatch(updateService, /updaterRestartGraceActive/);
  assert.doesNotMatch(updateService, /UPDATER_RESTARTING/);
  assert.match(updateService, /const publicUpdaterHealth = health/);
});
