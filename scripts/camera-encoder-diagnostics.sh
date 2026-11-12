#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
if ! command -v docker >/dev/null 2>&1; then echo 'Docker fehlt.' >&2; exit 1; fi
compose() { sh ./scripts/docker-compose.sh "$@"; }
backend=$(compose ps -q backend)
media=$(compose ps -q mediamtx)
[ -n "$backend" ] || { echo 'Backend-Container fehlt.' >&2; exit 1; }
[ -n "$media" ] || { echo 'go2rtc-Container fehlt.' >&2; exit 1; }
printf '%s\n' '=== Konfiguration aus .env (ausschliesslich unkritische Schluessel) ==='
for key in ENABLE_INTEL_GPU_COMPOSE GO2RTC_FFMPEG_HARDWARE GO2RTC_H264_COPY_FIRST; do
  val=$(awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' .env 2>/dev/null || true)
  printf '%s=%s\n' "$key" "${val:-nicht_gesetzt}"
done
printf '%s\n' '=== Laufendes Backend (Docker Inspect) ==='
docker inspect "$backend" --format '{{range .Config.Env}}{{println .}}{{end}}' |
  grep -E '^(APP_VERSION|ENABLE_INTEL_GPU_COMPOSE|GO2RTC_FFMPEG_HARDWARE|GO2RTC_H264_COPY_FIRST)=' || true
printf '%s\n' '=== GPU im go2rtc-Container ==='
if docker exec "$media" sh -c 'test -c /dev/dri/renderD128'; then echo 'renderD128 erreichbar'; else echo 'renderD128 nicht erreichbar'; fi
printf '%s\n' '=== FFmpeg-Verarbeitung im go2rtc-Container ==='
docker top "$media" -eo pid,comm,pcpu |
  awk '$2 == "ffmpeg" {print $1, $3}' |
  while read -r pid cpu; do
    [ -r "/proc/$pid/cmdline" ] || continue
    encoder=$(tr '\000' '\n' < "/proc/$pid/cmdline" | grep -Em1 '^(libx264|h264_vaapi|hevc_vaapi|copy)$' || true)
    printf 'PID %s CPU %s Encoder %s\n' "$pid" "$cpu" "${encoder:-unbekannt}"
  done
