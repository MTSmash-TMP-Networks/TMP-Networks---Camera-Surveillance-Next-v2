#!/bin/sh
set -eu

DATA_ROOT="${APP_DATA_DIR:-/data}"
PUID_VALUE="${PUID:-1000}"
PGID_VALUE="${PGID:-1000}"

is_numeric_id() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

is_numeric_id "$PUID_VALUE" || PUID_VALUE=1000
is_numeric_id "$PGID_VALUE" || PGID_VALUE=1000

LIVE_DIR="$DATA_ROOT/live"
RECORDINGS_DIR_VALUE="${RECORDINGS_DIR:-$DATA_ROOT/recordings}"
UPDATES_DIR_VALUE="${UPDATES_DIR:-$DATA_ROOT/updates}"
BACKUPS_DIR_VALUE="$DATA_ROOT/backups"
SNAPSHOTS_DIR_VALUE="$DATA_ROOT/snapshots"
NETWORK_STORAGE_DIR_VALUE="$DATA_ROOT/network-storage"
NETWORK_CACHE_DIR_VALUE="$DATA_ROOT/network-recording-cache"

prepare_directories() {
  mkdir -p \
    "$DATA_ROOT" \
    "$LIVE_DIR" \
    "$RECORDINGS_DIR_VALUE" \
    "$UPDATES_DIR_VALUE" \
    "$BACKUPS_DIR_VALUE" \
    "$SNAPSHOTS_DIR_VALUE" \
    "$NETWORK_STORAGE_DIR_VALUE" \
    "$NETWORK_CACHE_DIR_VALUE"
}

verify_runtime_write_access() {
  target="$1"
  label="$2"
  if gosu "$PUID_VALUE:$PGID_VALUE" sh -c 'test -d "$1" && test -w "$1"' sh "$target"; then
    return 0
  fi
  printf '%s\n' "FATAL: $label ist fuer Backend-UID $PUID_VALUE:$PGID_VALUE nicht beschreibbar: $target" >&2
  printf '%s\n' "Bitte Host-Dateirechte und PUID/PGID pruefen." >&2
  return 1
}

if [ "$(id -u)" = "0" ]; then
  prepare_directories

  # Live-HLS is transient runtime media. Docker may have auto-created the bind
  # source as root before the backend starts, so ownership must be repaired in
  # the container immediately before dropping privileges.
  chown "$PUID_VALUE:$PGID_VALUE" "$DATA_ROOT" 2>/dev/null || true
  chown -R "$PUID_VALUE:$PGID_VALUE" \
    "$LIVE_DIR" \
    "$UPDATES_DIR_VALUE" \
    "$BACKUPS_DIR_VALUE" \
    "$SNAPSHOTS_DIR_VALUE" \
    "$NETWORK_STORAGE_DIR_VALUE" \
    "$NETWORK_CACHE_DIR_VALUE" 2>/dev/null || true

  # The active FFmpeg spool stays local even when SMB/SFTP archive storage is
  # enabled. Only repair the spool directory itself here; finalized blocks are
  # transferred by the backend network-storage worker.
  if ! gosu "$PUID_VALUE:$PGID_VALUE" sh -c 'test -w "$1"' sh "$RECORDINGS_DIR_VALUE"; then
    chown "$PUID_VALUE:$PGID_VALUE" "$RECORDINGS_DIR_VALUE" 2>/dev/null || true
  fi

  find "$DATA_ROOT" -maxdepth 1 -type f \
    \( -name 'kamera_server.db' -o -name 'kamera_server.db-wal' -o -name 'kamera_server.db-shm' \) \
    -exec chown "$PUID_VALUE:$PGID_VALUE" {} + 2>/dev/null || true
  find "$DATA_ROOT" -maxdepth 1 -type f \
    \( -name 'kamera_server.db' -o -name 'kamera_server.db-wal' -o -name 'kamera_server.db-shm' \) \
    -exec chmod ug+rw {} + 2>/dev/null || true

  chmod 0750 "$DATA_ROOT" "$RECORDINGS_DIR_VALUE" 2>/dev/null || true
  chmod 0775 "$LIVE_DIR" "$SNAPSHOTS_DIR_VALUE" "$NETWORK_STORAGE_DIR_VALUE" "$NETWORK_CACHE_DIR_VALUE" 2>/dev/null || true
  chmod 0770 "$UPDATES_DIR_VALUE" "$BACKUPS_DIR_VALUE" 2>/dev/null || true

  # Some NAS/CIFS bind mounts ignore chown but permit mode changes. The live
  # ring contains only transient segments, so use a narrow last-resort mode
  # fallback instead of letting every camera attempt fail with EACCES.
  if ! gosu "$PUID_VALUE:$PGID_VALUE" sh -c 'test -w "$1"' sh "$LIVE_DIR"; then
    chmod 0777 "$LIVE_DIR" 2>/dev/null || true
  fi

  verify_runtime_write_access "$LIVE_DIR" "LOCAL_HLS_DIR"
  verify_runtime_write_access "$RECORDINGS_DIR_VALUE" "RECORDINGS_DIR"
  exec gosu "$PUID_VALUE:$PGID_VALUE" "$@"
fi

prepare_directories
if [ ! -w "$LIVE_DIR" ]; then
  printf '%s\n' "FATAL: LOCAL_HLS_DIR ist nicht beschreibbar: $LIVE_DIR" >&2
  exit 73
fi
exec "$@"
