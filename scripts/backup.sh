#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p data/backups
STAMP="$(date +%Y%m%d_%H%M%S)"
TARGET="data/backups/tmp-camera-${STAMP}.tar.gz"
INCLUDES=""
[ -f data/kamera_server.db ] && INCLUDES="$INCLUDES kamera_server.db"
[ -f data/kamera_server.db-wal ] && INCLUDES="$INCLUDES kamera_server.db-wal"
[ -f data/kamera_server.db-shm ] && INCLUDES="$INCLUDES kamera_server.db-shm"
[ -d data/recordings ] && INCLUDES="$INCLUDES recordings"
if [ -z "$INCLUDES" ]; then printf '%s\n' 'Noch keine Daten zum Sichern vorhanden.'; exit 0; fi

BACKEND_WAS_RUNNING=0
if sh ./scripts/docker-compose.sh ps --services --status running 2>/dev/null | grep -qx backend; then
  BACKEND_WAS_RUNNING=1
  printf '%s\n' 'Backend wird fuer eine konsistente SQLite-Sicherung kurz gestoppt.'
  sh ./scripts/docker-compose.sh stop backend >/dev/null
fi
restore_backend() {
  if [ "$BACKEND_WAS_RUNNING" -eq 1 ]; then sh ./scripts/docker-compose.sh start backend >/dev/null 2>&1 || true; fi
}
trap restore_backend EXIT HUP INT TERM

# shellcheck disable=SC2086
tar -C data -czf "$TARGET" $INCLUDES
restore_backend
BACKEND_WAS_RUNNING=0
trap - EXIT HUP INT TERM
printf 'Sicherung erstellt: %s\n' "$TARGET"
