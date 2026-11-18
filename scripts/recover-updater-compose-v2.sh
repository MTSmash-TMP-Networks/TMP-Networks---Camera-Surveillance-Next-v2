#!/bin/sh
# Recover the existing updater from Docker Compose V1 without stopping camera services.
# Usage: sudo sh recover-updater-compose-v2.sh /path/to/running/project
set -eu
umask 077

if [ "$(id -u)" != "0" ]; then
  echo "ERROR: run as root using sudo." >&2
  exit 1
fi
if [ "$#" -ne 1 ]; then
  echo "Usage: sudo sh $0 /path/to/TMP-Camera-project" >&2
  exit 1
fi

ROOT=$(cd "$1" && pwd -P) || exit 1
cd "$ROOT"
if [ ! -f VERSION ] || [ ! -f updater/Dockerfile ] || [ ! -f docker-compose.yml ] || [ ! -f .env ]; then
  echo "ERROR: this is not a complete installed camera project." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: Docker and the host's Docker Compose V2/V5 must be available." >&2
  exit 1
fi

# Avoid selecting a container from a second camera installation.
UPDATER=$(docker ps -q --filter "label=com.docker.compose.service=updater")
if [ "$(printf '%s\n' "$UPDATER" | sed '/^$/d' | wc -l | tr -d ' ')" -ne 1 ]; then
  echo "ERROR: expected exactly one running updater container. No change made." >&2
  exit 1
fi
PROJECT=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$UPDATER")
MOUNT=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/workspace"}}{{.Source}}{{end}}{{end}}' "$UPDATER")
if [ "$MOUNT" != "$ROOT" ] || [ -z "$PROJECT" ] || [ "$PROJECT" = "<no value>" ]; then
  echo "ERROR: updater project mount/project label does not match the selected directory." >&2
  exit 1
fi

if docker exec "$UPDATER" docker compose version >/dev/null 2>&1; then
  echo "Updater already provides Docker Compose V2/V5. No recovery needed."
  exit 0
fi

PREVIOUS_IMAGE=$(docker inspect --format '{{.Image}}' "$UPDATER")
CANDIDATE=tmp-camera-surveillance-next-updater:compose-v2-recovery
BACKUP_IMAGE=tmp-camera-surveillance-next-updater:before-compose-v2-recovery
CURRENT_IMAGE=tmp-camera-surveillance-next-updater:latest
TEMP_DOCKERFILE=$(mktemp /tmp/tmp-camera-updater-Dockerfile.XXXXXX)
SWAPPED=0

cleanup() {
  result=$?
  trap - EXIT
  if [ "$result" -ne 0 ] && [ "$SWAPPED" -eq 1 ]; then
    echo "Recovery failed: restoring previous updater image; camera containers untouched." >&2
    docker tag "$PREVIOUS_IMAGE" "$CURRENT_IMAGE" || true
    docker compose -p "$PROJECT" -f docker-compose.yml up -d --no-deps --no-build --force-recreate updater || true
  fi
  rm -f "$TEMP_DOCKERFILE"
  exit "$result"
}
trap cleanup EXIT

# Build separately: a failed Docker build does not replace any running service.
cat updater/Dockerfile > "$TEMP_DOCKERFILE"
cat >> "$TEMP_DOCKERFILE" <<'DOCKERFILE'

# Temporary Compose-V2 bridge for the old, currently running updater.
COPY --from=docker/compose-bin:v2.40.3 /docker-compose /usr/local/lib/docker/cli-plugins/docker-compose
RUN docker compose version
DOCKERFILE

echo "Building temporary updater with the official Docker Compose V2 plugin..."
docker build -t "$CANDIDATE" -f "$TEMP_DOCKERFILE" updater
docker run --rm --entrypoint docker "$CANDIDATE" compose version

echo "Saving previous updater image and activating the replacement..."
docker tag "$PREVIOUS_IMAGE" "$BACKUP_IMAGE"
docker tag "$CANDIDATE" "$CURRENT_IMAGE"
SWAPPED=1
docker compose -p "$PROJECT" -f docker-compose.yml up -d --no-deps --no-build --force-recreate updater

NEXT=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=updater" | head -n 1)
if [ -z "$NEXT" ]; then
  echo "ERROR: new updater is not running." >&2
  exit 1
fi

docker exec "$NEXT" docker compose version
READY=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if docker exec "$NEXT" node src/healthcheck.js >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done
if [ "$READY" -ne 1 ]; then
  echo "ERROR: updater healthcheck failed." >&2
  exit 1
fi

SWAPPED=0
echo "SUCCESS: only the updater was replaced with a Compose-V2-capable image."
echo "Backend, go2rtc and frontend were not restarted."
echo "Now install the verified v2.20.65 package through the normal Update Center."
