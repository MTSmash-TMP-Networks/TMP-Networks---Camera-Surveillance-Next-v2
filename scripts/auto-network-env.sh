#!/usr/bin/env sh
# Autonomer Netzwerk-Preflight fuer Live/Kiosk.
# Wird beim Erststart, bei jedem weiteren Start und durch den Updater vor Dienstneustarts ausgefuehrt.
# Ziel: WebRTC-ICE darf niemals mit host.docker.internal, localhost oder Docker-Bridge-IP starten.
set -eu

PROJECT_ROOT="${1:-.}"
ENV_FILE="$PROJECT_ROOT/.env"

strip_quotes() { printf '%s' "$1" | sed 's/^"//; s/"$//; s/^'"'"'//; s/'"'"'$//'; }

env_value() {
  key="$1"
  [ -f "$ENV_FILE" ] || return 0
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); gsub(/^"|"$/, ""); print; exit }' "$ENV_FILE" 2>/dev/null || true
}

upsert_env_key() {
  key="$1"
  value="$2"
  if [ -f "$ENV_FILE" ] && grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    awk -v key="$key" -v value="$value" 'BEGIN{done=0} $0 ~ "^" key "=" { if (!done) { print key "=" value; done=1 } next } { print } END{ if (!done) print key "=" value }' "$ENV_FILE" > "$ENV_FILE.auto-network.tmp"
    mv "$ENV_FILE.auto-network.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

is_excluded_ifname() {
  case "$1" in
    lo|docker*|br-*|veth*|virbr*|cni*|podman*) return 0 ;;
    *) return 1 ;;
  esac
}

is_valid_browser_host() {
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[[:space:]]//g')"
  case "$value" in
    ""|host.docker.internal|localhost|localhost.*|127.*|0.0.0.0|::|::1|169.254.*) return 1 ;;
    *:*) return 0 ;; # IPv6/Hostname: nicht auf Docker-Bridge pruefen.
    *) return 0 ;;
  esac
}

append_unique_host() {
  host="$(printf '%s' "$1" | tr -d '\r\n' | sed 's/[[:space:]]//g')"
  is_valid_browser_host "$host" || return 0
  case ",$AUTO_HOSTS," in *",$host,"*) return 0 ;; esac
  AUTO_HOSTS="${AUTO_HOSTS}${AUTO_HOSTS:+,}${host}"
}

candidate_from_route_get() {
  target="$1"
  if command -v ip >/dev/null 2>&1; then
    ip -o -4 route get "$target" 2>/dev/null | awk '
      {
        ip=""; dev="";
        for (i=1;i<=NF;i++) {
          if ($i == "src" && (i+1)<=NF) ip=$(i+1);
          if ($i == "dev" && (i+1)<=NF) dev=$(i+1);
        }
        if (ip != "" && dev != "") print dev " " ip;
      }' | head -n 1
    return 0
  fi
  # macOS/BSD fallback.
  if command -v route >/dev/null 2>&1 && command -v ipconfig >/dev/null 2>&1; then
    dev="$(route -n get "$target" 2>/dev/null | awk '/interface:/{print $2; exit}')"
    [ -n "$dev" ] || return 0
    addr="$(ipconfig getifaddr "$dev" 2>/dev/null || true)"
    [ -n "$addr" ] && printf '%s %s\n' "$dev" "$addr"
  fi
}

AUTO_HOSTS=""

# 1) Default-Route ist meistens die IP, unter der Browser im LAN das NAS erreichen.
for target in 1.1.1.1 8.8.8.8; do
  route_line="$(candidate_from_route_get "$target" || true)"
  [ -n "$route_line" ] || continue
  route_dev="$(printf '%s' "$route_line" | awk '{print $1}')"
  route_ip="$(printf '%s' "$route_line" | awk '{print $2}')"
  if ! is_excluded_ifname "$route_dev"; then append_unique_host "$route_ip"; fi
  [ -n "$AUTO_HOSTS" ] && break
done

# 2) Alle echten globalen Host-Interfaces aufnehmen. 172.16/12 ist als echtes Kundennetz erlaubt;
#    ausgeschlossen wird deshalb ueber Interface-Namen, nicht pauschal ueber IP-Ranges.
if command -v ip >/dev/null 2>&1; then
  ip -o -4 addr show scope global 2>/dev/null | awk '{ split($2,d,"@"); split($4,a,"/"); print d[1] " " a[1] }' | while read -r dev ipaddr; do
    if [ -n "$dev" ] && [ -n "$ipaddr" ] && ! is_excluded_ifname "$dev"; then
      printf '%s\n' "$ipaddr"
    fi
  done > "/tmp/tmp-camera-auto-hosts.$$" || true
  while IFS= read -r ipaddr; do append_unique_host "$ipaddr"; done < "/tmp/tmp-camera-auto-hosts.$$" 2>/dev/null || true
  rm -f "/tmp/tmp-camera-auto-hosts.$$"
elif command -v ipconfig >/dev/null 2>&1; then
  # macOS: Docker Desktop hosts normally use en0/en1; include any active physical-style interface.
  for dev in en0 en1 en2 en3; do
    ipaddr="$(ipconfig getifaddr "$dev" 2>/dev/null || true)"
    [ -n "$ipaddr" ] && append_unique_host "$ipaddr"
  done
elif command -v hostname >/dev/null 2>&1; then
  for ipaddr in $(hostname -I 2>/dev/null || true); do
    case "$ipaddr" in 127.*|169.254.*|172.17.*|172.18.*|172.19.*) continue ;; esac
    append_unique_host "$ipaddr"
  done
fi

# 3) Bestehende manuell gueltige Hosts bleiben erhalten, falls der Modus manual ist.
MODE="$(env_value WEBRTC_ADDITIONAL_HOSTS_MODE | tr '[:upper:]' '[:lower:]')"
[ -n "$MODE" ] || MODE=auto
CURRENT_HOSTS="$(env_value WEBRTC_ADDITIONAL_HOSTS)"
GO2RTC_MODE="$(env_value GO2RTC_WEBRTC_CANDIDATE_MODE | tr '[:upper:]' '[:lower:]')"
[ -n "$GO2RTC_MODE" ] || GO2RTC_MODE=auto
ICE_PORT="$(env_value WEBRTC_ICE_PORT)"
[ -n "$ICE_PORT" ] || ICE_PORT=8189

first_auto_host() {
  printf '%s' "$AUTO_HOSTS" | awk -F, '{print $1}'
}

sync_go2rtc_candidate() {
  if [ "$GO2RTC_MODE" = "manual" ]; then
    return 0
  fi
  upsert_env_key GO2RTC_WEBRTC_CANDIDATE_MODE auto
  host="$(first_auto_host)"
  if [ -n "$host" ]; then
    # WebRTC-Medien laufen nicht durch den HTTP-Proxy. Der Browser braucht die
    # echte Host-/NAS-Adresse und den extern gemappten ICE-Port.
    upsert_env_key GO2RTC_WEBRTC_CANDIDATE "$host:$ICE_PORT"
  else
    upsert_env_key GO2RTC_WEBRTC_CANDIDATE "stun:$ICE_PORT"
  fi
}

if [ "$MODE" = "manual" ]; then
  VALID_MANUAL=""
  OLD_AUTO_HOSTS="$AUTO_HOSTS"
  AUTO_HOSTS=""
  OLD_IFS=$IFS; IFS=',; '
  for item in $CURRENT_HOSTS; do append_unique_host "$item"; done
  IFS=$OLD_IFS
  VALID_MANUAL="$AUTO_HOSTS"
  AUTO_HOSTS="$OLD_AUTO_HOSTS"
  if [ -n "$VALID_MANUAL" ]; then
    upsert_env_key STREAM_WEBRTC_ENABLED true
    upsert_env_key WEBRTC_ADDITIONAL_HOSTS "$VALID_MANUAL"
    AUTO_HOSTS="$VALID_MANUAL"
    sync_go2rtc_candidate
    printf '%s\n' "WebRTC-Hostmodus manual: $VALID_MANUAL"
    exit 0
  fi
  printf '%s\n' 'WEBRTC_ADDITIONAL_HOSTS_MODE=manual ist gesetzt, aber kein brauchbarer Host wurde gefunden. Es wird auf auto gewechselt.' >&2
  upsert_env_key WEBRTC_ADDITIONAL_HOSTS_MODE auto
  MODE=auto
fi

# Auto-Modus: alte fehlerhafte Werte wie host.docker.internal werden jedes Mal ersetzt.
upsert_env_key WEBRTC_ADDITIONAL_HOSTS_MODE auto
if [ -n "$AUTO_HOSTS" ]; then
  upsert_env_key WEBRTC_ADDITIONAL_HOSTS "$AUTO_HOSTS"
  # HLS is the default browser path. Keep the ICE candidate prepared, but do not
  # expose WHEP automatically. Admins can run scripts/repair-webrtc-host.sh or set
  # STREAM_WEBRTC_ENABLED=true when they intentionally want WebRTC again.
  upsert_env_key STREAM_WEBRTC_ENABLED false
  upsert_env_key STREAM_BROWSER_HLS_MODE local-ring
  upsert_env_key STREAM_BROWSER_TRANSPORT_ORDER local-hls
  upsert_env_key VITE_STREAM_PLAYBACK_ORDER local-hls
  upsert_env_key LOCAL_HLS_DIR /data/live
  upsert_env_key PUBLIC_LOCAL_HLS_BASE /live-hls
  sync_go2rtc_candidate
  printf '%s\n' "Automatisch erkannte Live-Hostadresse(n): $AUTO_HOSTS (WebRTC vorbereitet, HLS bleibt Standard)"
else
  upsert_env_key WEBRTC_ADDITIONAL_HOSTS ''
  upsert_env_key STREAM_WEBRTC_ENABLED false
  upsert_env_key STREAM_BROWSER_HLS_MODE local-ring
  upsert_env_key STREAM_BROWSER_TRANSPORT_ORDER local-hls
  upsert_env_key VITE_STREAM_PLAYBACK_ORDER local-hls
  upsert_env_key LOCAL_HLS_DIR /data/live
  upsert_env_key PUBLIC_LOCAL_HLS_BASE /live-hls
  sync_go2rtc_candidate
  printf '%s\n' 'Keine browser-erreichbare Hostadresse erkannt; Live/Kiosk nutzt HLS.' >&2
fi
