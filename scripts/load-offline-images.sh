#!/usr/bin/env sh
set -eu
if [ "$#" -ne 1 ]; then
  printf 'Aufruf: %s /pfad/tmp-camera-base-images-ARCH.tar\n' "$0" >&2
  exit 2
fi
ARCHIVE="$1"
[ -f "$ARCHIVE" ] || { printf 'Datei nicht gefunden: %s\n' "$ARCHIVE" >&2; exit 1; }
if docker info >/dev/null 2>&1; then
  exec docker load -i "$ARCHIVE"
fi
if command -v sudo >/dev/null 2>&1; then
  exec sudo docker load -i "$ARCHIVE"
fi
printf 'Kein Zugriff auf den Docker-Daemon.\n' >&2
exit 1
