#!/usr/bin/env sh
set -eu

TARGET_DIR="${1:-.}"
cd "$TARGET_DIR"
TARGET_DIR="$(pwd -P)"
STAMP="$(date +%Y%m%d-%H%M%S 2>/dev/null || printf '%s' manual)"

run_docker() {
  if docker info >/dev/null 2>&1; then docker "$@"; return; fi
  if command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then sudo docker "$@"; return; fi
  printf '%s\n' 'Docker ist nicht erreichbar.' >&2
  exit 1
}

WEBRTC_PORT="$(awk -F= '$1 == "WEBRTC_ICE_PORT" {gsub(/^"|"$/, "", $2); print $2; exit}' .env 2>/dev/null || true)"
[ -n "$WEBRTC_PORT" ] || WEBRTC_PORT=8189
OWNER_ID="$(run_docker ps --filter "publish=$WEBRTC_PORT" --format '{{.ID}}' 2>/dev/null | head -n1 || true)"
ACTIVE_PROJECT=""

if [ -n "$OWNER_ID" ]; then
  ACTIVE_PROJECT="$(run_docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$OWNER_ID" 2>/dev/null || true)"
fi

if [ -z "$ACTIVE_PROJECT" ]; then
  for id in $(run_docker ps --filter label=com.docker.compose.service=updater --format '{{.ID}}' 2>/dev/null || true); do
    source="$(run_docker inspect -f '{{range .Mounts}}{{if eq .Destination "/workspace"}}{{.Source}}{{end}}{{end}}' "$id" 2>/dev/null || true)"
    [ "$source" = "$TARGET_DIR" ] || continue
    ACTIVE_PROJECT="$(run_docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$id" 2>/dev/null || true)"
    [ -n "$ACTIVE_PROJECT" ] && break
  done
fi

case "$ACTIVE_PROJECT" in
  ''|*[!A-Za-z0-9_.-]* )
    printf '%s\n' 'Der aktive Docker-Compose-Projektname konnte nicht sicher ermittelt werden.' >&2
    exit 1
    ;;
esac

printf 'Aktives Compose-Projekt: %s\n' "$ACTIVE_PROJECT"
cp .env ".env.before-compose-project-repair-$STAMP"
cp docker-compose.yml "docker-compose.yml.before-compose-project-repair-$STAMP"

awk -v value="$ACTIVE_PROJECT" '
  BEGIN { done=0 }
  /^COMPOSE_PROJECT_NAME=/ { if (!done) { print "COMPOSE_PROJECT_NAME=" value; done=1 } next }
  { print }
  END { if (!done) print "COMPOSE_PROJECT_NAME=" value }
' .env > .env.compose-project.tmp
mv .env.compose-project.tmp .env
chmod 600 .env 2>/dev/null || true

awk '
  /^[[:space:]]+COMPOSE_PROJECT_NAME:/ {
    print "      COMPOSE_PROJECT_NAME: ${COMPOSE_PROJECT_NAME:-tmp-camera-surveillance-next}"
    next
  }
  { print }
' docker-compose.yml > docker-compose.yml.compose-project.tmp
mv docker-compose.yml.compose-project.tmp docker-compose.yml

# v2.16.4/v2.16.5 could leave a duplicate stack under this fixed name.
# Remove only known services from that exact stale project and never the active project.
if [ "$ACTIVE_PROJECT" != "tmp-camera-surveillance-next" ]; then
  for id in $(run_docker ps -aq --filter label=com.docker.compose.project=tmp-camera-surveillance-next 2>/dev/null || true); do
    service="$(run_docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$id" 2>/dev/null || true)"
    case "$service" in backend|frontend|mediamtx|go2rtc|updater|caddy) run_docker rm -f "$id" >/dev/null;; esac
  done
  run_docker network rm tmp-camera-surveillance-next_camera-net >/dev/null 2>&1 || true
fi

COMPOSE_PROJECT_NAME="$ACTIVE_PROJECT" sh ./scripts/docker-compose.sh build updater
COMPOSE_PROJECT_NAME="$ACTIVE_PROJECT" sh ./scripts/docker-compose.sh up -d --no-deps --force-recreate updater
COMPOSE_PROJECT_NAME="$ACTIVE_PROJECT" sh ./scripts/docker-compose.sh up -d --no-deps backend mediamtx frontend

printf '%s\n' 'Compose-Projektzuordnung wurde repariert. Das Update-Center kann jetzt erneut verwendet werden.'
