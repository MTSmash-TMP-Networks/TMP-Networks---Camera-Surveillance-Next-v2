#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."

fail() { printf '[Intel VAAPI] FEHLER: %s\n' "$*" >&2; exit 1; }
log() { printf '[Intel VAAPI] %s\n' "$*"; }
mode="${1:---check}"
case "$mode" in --check|--enable|--disable) ;; *) fail 'Verwendung: sh scripts/intel-vaapi.sh [--check|--enable|--disable]' ;; esac
[ -f .env ] || fail 'Projektdatei .env fehlt.'

host_docker() {
  if docker info >/dev/null 2>&1; then docker "$@"; return; fi
  if command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then sudo docker "$@"; return; fi
  return 1
}

env_setting() {
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); gsub(/^"|"$/, ""); print; exit }' .env
}

set_env() {
  key="$1"
  val="$2"
  tmp=$(mktemp ./.env.intel.XXXXXXXX) || fail 'Temporäre .env-Datei konnte nicht erstellt werden.'
  chmod --reference=.env "$tmp" 2>/dev/null || chmod 600 "$tmp"
  chown --reference=.env "$tmp" 2>/dev/null || true
  awk -v key="$key" -v val="$val" 'BEGIN{done=0} $0 ~ "^" key "=" { if (!done) {print key "=" val; done=1}; next} {print} END {if(!done) print key "=" val}' .env > "$tmp"
  mv -f "$tmp" .env
}

renderer="${INTEL_RENDER_DEVICE:-/dev/dri/renderD128}"
case "$renderer" in /dev/dri/renderD[0-9]*) ;; *) fail 'Nur /dev/dri/renderD*-Geräte sind zulässig.' ;; esac
if [ "$mode" = --disable ]; then
  set_env ENABLE_INTEL_GPU_COMPOSE false
  set_env GO2RTC_FFMPEG_HARDWARE none
  log 'Intel-VAAPI deaktiviert; bisheriger Softwarepfad ist wieder aktiviert.'
  log 'Zur Übernahme: sudo sh ./scripts/docker-compose.sh up -d --no-deps --force-recreate updater mediamtx backend'
  exit 0
fi

[ -c "$renderer" ] || fail "$renderer fehlt. Prüfe /dev/dri und den Intel-i915-Treiber auf dem Host."
render_group=$(stat -c %g "$renderer" 2>/dev/null) || fail 'Rendergruppen-ID konnte nicht bestimmt werden.'
case "$render_group" in ''|*[!0-9]*) fail 'Ungültige Rendergruppen-ID.' ;; esac
intel_found=false
for v in /sys/class/drm/card*/device/vendor; do
  [ -r "$v" ] || continue
  if grep -qi '^0x8086$' "$v"; then intel_found=true; break; fi
done
[ "$intel_found" = true ] || fail 'Kein Intel-DRM-Gerät (0x8086) gefunden. Keine automatische GPU-Aktivierung.'
log "Intel-GPU erkannt: $renderer (Gruppe $render_group)"
log 'Prüfe H.264-VAAPI-Encoding im vorhandenen go2rtc-Containerimage ...'
# Use the pinned image already deployed on the server. No privileged container.
image='alexxit/go2rtc:1.9.14'
if ! host_docker image inspect "$image" >/dev/null 2>&1; then
  fail "Das go2rtc-Image $image ist lokal nicht verfügbar. Bitte Docker-Image prüfen."
fi
probe_log=$(mktemp) || fail 'Pruefprotokoll konnte nicht erstellt werden.'
trap 'rm -f "$probe_log"' EXIT HUP INT TERM
if ! host_docker run --rm --network none --device "$renderer":/dev/dri/renderD128 --group-add "$render_group" \
  --entrypoint ffmpeg "$image" -hide_banner -nostdin -loglevel error \
  -vaapi_device /dev/dri/renderD128 -f lavfi -i color=c=black:s=320x240:r=5 \
  -vf 'format=nv12,hwupload' -frames:v 3 -c:v h264_vaapi -f null - >"$probe_log" 2>&1; then
  tail -n 12 "$probe_log" >&2 || true
  fail 'VAAPI-Hardwaretest fehlgeschlagen. Es wird nichts aktiviert. Prüfe Intel-Media-Treiber, VAAPI und go2rtc-Image.'
fi
rm -f "$probe_log"
trap - EXIT HUP INT TERM
log 'H.264-VAAPI-Hardwaretest erfolgreich.'
if [ "$mode" = --check ]; then
  log 'Prüfung erfolgreich. Aktivierung: sudo sh ./scripts/intel-vaapi.sh --enable'
  exit 0
fi
set_env INTEL_RENDER_DEVICE "$renderer"
set_env INTEL_RENDER_GID "$render_group"
set_env ENABLE_INTEL_GPU_COMPOSE true
set_env GO2RTC_FFMPEG_HARDWARE vaapi
log 'Intel-VAAPI konfiguriert. Einmaliger Neustart der Medien- und Backenddienste erforderlich.'
log 'Ausführen: sudo sh ./scripts/docker-compose.sh build updater'
log 'Danach: sudo sh ./scripts/docker-compose.sh up -d --no-deps --force-recreate updater mediamtx backend'
log 'Bei Problemen: sudo sh ./scripts/intel-vaapi.sh --disable'
