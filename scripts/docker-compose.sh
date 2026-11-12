#!/usr/bin/env sh
set -eu

# Compose v2 (docker compose) and legacy Compose v1 (docker-compose) support.
# Synology DSM 6.x commonly ships Docker 20.x with docker-compose only.
USE_HTTPS=false
OUT_ARGS=""
SEEN_UP_COMMAND=false
SEEN_FORCE_RECREATE=false
SEEN_UPDATER_SERVICE=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    up) SEEN_UP_COMMAND=true;;
    --force-recreate) SEEN_FORCE_RECREATE=true;;
    updater) SEEN_UPDATER_SERVICE=true;;
  esac
  if [ "$1" = "--profile" ] && [ "${2:-}" = "https" ]; then
    USE_HTTPS=true
    shift 2
    continue
  fi
  # Preserve argument boundaries through positional parameters below.
  OUT_ARGS="$OUT_ARGS
$1"
  shift
done
set --
OLD_IFS=$IFS
IFS='
'
for arg in $OUT_ARGS; do
  [ -n "$arg" ] && set -- "$@" "$arg"
done
IFS=$OLD_IFS

if [ -f .env ] && grep -Eqi '^ENABLE_NVIDIA_GPU_COMPOSE=(1|true|yes|on)[[:space:]]*$' .env && [ -f docker-compose.gpu.yml ]; then
  set -- -f docker-compose.yml -f docker-compose.gpu.yml "$@"
fi
if [ -f .env ] && grep -Eqi '^ENABLE_INTEL_GPU_COMPOSE=(1|true|yes|on)[[:space:]]*$' .env && [ -f scripts/docker-compose.intel.yml ]; then
  set -- -f docker-compose.yml -f scripts/docker-compose.intel.yml "$@"
fi
if [ "$USE_HTTPS" = true ] && [ -f docker-compose.https.yml ]; then
  set -- -f docker-compose.yml -f docker-compose.https.yml "$@"
fi

# Pin the Compose project explicitly when known. Relying only on implicit
# directory-derived names can split backend and updater into different Docker
# networks during updater self-replacement or after ZIP extraction into a new
# folder name. The .env file is read explicitly here because Docker Compose
# consumes it for interpolation, but shell wrapper variables are not imported
# automatically.
if [ -z "${COMPOSE_PROJECT_NAME:-}" ] && [ -f .env ]; then
  COMPOSE_PROJECT_NAME_FROM_ENV="$(awk -F= '$1 == "COMPOSE_PROJECT_NAME" { sub(/^[^=]*=/, ""); gsub(/^[ 	]*"|"[ 	]*$/, ""); gsub(/^[ 	]+|[ 	]+$/, ""); print; exit }' .env 2>/dev/null || true)"
  case "$COMPOSE_PROJECT_NAME_FROM_ENV" in
    "") :;;
    *[!A-Za-z0-9_-]*|[-_]* ) printf '%s\n' "Ignoriere ungueltigen COMPOSE_PROJECT_NAME aus .env" >&2;;
    *) COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME_FROM_ENV"; export COMPOSE_PROJECT_NAME;;
  esac
fi
if [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
  set -- -p "$COMPOSE_PROJECT_NAME" "$@"
fi

UPDATER_SELF_REPLACE=false
# The in-app updater launches its detached replacement helper with an isolated
# Docker CLI workspace. Limit the stabilization hook to that exact context so
# normal start.sh/repair commands remain fast and unchanged.
if [ "$SEEN_UP_COMMAND" = true ] \
  && [ "$SEEN_FORCE_RECREATE" = true ] \
  && [ "$SEEN_UPDATER_SERVICE" = true ] \
  && [ "${HOME:-}" = "/tmp/home" ] \
  && [ "${DOCKER_CONFIG:-}" = "/tmp/docker-config" ] \
  && [ -n "${PROJECT_HOST_PATH:-}" ]; then
  UPDATER_SELF_REPLACE=true
fi

finalizer_log() {
  mkdir -p ./data/updates 2>/dev/null || true
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date)" "$*" >> ./data/updates/updater-finalizer.log 2>/dev/null || true
}

# An in-app update from an older release may still launch the historical
# detached "self replacement" helper after the package files have already been
# installed. Do not let that helper replace the currently healthy updater.
# Keeping the control agent alive avoids losing both the shared IPC socket and
# the Compose-network DNS aliases at the very end of an otherwise successful
# update. The new updater image is activated later by start.sh or
# repair-updater.sh from the Docker host.
if [ "$UPDATER_SELF_REPLACE" = true ]; then
  finalizer_log "Updater self-replacement intentionally deferred; active updater remains online until the next host-side start/repair"
  exit 0
fi

run_compose() {
  if docker compose version >/dev/null 2>&1; then
    exec docker compose "$@"
  fi
  if command -v docker-compose >/dev/null 2>&1 && docker-compose version >/dev/null 2>&1; then
    # Compose v1 on DSM 6.x is most reliable with the classic builder.
    export DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-0}"
    export COMPOSE_DOCKER_CLI_BUILD="${COMPOSE_DOCKER_CLI_BUILD:-0}"
    # v1 uses --filter status=running instead of --status running.
    if [ "${1:-}" = "ps" ]; then
      NEW_ARGS=""
      while [ "$#" -gt 0 ]; do
        if [ "$1" = "--status" ] && [ "$#" -ge 2 ]; then
          NEW_ARGS="$NEW_ARGS
--filter
status=$2"
          shift 2
        else
          NEW_ARGS="$NEW_ARGS
$1"
          shift
        fi
      done
      set --
      OLD_IFS=$IFS; IFS='
'
      for arg in $NEW_ARGS; do [ -n "$arg" ] && set -- "$@" "$arg"; done
      IFS=$OLD_IFS
    fi
    exec docker-compose "$@"
  fi
  if command -v sudo >/dev/null 2>&1; then
    if sudo docker compose version >/dev/null 2>&1; then
      exec sudo docker compose "$@"
    fi
    if command -v docker-compose >/dev/null 2>&1 && sudo docker-compose version >/dev/null 2>&1; then
      export DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-0}"
      export COMPOSE_DOCKER_CLI_BUILD="${COMPOSE_DOCKER_CLI_BUILD:-0}"
      if [ "${1:-}" = "ps" ]; then
        NEW_ARGS=""
        while [ "$#" -gt 0 ]; do
          if [ "$1" = "--status" ] && [ "$#" -ge 2 ]; then NEW_ARGS="$NEW_ARGS
--filter
status=$2"; shift 2; else NEW_ARGS="$NEW_ARGS
$1"; shift; fi
        done
        set --; OLD_IFS=$IFS; IFS='
'; for arg in $NEW_ARGS; do [ -n "$arg" ] && set -- "$@" "$arg"; done; IFS=$OLD_IFS
      fi
      exec sudo docker-compose "$@"
    fi
  fi
  printf '%s\n' 'Docker Compose wurde nicht gefunden. Installiere das Compose-Plugin oder docker-compose.' >&2
  return 1
}

run_compose "$@"
