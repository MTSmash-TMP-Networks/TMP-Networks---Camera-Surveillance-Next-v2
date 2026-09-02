#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."

compose_cmd() {
  if [ -x ./scripts/docker-compose.sh ]; then
    sh ./scripts/docker-compose.sh "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    docker compose "$@"
  fi
}

host_ip_from_system() {
  if [ "${1:-}" ]; then printf '%s' "$1"; return 0; fi
  if command -v ip >/dev/null 2>&1; then
    ip -o -4 addr show scope global 2>/dev/null | awk '
      $2 !~ /^(docker|br-|veth|virbr|cni|podman)/ && $4 ~ /\// {
        split($4,a,"/"); ip=a[1];
        if (ip !~ /^127\./ && ip !~ /^172\.(1[6-9]|2[0-9]|3[01])\./) { print ip; exit }
      }'
  elif command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | awk '{ for (i=1;i<=NF;i++) if ($i !~ /^127\./ && $i !~ /^172\.(1[6-9]|2[0-9]|3[01])\./) { print $i; exit } }'
  fi
}

upsert_env_key() {
  key="$1"
  value="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    awk -v key="$key" -v value="$value" 'BEGIN{done=0} $0 ~ "^" key "=" { if (!done) { print key "=" value; done=1 } next } { print } END{ if (!done) print key "=" value }' .env > .env.webrtc-host.tmp
    mv .env.webrtc-host.tmp .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

HOST_IP="$(host_ip_from_system "${1:-}" | head -n 1 | tr -d '\r\n')"
case "$HOST_IP" in
  ""|host.docker.internal|localhost|127.*|0.0.0.0)
    echo "Keine brauchbare Host-IP erkannt. Bitte explizit ausführen: sudo sh scripts/repair-webrtc-host.sh 192.168.1.201" >&2
    exit 1
    ;;
esac

[ -f .env ] || { echo ".env wurde nicht gefunden. Bitte im Projektordner ausführen." >&2; exit 1; }
cp .env ".env.webrtc-host-backup-$(date +%Y%m%d-%H%M%S)"
ICE_PORT="${WEBRTC_ICE_PORT:-8189}"
upsert_env_key GO2RTC_WEBRTC_CANDIDATE "$HOST_IP:$ICE_PORT"
upsert_env_key GO2RTC_WEBRTC_CANDIDATE_MODE manual
upsert_env_key STREAM_WEBRTC_ENABLED true

echo "GO2RTC_WEBRTC_CANDIDATE wurde manuell auf $HOST_IP:$ICE_PORT gesetzt."
echo "go2rtc wird neu erstellt, damit die ICE-Candidates aktualisiert werden."
compose_cmd up -d --no-deps --force-recreate mediamtx

echo "Fertig. Live/Kiosk kann neu geladen werden."
