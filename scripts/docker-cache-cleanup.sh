#!/usr/bin/env sh
set -u
cd "$(dirname "$0")/.."

MODE="${1:-manual}"
LOG_FILE="${TMP_CAMERA_CLEANUP_LOG:-./data/updates/docker-cleanup.log}"

read_env_value() {
  key="$1"
  [ -f .env ] || return 0
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); gsub(/^[ \t]*"|"[ \t]*$/, ""); gsub(/^[ \t]+|[ \t]+$/, ""); print; exit }' .env 2>/dev/null || true
}

is_false() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in 0|false|no|off) return 0;; *) return 1;; esac
}

log_line() {
  mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
  line="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date) [$MODE] $*"
  printf '%s\n' "$line"
  printf '%s\n' "$line" >> "$LOG_FILE" 2>/dev/null || true
}

docker_host() {
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker "$@"
    return $?
  fi
  if command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
    sudo docker "$@"
    return $?
  fi
  return 127
}

ENABLED="${UPDATER_DOCKER_CACHE_CLEANUP:-$(read_env_value UPDATER_DOCKER_CACHE_CLEANUP)}"
[ -n "$ENABLED" ] || ENABLED=true
if is_false "$ENABLED"; then
  log_line 'Docker cache cleanup is disabled by UPDATER_DOCKER_CACHE_CLEANUP.'
  exit 0
fi

if ! docker_host version >/dev/null 2>&1; then
  log_line 'Docker daemon is not available; cleanup skipped.'
  exit 0
fi

before="$(df -Pk . 2>/dev/null | awk 'NR==2 {printf "%d", $4*1024}' || true)"
log_line "Starting safe Docker cleanup; free bytes before=${before:-unknown}."

# Only dangling images are removed. Images referenced by running/stopped
# containers and tagged base images (node/nginx/go2rtc) remain untouched.
if output="$(docker_host image prune --force 2>&1)"; then
  log_line "Dangling image cleanup completed: $(printf '%s' "$output" | tail -n 1)"
else
  log_line "Dangling image cleanup failed and was ignored: $(printf '%s' "$output" | tail -n 1)"
fi

# Docker's build cache is reproducible and contains no application data.
# --all removes every unused cache entry, which is important on small 15 GB
# installations after repeated in-app builds. This does NOT remove volumes,
# containers or tagged images.
if output="$(docker_host builder prune --all --force 2>&1)"; then
  log_line "Builder cache cleanup completed: $(printf '%s' "$output" | tail -n 1)"
else
  # Older Docker variants may not support --all. Fall back to the compatible
  # unused-cache prune rather than failing an application update/start.
  if output="$(docker_host builder prune --force 2>&1)"; then
    log_line "Builder cache cleanup completed with compatibility mode: $(printf '%s' "$output" | tail -n 1)"
  else
    log_line "Builder cache cleanup failed and was ignored: $(printf '%s' "$output" | tail -n 1)"
  fi
fi

# A separately configured buildx builder can own cache outside the default
# builder. If buildx exists, prune its unused cache as well.
if docker_host buildx version >/dev/null 2>&1; then
  if output="$(docker_host buildx prune --all --force 2>&1)"; then
    log_line "Buildx cache cleanup completed: $(printf '%s' "$output" | tail -n 1)"
  else
    log_line "Buildx cache cleanup failed and was ignored: $(printf '%s' "$output" | tail -n 1)"
  fi
fi

after="$(df -Pk . 2>/dev/null | awk 'NR==2 {printf "%d", $4*1024}' || true)"
if [ -n "$before" ] && [ -n "$after" ]; then
  freed=$((after - before))
  [ "$freed" -ge 0 ] 2>/dev/null || freed=0
  log_line "Docker cleanup finished; free bytes after=$after, newly available=$freed."
else
  log_line 'Docker cleanup finished.'
fi

exit 0
