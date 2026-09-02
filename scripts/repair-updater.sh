#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
COMPOSE="./scripts/docker-compose.sh"

random_secret() { head -c 48 /dev/urandom | base64 | tr -d '\n'; }
ensure_env_key() {
  key="$1"
  value="$2"
  grep -q "^${key}=" .env 2>/dev/null || printf '%s=%s\n' "$key" "$value" >> .env
}
upsert_env_key() {
  key="$1"
  value="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    awk -v key="$key" -v value="$value" 'BEGIN{done=0} $0 ~ "^" key "=" { if (!done) { print key "=" value; done=1 } next } { print } END{ if (!done) print key "=" value }' .env > .env.upsert.tmp
    mv .env.upsert.tmp .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

docker_host() {
  if docker info >/dev/null 2>&1; then docker "$@"; return; fi
  if command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then sudo docker "$@"; return; fi
  return 1
}

valid_project_name() {
  case "$1" in ""|*[!A-Za-z0-9_-]*|[-_]* ) return 1;; *) return 0;; esac
}

active_compose_project_name() {
  root="$1"
  data_path="$root/data"
  config_path="$root/mediamtx"
  for service in updater backend mediamtx frontend; do
    ids="$(docker_host ps -a --filter label=com.docker.compose.service=$service --format '{{.ID}}' 2>/dev/null || true)"
    for id in $ids; do
      match="$(docker_host inspect -f '{{range .Mounts}}{{if or (eq .Destination "/workspace") (eq .Destination "/data") (eq .Destination "/config")}}{{println .Destination "=" .Source}}{{end}}{{end}}' "$id" 2>/dev/null | awk -v root="$root" -v data="$data_path" -v config="$config_path" '
        $1 == "/workspace" && $3 == root { print "yes"; exit }
        $1 == "/data" && $3 == data { print "yes"; exit }
        $1 == "/config" && $3 == config { print "yes"; exit }
      ' || true)"
      [ "$match" = "yes" ] || continue
      project="$(docker_host inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$id" 2>/dev/null || true)"
      if valid_project_name "$project"; then printf '%s' "$project"; return 0; fi
    done
  done
  return 1
}

if [ ! -f .env ]; then
  printf '%s\n' 'Die Datei .env fehlt. Bitte zuerst ./start.sh ausführen.' >&2
  exit 1
fi

if ! grep -q '^UPDATER_TOKEN=.' .env; then
  printf '\nUPDATER_TOKEN=%s\n' "$(random_secret)" >> .env
  printf '%s\n' 'Ein neuer interner Updater-Schluessel wurde in .env angelegt.'
fi
PROJECT_PATH="$(pwd -P)"
PROJECT_PATH_ESCAPED=$(printf '%s' "$PROJECT_PATH" | sed 's/\\/\\\\/g; s/"/\\"/g')
CURRENT_PROJECT_NAME="$(active_compose_project_name "$PROJECT_PATH" 2>/dev/null || true)"
if ! valid_project_name "$CURRENT_PROJECT_NAME"; then
  CURRENT_PROJECT_NAME=$(awk -F= '$1 == "COMPOSE_PROJECT_NAME" { sub(/^[^=]*=/, ""); gsub(/^[ 	]*"|"[ 	]*$/, ""); gsub(/^[ 	]+|[ 	]+$/, ""); print; exit }' .env 2>/dev/null || true)
fi
if ! valid_project_name "$CURRENT_PROJECT_NAME"; then
  CURRENT_PROJECT_NAME=tmp-camera-surveillance-next
fi
upsert_env_key COMPOSE_PROJECT_NAME "$CURRENT_PROJECT_NAME"
export COMPOSE_PROJECT_NAME="$CURRENT_PROJECT_NAME"
upsert_env_key PROJECT_HOST_PATH "\"$PROJECT_PATH_ESCAPED\""
upsert_env_key UPDATER_SERVICE_PROTOCOL http
upsert_env_key UPDATER_SERVICE_NAME updater
upsert_env_key UPDATER_SERVICE_PORT 3010
upsert_env_key UPDATER_SERVICE_BASE_PATH ''
upsert_env_key UPDATER_SOCKET_PATH /data/updates/tmp-camera-updater.sock
upsert_env_key UPDATER_URLS ''
upsert_env_key UPDATER_URL ''
upsert_env_key UPDATER_FALLBACK_URLS 'http://tmp-camera-updater:3010,http://updater:3010'
upsert_env_key UPDATER_FALLBACK_URL ''
ensure_env_key UPDATER_HEALTH_TIMEOUT_MS 3500
ensure_env_key UPDATER_REQUEST_TIMEOUT_MS 15000
ensure_env_key UPDATER_HEALTH_RETRIES 1
ensure_env_key UPDATER_REQUEST_RETRIES 1
ensure_env_key UPDATER_RETRY_DELAY_MS 250
ensure_env_key UPDATER_RESTART_GRACE_MS 300000
ensure_env_key UPDATER_IDEMPOTENCY_TTL_MS 900000
ensure_env_key BACKUPS_DIR /data/backups
ensure_env_key BACKUPS_FALLBACK_DIR /data/updates/backups
ensure_env_key COMPOSE_BAKE false
ensure_env_key DOCKER_BUILDKIT 0
ensure_env_key COMPOSE_DOCKER_CLI_BUILD 0
ensure_env_key FORCE_IMAGE_PULL false
ensure_env_key DOCKER_API_VERSION ''
ensure_env_key BACKEND_HEALTH_URL http://backend:3000/health
ensure_env_key FRONTEND_HEALTH_URL http://frontend:8080/healthz
chmod 600 .env

mkdir -p data/live data/snapshots data/recordings data/updates/packages data/updates/staging data/updates/backups data/updates/docker-cli/home data/updates/docker-cli/config data/updates/docker-cli/buildx data/backups
PUID_VALUE=$(awk -F= '$1 == "PUID" {print $2}' .env | tail -n1 | tr -d '"')
PGID_VALUE=$(awk -F= '$1 == "PGID" {print $2}' .env | tail -n1 | tr -d '"')
[ -n "$PUID_VALUE" ] || PUID_VALUE=$(id -u)
[ -n "$PGID_VALUE" ] || PGID_VALUE=$(id -g)
if [ "$(id -u)" = "0" ]; then
  chown -R "${PUID_VALUE}:${PGID_VALUE}" data 2>/dev/null || true
fi
chmod 750 data data/recordings 2>/dev/null || true
chmod 775 data/live data/snapshots 2>/dev/null || true
chmod 775 data/backups data/updates data/updates/packages data/updates/staging data/updates/backups data/updates/docker-cli data/updates/docker-cli/home data/updates/docker-cli/config data/updates/docker-cli/buildx 2>/dev/null || true
chmod 660 data/kamera_server.db data/kamera_server.db-wal data/kamera_server.db-shm 2>/dev/null || true

printf '%s\n' 'Updater-Image und Backend-Konfiguration werden neu aufgebaut ...'
FORCE_PULL_VALUE=$(awk -F= '$1 == "FORCE_IMAGE_PULL" {print tolower($2)}' .env | tail -n1 | tr -d '"')
sh ./scripts/docker-cache-cleanup.sh pre-repair || true
case "$FORCE_PULL_VALUE" in 1|true|yes|on) $COMPOSE build --pull updater backend;; *) $COMPOSE build updater backend;; esac
sh ./scripts/docker-cache-cleanup.sh post-repair || true
printf '%s\n' 'Updater und Backend werden mit dem lokalen IPC-Kanal und den Kompatibilitaets-Fallbacks neu erstellt ...'
$COMPOSE up -d --no-deps --force-recreate updater
$COMPOSE up -d --no-deps --force-recreate backend

attempt=0
while [ "$attempt" -lt 30 ]; do
  attempt=$((attempt + 1))
  if $COMPOSE exec -T updater node src/healthcheck.js >/dev/null 2>&1 \
    && $COMPOSE exec -T backend node src/cli/updater-healthcheck.js >/dev/null 2>&1; then
    printf '%s\n' 'Updater ist intern erreichbar; der Backend-Updater-Kanal ist betriebsbereit.'
    $COMPOSE exec -T backend node src/cli/updater-healthcheck.js || true
    $COMPOSE ps updater backend
    exit 0
  fi
  sleep 2
done

printf '%s\n' 'Updater wurde nicht vollständig erreichbar. Sichere Diagnose:' >&2
$COMPOSE ps updater backend >&2 || true
$COMPOSE exec -T backend node src/cli/updater-healthcheck.js >&2 || true
$COMPOSE logs --tail=160 updater backend >&2 || true
exit 1
