#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"

# Some ZIP extractors (notably certain macOS/browser workflows) can drop executable bits.
# Nested scripts are invoked through `sh` as well, but restore the bits for normal CLI use.
chmod 755 ./start.sh ./stop.sh ./update.sh ./logs.sh ./scripts/*.sh 2>/dev/null || true

random_secret() { head -c 48 /dev/urandom | base64 | tr -d '\n'; }
ensure_env_key() {
  key="$1"
  value="$2"
  grep -q "^${key}=" .env 2>/dev/null || printf '%s=%s\n' "$key" "$value" >> .env
}
upsert_env_key() {
  key="$1"
  value="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    awk -v key="$key" -v value="$value" 'BEGIN{done=0} $0 ~ "^" key "=" { if (!done) { print key "=" value; done=1 } next } { print } END{ if (!done) print key "=" value }' .env > .env.upsert.tmp
    mv .env.upsert.tmp .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}
migrate_env_default() {
  key="$1"
  legacy_value="$2"
  new_value="$3"
  current_value="$(awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' .env 2>/dev/null || true)"
  [ "$current_value" = "$legacy_value" ] && upsert_env_key "$key" "$new_value" || true
}
local_ip() {
  if command -v ipconfig >/dev/null 2>&1; then
    ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true
  elif command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | awk '{print $1}' || true
  fi
}

valid_webrtc_host() {
  value="$1"
  case "$value" in
    ""|host.docker.internal|localhost|127.*|0.0.0.0|::|::1) return 1 ;;
    *) return 0 ;;
  esac
}

current_env_value() {
  key="$1"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); gsub(/^"|"$/, ""); print; exit }' .env 2>/dev/null || true
}

repair_webrtc_host_default() {
  host_ip="$(local_ip)"
  current="$(current_env_value WEBRTC_ADDITIONAL_HOSTS)"
  if [ -n "$host_ip" ] && ! valid_webrtc_host "$current"; then
    upsert_env_key WEBRTC_ADDITIONAL_HOSTS "$host_ip"
  fi
}

host_disk_metrics() {
  target="${1:-.}"
  if command -v df >/dev/null 2>&1; then
    df -Pk "$target" 2>/dev/null | awk 'NR==2 { total=$2*1024; used=$3*1024; avail=$4*1024; if (total > 0) printf "%d %d %d", total, used, avail }'
  fi
}

refresh_host_disk_snapshot() {
  metrics="$(host_disk_metrics "$PROJECT_PATH" || true)"
  total="$(printf '%s' "$metrics" | awk '{print $1}')"
  used="$(printf '%s' "$metrics" | awk '{print $2}')"
  available="$(printf '%s' "$metrics" | awk '{print $3}')"
  [ -n "$total" ] || total=0
  [ -n "$used" ] || used=0
  [ -n "$available" ] || available=0
  upsert_env_key SYSTEM_HOST_DISK_TOTAL_BYTES "$total"
  upsert_env_key SYSTEM_HOST_DISK_USED_BYTES "$used"
  upsert_env_key SYSTEM_HOST_DISK_AVAILABLE_BYTES "$available"
  upsert_env_key SYSTEM_HOST_DISK_SOURCE host-df-snapshot
}


docker_host() {
  if docker info >/dev/null 2>&1; then docker "$@"; return; fi
  if command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then sudo docker "$@"; return; fi
  return 1
}

active_compose_project_name() {
  project_data_path="$PROJECT_PATH/data"
  project_config_path="$PROJECT_PATH/mediamtx"
  for service in updater backend mediamtx frontend; do
    ids="$(docker_host ps -a --filter label=com.docker.compose.service=$service --format '{{.ID}}' 2>/dev/null || true)"
    for id in $ids; do
      match="$(docker_host inspect -f '{{range .Mounts}}{{if or (eq .Destination "/workspace") (eq .Destination "/data") (eq .Destination "/config")}}{{println .Destination "=" .Source}}{{end}}{{end}}' "$id" 2>/dev/null | awk -v root="$PROJECT_PATH" -v data="$project_data_path" -v config="$project_config_path" '
        $1 == "/workspace" && $3 == root { print "yes"; exit }
        $1 == "/data" && $3 == data { print "yes"; exit }
        $1 == "/config" && $3 == config { print "yes"; exit }
      ' || true)"
      [ "$match" = "yes" ] || continue
      project="$(docker_host inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$id" 2>/dev/null || true)"
      case "$project" in
        ""|*[!A-Za-z0-9_-]*|[-_]* ) :;;
        * ) printf '%s' "$project"; return 0;;
      esac
    done
  done
  printf '%s' tmp-camera-surveillance-next
}

host_scan_ranges() {
  ranges=""
  append_range() {
    value="$1"
    [ -n "$value" ] || return 0
    case ",$ranges," in *",$value,"*) return 0;; esac
    ranges="${ranges}${ranges:+,}${value}"
  }
  if command -v ip >/dev/null 2>&1; then
    ip -o -4 route show 2>/dev/null | awk '
      $1 != "default" && $1 ~ /\// && $0 !~ / dev (docker|br-|veth|virbr|cni|podman)/ {
        split($1,a,"/"); p=a[2]+0;
        # Keine /32-Hostrouten übernehmen: Wenn bereits ein /24-Interface-Netz existiert,
        # würden zusätzliche Hostrouten jeden Zielhost doppelt in den Scan bringen.
        if (p >= 16 && p <= 30 && (a[1] ~ /^10\./ || a[1] ~ /^192\.168\./ || a[1] ~ /^172\.(1[6-9]|2[0-9]|3[01])\./ || a[1] ~ /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./)) print $1
      }' | while IFS= read -r value; do printf '%s\n' "$value"; done > /tmp/tmp-camera-host-ranges.$$
  elif command -v netstat >/dev/null 2>&1; then
    netstat -rn -f inet 2>/dev/null | awk '
      function private(ip) { return ip ~ /^10\./ || ip ~ /^192\.168\./ || ip ~ /^172\.(1[6-9]|2[0-9]|3[01])\./ || ip ~ /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./ }
      /^[0-9]/ && $1 != "default" {
        d=$1; p="";
        if (d ~ /\//) { split(d,a,"/"); d=a[1]; p=a[2]+0 }
        else { n=split(d,a,"."); if (n==3) { d=d ".0"; p=24 } else if (n==4) p=32 }
        # Hostrouten (/32) werden bewusst ignoriert. Kameras in einzelnen Remote-Hostrouten
        # können weiterhin manuell über den Bereichsscan eingetragen werden.
        if (private(d) && p >= 16 && p <= 30) print d "/" p
      }' | sort -u > /tmp/tmp-camera-host-ranges.$$
  else
    : > /tmp/tmp-camera-host-ranges.$$
  fi
  while IFS= read -r value; do append_range "$value"; done < /tmp/tmp-camera-host-ranges.$$ 2>/dev/null || true
  rm -f /tmp/tmp-camera-host-ranges.$$
  if [ -z "$ranges" ]; then
    ip_value="$(local_ip)"
    case "$ip_value" in
      *.*.*.*) append_range "$(printf '%s' "$ip_value" | awk -F. '{print $1"."$2"."$3".0/24"}')";;
    esac
  fi
  printf '%s' "$ranges"
}

nvidia_gpu_status_default() {
  command -v nvidia-smi >/dev/null 2>&1 || { printf '%s' false; return 0; }
  runtimes=""
  if docker info >/dev/null 2>&1; then
    runtimes="$(docker info --format '{{json .Runtimes}}' 2>/dev/null || true)"
  elif command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
    runtimes="$(sudo docker info --format '{{json .Runtimes}}' 2>/dev/null || true)"
  fi
  case "$runtimes" in *nvidia*) printf '%s' true;; *) printf '%s' false;; esac
}

NVIDIA_GPU_STATUS_DEFAULT="$(nvidia_gpu_status_default)"
HOST_UID="${SUDO_UID:-$(id -u)}"
HOST_GID="${SUDO_GID:-$(id -g)}"
PROJECT_PATH="$(pwd -P)"
COMPOSE_PROJECT_NAME_VALUE="$(active_compose_project_name)"
PROJECT_PATH_ESCAPED=$(printf '%s' "$PROJECT_PATH" | sed 's/\\/\\\\/g; s/"/\\"/g')
HOST_SCAN_RANGES_VALUE="$(host_scan_ranges)"
HOST_DISK_METRICS="$(host_disk_metrics "$PROJECT_PATH" || true)"
HOST_DISK_TOTAL_BYTES="$(printf '%s' "$HOST_DISK_METRICS" | awk '{print $1}')"
HOST_DISK_USED_BYTES="$(printf '%s' "$HOST_DISK_METRICS" | awk '{print $2}')"
HOST_DISK_AVAILABLE_BYTES="$(printf '%s' "$HOST_DISK_METRICS" | awk '{print $3}')"
[ -n "$HOST_DISK_TOTAL_BYTES" ] || HOST_DISK_TOTAL_BYTES=0
[ -n "$HOST_DISK_USED_BYTES" ] || HOST_DISK_USED_BYTES=0
[ -n "$HOST_DISK_AVAILABLE_BYTES" ] || HOST_DISK_AVAILABLE_BYTES=0

if [ ! -f .env ]; then
  ADMIN_PASSWORD="$(random_secret | cut -c1-20)"
  HOST_IP="$(local_ip)"
  [ -n "$HOST_IP" ] || HOST_IP=""
  cat > .env <<ENV
TZ=Europe/Berlin
PUID=${HOST_UID}
PGID=${HOST_GID}
PROJECT_HOST_PATH="${PROJECT_PATH_ESCAPED}"
RECORDINGS_DIR=/data/recordings
RECORDINGS_LOCAL_DIR=/data/recordings
NETWORK_RECORDING_CACHE_MAX_BYTES=2147483648
NETWORK_RECORDING_UPLOAD_INTERVAL_MS=15000
NETWORK_RECORDING_COMMAND_TIMEOUT_MS=30000
NETWORK_RECORDING_STALE_PART_MAX_AGE_MS=3600000
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME_VALUE}
HTTP_PORT=8080
HTTPS_PORT=8443
WEBRTC_ICE_PORT=8189
ADMIN_USER=admin
ADMIN_PASSWORD=${ADMIN_PASSWORD}
JWT_SECRET=$(random_secret)
MEDIA_TOKEN_SECRET=$(random_secret)
CAMERA_CREDENTIAL_KEY=$(random_secret)
UPDATER_TOKEN=$(random_secret)
UPDATER_SERVICE_PROTOCOL=http
UPDATER_SERVICE_NAME=updater
UPDATER_SERVICE_PORT=3010
UPDATER_SERVICE_BASE_PATH=
UPDATER_SOCKET_PATH=/data/updates/tmp-camera-updater.sock
UPDATER_URLS=
UPDATER_URL=
UPDATER_FALLBACK_URLS=http://tmp-camera-updater:3010,http://updater:3010
UPDATER_FALLBACK_URL=
UPDATER_HEALTH_TIMEOUT_MS=3500
UPDATER_REQUEST_TIMEOUT_MS=15000
UPDATER_HEALTH_RETRIES=1
UPDATER_REQUEST_RETRIES=1
UPDATER_RETRY_DELAY_MS=250
UPDATER_RESTART_GRACE_MS=300000
UPDATER_IDEMPOTENCY_TTL_MS=900000
COMPOSE_BAKE=false
DOCKER_BUILDKIT=0
COMPOSE_DOCKER_CLI_BUILD=0
FORCE_IMAGE_PULL=false
UPDATER_OPTIONAL=true
BACKEND_HEALTH_URL=http://backend:3000/health
FRONTEND_HEALTH_URL=http://frontend:8080/healthz
MAX_UPDATE_BYTES=536870912
MAX_EXTRACTED_BYTES=2147483648
ACCESS_TOKEN_TTL=8h
MEDIA_TOKEN_TTL_SECONDS=3600
RECORDING_TOKEN_TTL_SECONDS=86400
STREAM_IDLE_SECONDS=180
PERMANENT_CAMERA_INGEST_ENABLED=true
PERMANENT_CAMERA_INGEST_QUALITY=low
PERMANENT_CAMERA_INGEST_PROFILE=auto-substream
PERMANENT_CAMERA_INGEST_VIDEO_MODE=force-copy
PERMANENT_CAMERA_INGEST_STARTUP_STAGGER_MS=1500
KIOSK_PREFER_SUBSTREAM=true
LIVE_PREFER_MAINSTREAM=true
RECORDING_PREFER_MAINSTREAM=true
MOTION_PREFER_SUBSTREAM=true
BROWSER_TRANSCODE_FALLBACK_ENABLED=false
STREAM_BROWSER_VIDEO_MODE=copy-first
SYSTEM_METRICS_CACHE_MS=2000
SYSTEM_METRICS_REFRESH_MS=3000
SYSTEM_METRICS_CPU_SAMPLE_MS=250
SYSTEM_METRICS_COMMAND_TIMEOUT_MS=2500
SYSTEM_PROC_ROOT=/host/proc
SYSTEM_SYS_ROOT=/host/sys
SYSTEM_DISK_PATH=/data
SYSTEM_STORAGE_PLAUSIBLE_MAX_BYTES=70368744177664
SYSTEM_HOST_DISK_TOTAL_BYTES=${HOST_DISK_TOTAL_BYTES}
SYSTEM_HOST_DISK_USED_BYTES=${HOST_DISK_USED_BYTES}
SYSTEM_HOST_DISK_AVAILABLE_BYTES=${HOST_DISK_AVAILABLE_BYTES}
SYSTEM_HOST_DISK_SOURCE=host-df
SYSTEM_NETWORK_EXCLUDE_INTERFACES=lo,docker*,br-*,veth*,virbr*,cni*,podman*
SYSTEM_NETWORK_MAX_DEVICES=12
NVIDIA_SMI_PATH=nvidia-smi
ENABLE_NVIDIA_GPU_STATUS=false
ENABLE_NVIDIA_GPU_COMPOSE=false
NVIDIA_VISIBLE_DEVICES=all
NVIDIA_DRIVER_CAPABILITIES=utility,compute,video
DISCOVERY_JOB_RETENTION_MS=900000
DISCOVERY_MAX_JOBS=30
DISCOVERY_PROTOCOL_RETRIES=1
DISCOVERY_RETRY_DELAY_MS=350
DISCOVERY_SCAN_CONCURRENCY=64
DISCOVERY_PER_HOST_CONCURRENCY=4
DISCOVERY_FINGERPRINT_CONCURRENCY=8
DISCOVERY_PORT_TIMEOUT_MS=600
DISCOVERY_AUTO_TIMEOUT_MS=6500
DISCOVERY_SCAN_ENGINE=auto
DISCOVERY_NMAP_PATH=nmap
DISCOVERY_NMAP_TIMEOUT_MS=120000
DISCOVERY_HOST_DISCOVERY_PORTS=80,443,554,8000,8080,8443,8554,8899,10554,37777,34567,7681
DISCOVERY_HOST_DISCOVERY_TIMEOUT_MS=350
DISCOVERY_FULL_SCAN_FALLBACK_HOST_LIMIT=32
DISCOVERY_AUTO_HOST_COLLAPSE_THRESHOLD=8
DISCOVERY_INITIAL_ENABLED=true
DISCOVERY_INITIAL_DELAY_MS=3500
DISCOVERY_INITIAL_ATTEMPTS=3
DISCOVERY_INITIAL_RETRY_DELAY_MS=5000
STREAM_LEASE_TTL_SECONDS=90
STREAM_BROWSER_CACHE_SECONDS=120
VITE_STREAM_BROWSER_PREWARM_ENABLED=false
VITE_BROWSER_TRANSCODE_FALLBACK_ENABLED=false
VITE_STREAM_BROWSER_CACHE_SECONDS=120
# Aufnahmen werden als atomare, einzeln abspielbare Bloecke gespeichert.
RECORDING_BLOCK_SECONDS=300
RECORDING_BLOCK_PROBE_TIMEOUT_MS=12000
RECORDING_BLOCK_MINIMUM_BYTES=1880
RECORDING_STARTUP_MEDIA_TIMEOUT_MS=15000
RECORDING_ROTATION_GRACE_MS=5000
RECORDING_STOP_GRACE_MS=20000
RECORDING_MIN_FREE_BYTES=536870912
# RECORDING_SEGMENT_SECONDS bleibt nur als Alt-Konfigurationsfallback erhalten.
# RECORDING_SEGMENT_SECONDS=300
RECORDING_FINALIZE_TIMEOUT_MS=120000
RECORDING_RECONNECT_BASE_MS=1000
RECORDING_RECONNECT_MAX_MS=15000
RECORDING_MAX_OUTAGE_SECONDS=180
RECORDING_MAX_RECONNECT_ATTEMPTS=30
RECORDING_STABLE_RESET_SECONDS=30
RECORDING_WATCHDOG_INTERVAL_MS=2500
RECORDING_STALL_SECONDS=25
RECORDING_SOURCE_PROTOCOL=auto
RECORDING_PREBUFFER_MAX_SECONDS=10
RECORDING_SCHEDULER_INTERVAL_MS=5000
RECORDING_SCHEDULER_CONCURRENCY=4
RECORDING_QUEUE_MAX_PENDING=20
RECORDING_SCHEDULER_IMMEDIATE_DEBOUNCE_MS=250
PTZ_COMMAND_TIMEOUT_MS=5000
PTZ_CONTINUOUS_MOVE_TIMEOUT_MS=1200
PTZ_LEASE_TTL_MS=2500
PTZ_LEASE_SWEEP_MS=500
PTZ_TOMBSTONE_TTL_MS=15000
PTZ_MAX_LEASES_PER_CAMERA=16
PTZ_CLIENT_IDLE_MS=300000
PTZ_MOTION_SETTLE_MS=2200
MOTION_DETECTION_ENABLED=true
MOTION_DETECTION_SOURCE=live
MOTION_DETECTION_SNAPSHOT_FALLBACK=false
MOTION_DETECTION_SKIP_DURING_PTZ=true
MOTION_DETECTION_INTERVAL_MS=2000
MOTION_DETECTION_CONCURRENCY=2
MOTION_DETECTION_FRAME_WIDTH=96
MOTION_DETECTION_FRAME_HEIGHT=54
MOTION_DETECTION_FRAME_TIMEOUT_MS=9000
MOTION_DETECTION_BLUR_RADIUS=1
MOTION_DETECTION_STABILIZATION_PIXELS=1
MOTION_DETECTION_BRIGHTNESS_COMPENSATION=true
MOTION_DETECTION_PIXEL_THRESHOLD=10
MOTION_DETECTION_MIN_CHANGED_RATIO=0.008
MOTION_DETECTION_MIN_AVERAGE_DIFF=0.6
MOTION_DETECTION_MIN_CHANGED_PIXELS=18
MOTION_DETECTION_SCENE_CHANGE_RATIO=0.85
MOTION_DETECTION_SCENE_CHANGE_MIN_AVERAGE_DIFF=12
MOTION_DETECTION_SUPPRESS_SCENE_CHANGES=false
MOTION_DETECTION_EVENT_SECONDS=20
MOTION_DETECTION_COOLDOWN_SECONDS=3
MOTION_DETECTION_REARM_SECONDS=3
MOTION_DETECTION_RETRIGGER_SECONDS=12
MOTION_DETECTION_DEBOUNCE_FRAMES=1
MOTION_DETECTION_WINDOW_FRAMES=4
MOTION_DETECTION_WINDOW_MIN_MOTION_FRAMES=1
RETENTION_CLEANUP_INTERVAL_MS=900000
RETENTION_STARTUP_DELAY_MS=20000
RETENTION_BATCH_SIZE=100
RETENTION_DEFAULT_MAX_AGE_DAYS=30
ALERT_WEBHOOK_URL=
ALERT_MIN_LEVEL=error
ALERT_COOLDOWN_MS=300000
WEBSOCKET_ALLOWED_ORIGINS=
WEBSOCKET_MAX_CLIENTS=128
WEBSOCKET_MAX_MESSAGE_BYTES=16384
WEBSOCKET_HEARTBEAT_MS=20000
WEBSOCKET_MAX_BUFFERED_BYTES=1048576
AUDIT_LOG_RETENTION_DAYS=180
DOMAIN_EVENT_QUEUE_LIMIT=2000
STREAM_STALL_SECONDS=45
SNAPSHOT_VIDEO_FPS=5
SNAPSHOT_REFRESH_MS=1000
PROBE_TIMEOUT_MS=9000
STREAM_START_TIMEOUT_MS=15000
MAX_RESTART_BACKOFF_MS=30000
LOG_LEVEL=info
HTTPS_SITE_ADDRESS=https://camera.local
WEBRTC_ADDITIONAL_HOSTS=
WEBRTC_ADDITIONAL_HOSTS_MODE=auto
STREAM_WEBRTC_ENABLED=false
STREAM_BROWSER_HLS_MODE=local-ring
STREAM_BROWSER_TRANSPORT_ORDER=local-hls
LOCAL_HLS_DIR=/data/live
PUBLIC_LOCAL_HLS_BASE=/live-hls
VITE_STREAM_PLAYBACK_ORDER=local-hls
HOST_SCAN_RANGES=
AUTO_HOST_SCAN_RANGES=${HOST_SCAN_RANGES_VALUE}
ENV
  chmod 600 .env
  if [ "$(id -u)" = "0" ]; then chown "${HOST_UID}:${HOST_GID}" .env 2>/dev/null || true; fi
  sh ./scripts/auto-network-env.sh .
  printf '\nErster Login: admin\nInitiales Kennwort: %s\n\n' "$ADMIN_PASSWORD"
  printf 'Das Kennwort steht ebenfalls in .env. Bitte sicher aufbewahren.\n\n'
else
  if ! grep -q '^UPDATER_TOKEN=.' .env; then printf '\nUPDATER_TOKEN=%s\n' "$(random_secret)" >> .env; fi
  # ensure_env_key COMPOSE_PROJECT_NAME would preserve stale folder-derived names; upsert keeps the active Compose project pinned.
  upsert_env_key COMPOSE_PROJECT_NAME "$COMPOSE_PROJECT_NAME_VALUE"
  sh ./scripts/auto-network-env.sh .
  upsert_env_key UPDATER_SERVICE_PROTOCOL http
  upsert_env_key UPDATER_SERVICE_NAME updater
  upsert_env_key UPDATER_SERVICE_PORT 3010
  upsert_env_key UPDATER_SERVICE_BASE_PATH ''
  upsert_env_key UPDATER_SOCKET_PATH /data/updates/tmp-camera-updater.sock
  upsert_env_key UPDATER_URLS ''
  upsert_env_key UPDATER_URL ''
  upsert_env_key UPDATER_FALLBACK_URLS 'http://tmp-camera-updater:3010,http://updater:3010'
  upsert_env_key UPDATER_FALLBACK_URL ''
  upsert_env_key STREAM_WEBRTC_ENABLED false
  upsert_env_key STREAM_BROWSER_HLS_MODE local-ring
  upsert_env_key STREAM_BROWSER_TRANSPORT_ORDER local-hls
  upsert_env_key LOCAL_HLS_DIR /data/live
  upsert_env_key PUBLIC_LOCAL_HLS_BASE /live-hls
  upsert_env_key VITE_STREAM_PLAYBACK_ORDER local-hls
  ensure_env_key UPDATER_HEALTH_TIMEOUT_MS 3500
  ensure_env_key UPDATER_REQUEST_TIMEOUT_MS 15000
  ensure_env_key UPDATER_HEALTH_RETRIES 1
  ensure_env_key UPDATER_REQUEST_RETRIES 1
  ensure_env_key UPDATER_RETRY_DELAY_MS 250
  ensure_env_key UPDATER_RESTART_GRACE_MS 300000
  ensure_env_key UPDATER_IDEMPOTENCY_TTL_MS 900000
  ensure_env_key BACKEND_HEALTH_URL http://backend:3000/health
  ensure_env_key FRONTEND_HEALTH_URL http://frontend:8080/healthz
  ensure_env_key MAX_UPDATE_BYTES 536870912
  ensure_env_key MAX_EXTRACTED_BYTES 2147483648
  ensure_env_key DISCOVERY_JOB_RETENTION_MS 900000
  ensure_env_key DISCOVERY_MAX_JOBS 30
  ensure_env_key DISCOVERY_PROTOCOL_RETRIES 1
  ensure_env_key DISCOVERY_RETRY_DELAY_MS 350
  ensure_env_key DISCOVERY_SCAN_CONCURRENCY 64
  ensure_env_key DISCOVERY_PER_HOST_CONCURRENCY 4
  ensure_env_key DISCOVERY_FINGERPRINT_CONCURRENCY 8
  ensure_env_key DISCOVERY_PORT_TIMEOUT_MS 600
  ensure_env_key DISCOVERY_AUTO_TIMEOUT_MS 6500
  ensure_env_key DISCOVERY_SCAN_ENGINE auto
  ensure_env_key DISCOVERY_NMAP_PATH nmap
  ensure_env_key DISCOVERY_NMAP_TIMEOUT_MS 120000
  ensure_env_key DISCOVERY_HOST_DISCOVERY_PORTS 80,443,554,8000,8080,8443,8554,8899,10554,37777,34567,7681
  ensure_env_key DISCOVERY_HOST_DISCOVERY_TIMEOUT_MS 350
  ensure_env_key DISCOVERY_FULL_SCAN_FALLBACK_HOST_LIMIT 32
  ensure_env_key DISCOVERY_AUTO_HOST_COLLAPSE_THRESHOLD 8
  ensure_env_key DISCOVERY_INITIAL_ENABLED true
  ensure_env_key DISCOVERY_INITIAL_DELAY_MS 3500
  ensure_env_key DISCOVERY_INITIAL_ATTEMPTS 3
  ensure_env_key DISCOVERY_INITIAL_RETRY_DELAY_MS 5000
  ensure_env_key STREAM_LEASE_TTL_SECONDS 90
  ensure_env_key STREAM_BROWSER_CACHE_SECONDS 120
  ensure_env_key VITE_STREAM_BROWSER_PREWARM_ENABLED false
  upsert_env_key VITE_BROWSER_TRANSCODE_FALLBACK_ENABLED false
  ensure_env_key VITE_STREAM_BROWSER_CACHE_SECONDS 120
  ensure_env_key STREAM_IDLE_SECONDS 180
  ensure_env_key PERMANENT_CAMERA_INGEST_ENABLED true
  ensure_env_key PERMANENT_CAMERA_INGEST_QUALITY low
  ensure_env_key PERMANENT_CAMERA_INGEST_PROFILE auto-substream
  ensure_env_key PERMANENT_CAMERA_INGEST_VIDEO_MODE force-copy
  ensure_env_key PERMANENT_CAMERA_INGEST_STARTUP_STAGGER_MS 1500
  ensure_env_key KIOSK_PREFER_SUBSTREAM true
  ensure_env_key LIVE_PREFER_MAINSTREAM true
  ensure_env_key RECORDING_PREFER_MAINSTREAM true
  ensure_env_key MOTION_PREFER_SUBSTREAM true
  upsert_env_key BROWSER_TRANSCODE_FALLBACK_ENABLED false
  ensure_env_key STREAM_BROWSER_VIDEO_MODE copy-first
  migrate_env_default PERMANENT_CAMERA_INGEST_QUALITY balanced low
  migrate_env_default STREAM_BROWSER_VIDEO_MODE safe copy-first
  ensure_env_key MEDIA_TOKEN_TTL_SECONDS 3600
  ensure_env_key RECORDING_TOKEN_TTL_SECONDS 86400
  ensure_env_key SYSTEM_METRICS_CACHE_MS 2000
  ensure_env_key SYSTEM_METRICS_REFRESH_MS 3000
  ensure_env_key SYSTEM_METRICS_CPU_SAMPLE_MS 250
  ensure_env_key SYSTEM_METRICS_COMMAND_TIMEOUT_MS 2500
  ensure_env_key SYSTEM_PROC_ROOT /host/proc
  ensure_env_key SYSTEM_SYS_ROOT /host/sys
  ensure_env_key SYSTEM_DISK_PATH /data
  ensure_env_key SYSTEM_STORAGE_PLAUSIBLE_MAX_BYTES 70368744177664
  ensure_env_key SYSTEM_NETWORK_EXCLUDE_INTERFACES "lo,docker*,br-*,veth*,virbr*,cni*,podman*"
  ensure_env_key SYSTEM_NETWORK_MAX_DEVICES 12
  upsert_env_key SYSTEM_HOST_DISK_TOTAL_BYTES "$HOST_DISK_TOTAL_BYTES"
  upsert_env_key SYSTEM_HOST_DISK_USED_BYTES "$HOST_DISK_USED_BYTES"
  upsert_env_key SYSTEM_HOST_DISK_AVAILABLE_BYTES "$HOST_DISK_AVAILABLE_BYTES"
  upsert_env_key SYSTEM_HOST_DISK_SOURCE host-df
  ensure_env_key NVIDIA_SMI_PATH nvidia-smi
  ensure_env_key ENABLE_NVIDIA_GPU_STATUS false
  ensure_env_key ENABLE_NVIDIA_GPU_COMPOSE false
  ensure_env_key NVIDIA_VISIBLE_DEVICES all
  ensure_env_key NVIDIA_DRIVER_CAPABILITIES utility,compute,video
  ensure_env_key STREAM_STALL_SECONDS 45
  ensure_env_key PROBE_TIMEOUT_MS 9000
  ensure_env_key STREAM_START_TIMEOUT_MS 15000
  ensure_env_key MAX_RESTART_BACKOFF_MS 30000
  ensure_env_key CAMERA_CONNECT_TIMEOUT_MS 10000
  ensure_env_key RECORDING_BLOCK_SECONDS 300
  ensure_env_key RECORDING_BLOCK_PROBE_TIMEOUT_MS 12000
  ensure_env_key RECORDING_BLOCK_MINIMUM_BYTES 1880
  ensure_env_key RECORDING_STARTUP_MEDIA_TIMEOUT_MS 15000
  ensure_env_key RECORDING_ROTATION_GRACE_MS 5000
  ensure_env_key RECORDING_STOP_GRACE_MS 20000
  ensure_env_key RECORDING_MIN_FREE_BYTES 536870912
  ensure_env_key RECORDING_FINALIZE_TIMEOUT_MS 120000
  ensure_env_key RECORDING_RECONNECT_BASE_MS 1000
  ensure_env_key RECORDING_RECONNECT_MAX_MS 15000
  ensure_env_key RECORDING_MAX_OUTAGE_SECONDS 180
  ensure_env_key RECORDING_MAX_RECONNECT_ATTEMPTS 30
  ensure_env_key RECORDING_STABLE_RESET_SECONDS 30
  ensure_env_key RECORDING_WATCHDOG_INTERVAL_MS 2500
  ensure_env_key RECORDING_STALL_SECONDS 25
  ensure_env_key RECORDING_SOURCE_PROTOCOL auto
  ensure_env_key RECORDING_PREBUFFER_MAX_SECONDS 10
  ensure_env_key RECORDING_SCHEDULER_INTERVAL_MS 5000
  ensure_env_key RECORDING_SCHEDULER_CONCURRENCY 4
  ensure_env_key RECORDING_QUEUE_MAX_PENDING 20
  ensure_env_key RECORDING_SCHEDULER_IMMEDIATE_DEBOUNCE_MS 250
  ensure_env_key PTZ_COMMAND_TIMEOUT_MS 5000
  ensure_env_key PTZ_CONTINUOUS_MOVE_TIMEOUT_MS 1200
  ensure_env_key PTZ_LEASE_TTL_MS 2500
  ensure_env_key PTZ_LEASE_SWEEP_MS 500
  ensure_env_key PTZ_TOMBSTONE_TTL_MS 15000
  ensure_env_key PTZ_MAX_LEASES_PER_CAMERA 16
  ensure_env_key PTZ_CLIENT_IDLE_MS 300000
  ensure_env_key PTZ_MOTION_SETTLE_MS 2200
  ensure_env_key MOTION_DETECTION_ENABLED true
  ensure_env_key MOTION_DETECTION_SOURCE live
  ensure_env_key MOTION_DETECTION_SNAPSHOT_FALLBACK false
  ensure_env_key MOTION_DETECTION_SKIP_DURING_PTZ true
  ensure_env_key MOTION_DETECTION_INTERVAL_MS 2000
  ensure_env_key MOTION_DETECTION_CONCURRENCY 2
  ensure_env_key MOTION_DETECTION_FRAME_WIDTH 96
  ensure_env_key MOTION_DETECTION_FRAME_HEIGHT 54
  ensure_env_key MOTION_DETECTION_FRAME_TIMEOUT_MS 9000
  ensure_env_key MOTION_DETECTION_BLUR_RADIUS 1
  ensure_env_key MOTION_DETECTION_STABILIZATION_PIXELS 1
  ensure_env_key MOTION_DETECTION_BRIGHTNESS_COMPENSATION true
  ensure_env_key MOTION_DETECTION_PIXEL_THRESHOLD 10
  ensure_env_key MOTION_DETECTION_MIN_CHANGED_RATIO 0.008
  ensure_env_key MOTION_DETECTION_MIN_AVERAGE_DIFF 0.6
  ensure_env_key MOTION_DETECTION_MIN_CHANGED_PIXELS 18
  ensure_env_key MOTION_DETECTION_SCENE_CHANGE_RATIO 0.85
  ensure_env_key MOTION_DETECTION_SCENE_CHANGE_MIN_AVERAGE_DIFF 12
  ensure_env_key MOTION_DETECTION_SUPPRESS_SCENE_CHANGES false
  ensure_env_key MOTION_DETECTION_EVENT_SECONDS 20
  ensure_env_key MOTION_DETECTION_COOLDOWN_SECONDS 3
  ensure_env_key MOTION_DETECTION_REARM_SECONDS 3
  ensure_env_key MOTION_DETECTION_RETRIGGER_SECONDS 12
  ensure_env_key MOTION_DETECTION_DEBOUNCE_FRAMES 1
  ensure_env_key MOTION_DETECTION_WINDOW_FRAMES 4
  ensure_env_key MOTION_DETECTION_WINDOW_MIN_MOTION_FRAMES 1
  # Nur unveraenderte Alt-Defaults migrieren; benutzerdefinierte Werte bleiben erhalten.
  migrate_env_default RECORDING_MAX_OUTAGE_SECONDS 3600 180
  migrate_env_default RECORDING_MAX_RECONNECT_ATTEMPTS 720 30
  migrate_env_default RECORDING_STALL_SECONDS 90 25
  migrate_env_default MOTION_DETECTION_PIXEL_THRESHOLD 18 10
  migrate_env_default MOTION_DETECTION_MIN_CHANGED_RATIO 0.025 0.008
  migrate_env_default MOTION_DETECTION_MIN_AVERAGE_DIFF 3 0.6
  migrate_env_default STREAM_BROWSER_CACHE_SECONDS 120 0
  migrate_env_default VITE_STREAM_BROWSER_CACHE_SECONDS 120 0
  migrate_env_default UPDATER_RESTART_GRACE_MS 90000 300000
  migrate_env_default STREAM_IDLE_SECONDS 180 45
  migrate_env_default STREAM_STALL_SECONDS 45 20
  migrate_env_default MOTION_DETECTION_COOLDOWN_SECONDS 15 3
  ensure_env_key RETENTION_CLEANUP_INTERVAL_MS 900000
  ensure_env_key RETENTION_STARTUP_DELAY_MS 20000
  ensure_env_key RETENTION_BATCH_SIZE 100
  ensure_env_key RETENTION_DEFAULT_MAX_AGE_DAYS 30
  ensure_env_key ALERT_WEBHOOK_URL ''
  ensure_env_key ALERT_MIN_LEVEL error
  ensure_env_key ALERT_COOLDOWN_MS 300000
  ensure_env_key WEBSOCKET_ALLOWED_ORIGINS ''
  ensure_env_key WEBSOCKET_MAX_CLIENTS 128
  ensure_env_key WEBSOCKET_MAX_MESSAGE_BYTES 16384
  ensure_env_key WEBSOCKET_HEARTBEAT_MS 20000
  ensure_env_key WEBSOCKET_MAX_BUFFERED_BYTES 1048576
  ensure_env_key AUDIT_LOG_RETENTION_DAYS 180
  ensure_env_key DOMAIN_EVENT_QUEUE_LIMIT 2000
  ensure_env_key COMPOSE_BAKE false
  ensure_env_key DOCKER_BUILDKIT 0
  ensure_env_key COMPOSE_DOCKER_CLI_BUILD 0
  ensure_env_key FORCE_IMAGE_PULL false
  ensure_env_key UPDATER_DOCKER_CACHE_CLEANUP true
  ensure_env_key UPDATER_OPTIONAL true
  ensure_env_key RECORDINGS_DIR /data/recordings
  ensure_env_key RECORDINGS_LOCAL_DIR /data/recordings
  ensure_env_key NETWORK_RECORDING_CACHE_MAX_BYTES 2147483648
  ensure_env_key NETWORK_RECORDING_UPLOAD_INTERVAL_MS 15000
  ensure_env_key NETWORK_RECORDING_COMMAND_TIMEOUT_MS 30000
  ensure_env_key NETWORK_RECORDING_STALE_PART_MAX_AGE_MS 3600000
  ensure_env_key SNAPSHOT_VIDEO_FPS 5
  ensure_env_key SNAPSHOT_REFRESH_MS 1000
  # Manuelle Bereiche bleiben dauerhaft erhalten; nur automatisch erkannte Host-Routen werden aktualisiert.
  ensure_env_key HOST_SCAN_RANGES ''
  if grep -q '^AUTO_HOST_SCAN_RANGES=' .env; then
    awk -v ranges="$HOST_SCAN_RANGES_VALUE" 'BEGIN{done=0} /^AUTO_HOST_SCAN_RANGES=/{if(!done){print "AUTO_HOST_SCAN_RANGES=" ranges; done=1}; next} {print} END{if(!done) print "AUTO_HOST_SCAN_RANGES=" ranges}' .env > .env.scan.tmp
    mv .env.scan.tmp .env
  else
    printf 'AUTO_HOST_SCAN_RANGES=%s\n' "$HOST_SCAN_RANGES_VALUE" >> .env
  fi
  if grep -q '^PROJECT_HOST_PATH=' .env; then
    awk -v path="$PROJECT_PATH_ESCAPED" 'BEGIN{done=0} /^PROJECT_HOST_PATH=/{if(!done){print "PROJECT_HOST_PATH=\"" path "\""; done=1}; next} {print} END{if(!done) print "PROJECT_HOST_PATH=\"" path "\""}' .env > .env.tmp
    mv .env.tmp .env
  else
    printf 'PROJECT_HOST_PATH=\"%s\"\n' "$PROJECT_PATH_ESCAPED" >> .env
  fi
  chmod 600 .env
fi

mkdir -p data/live data/snapshots data/recordings data/external-recordings data/backups data/updates/packages data/updates/staging data/updates/backups data/updates/docker-cli/home data/updates/docker-cli/config data/updates/docker-cli/buildx data/caddy/data data/caddy/config
# SQLite muss fuer den Backend-Benutzer schreibbar bleiben. Nach Backups/Rollbacks
# koennen kamera_server.db, -wal oder -shm sonst root gehoeren und das Backend startet
# mit "attempt to write a readonly database" nicht mehr durch.
if [ "$(id -u)" = "0" ]; then
  chown -R "${HOST_UID}:${HOST_GID}" data 2>/dev/null || true
fi
chmod 750 data data/recordings data/external-recordings 2>/dev/null || true
chmod 775 data/live data/snapshots 2>/dev/null || true
chmod 775 data/backups data/updates data/updates/packages data/updates/staging data/updates/backups data/updates/docker-cli data/updates/docker-cli/home data/updates/docker-cli/config data/updates/docker-cli/buildx 2>/dev/null || true
chmod 660 data/kamera_server.db data/kamera_server.db-wal data/kamera_server.db-shm 2>/dev/null || true

# GPU-Telemetrie darf den normalen Start niemals blockieren.
# Die NVIDIA-Compose-Erweiterung wird nur noch durch ENABLE_NVIDIA_GPU_COMPOSE=true aktiviert.
# Alte Installationen koennen ENABLE_NVIDIA_GPU_STATUS=true enthalten; das schaltet nur die Metriklogik,
# aber keine NVIDIA-Laufzeitbindung mehr ein.
if grep -Eqi '^ENABLE_NVIDIA_GPU_STATUS=(1|true|yes|on)[[:space:]]*$' .env 2>/dev/null \
  && ! grep -Eqi '^ENABLE_NVIDIA_GPU_COMPOSE=(1|true|yes|on)[[:space:]]*$' .env 2>/dev/null; then
  printf '%s\n' 'Hinweis: NVIDIA-Systemstatus ist gesetzt, aber die GPU-Containerbindung bleibt deaktiviert.'
  printf '%s\n' 'Setze ENABLE_NVIDIA_GPU_COMPOSE=true nur, wenn NVIDIA Container Toolkit sauber funktioniert.'
fi


env_value() {
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); gsub(/^"|"$/, ""); print; exit }' .env 2>/dev/null || true
}
is_true() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in 1|true|yes|on) return 0;; *) return 1;; esac
}
docker_image_exists() {
  image="$1"
  if docker image inspect "$image" >/dev/null 2>&1; then return 0; fi
  if command -v sudo >/dev/null 2>&1 && sudo docker image inspect "$image" >/dev/null 2>&1; then return 0; fi
  return 1
}

FORCE_PULL_VALUE="$(env_value FORCE_IMAGE_PULL)"
UPDATER_OPTIONAL_VALUE="$(env_value UPDATER_OPTIONAL)"

printf '%s\n' 'Docker-Kompatibilitätsmodus: Compose v1/v2, Docker 20 bis aktuelle Versionen.'
# Reclaim stale update build cache before creating new images. This is safe for
# application data: no volumes, containers or tagged images are removed.
sh ./scripts/docker-cache-cleanup.sh pre-build || true
# The cleanup above can change free space by several GiB. Refresh the fallback
# snapshot before containers are created; the System Status itself uses live
# statfs values whenever the bind mount is readable.
refresh_host_disk_snapshot
if is_true "$FORCE_PULL_VALUE"; then
  printf '%s\n' 'FORCE_IMAGE_PULL=true: Basis-Images werden ausdrücklich neu geladen.'
  sh ./scripts/docker-compose.sh build --pull backend frontend
else
  printf '%s\n' 'Vorhandene Basis-Images werden bevorzugt; kein erzwungener Registry-Pull.'
  if ! sh ./scripts/docker-compose.sh build backend frontend; then
    printf '%s\n' 'Backend-/Frontend-Build fehlgeschlagen.' >&2
    if docker_image_exists tmp-camera-surveillance-next-backend:latest \
      && docker_image_exists tmp-camera-surveillance-next-frontend:latest; then
      printf '%s\n' 'Vorhandene Anwendungs-Images werden als sicherer Kompatibilitätsfallback weiterverwendet.' >&2
    else
      printf '%s\n' 'Bei x509-Fehlern ist die Zertifikatskette des Docker-Daemons/DSM veraltet und mindestens ein benötigtes Basis-Image fehlt.' >&2
      printf '%s\n' 'Nutze scripts/prepare-offline-images.sh auf einem anderen Docker-System und importiere das TAR mit scripts/load-offline-images.sh.' >&2
      exit 1
    fi
  fi
fi

UPDATER_READY=true
if is_true "$FORCE_PULL_VALUE"; then
  sh ./scripts/docker-compose.sh build --pull updater || UPDATER_READY=false
else
  sh ./scripts/docker-compose.sh build updater || UPDATER_READY=false
fi
if [ "$UPDATER_READY" = false ] && docker_image_exists tmp-camera-surveillance-next-updater:latest; then
  printf '%s\n' 'Updater-Build fehlgeschlagen; ein vorhandenes Updater-Image wird weiterverwendet.' >&2
  UPDATER_READY=true
fi

if [ "$UPDATER_READY" = true ]; then
  # The updater owns the Docker runtime diagnostics API. Always recreate it
  # after a successful build so a freshly installed backend never talks to an
  # older updater image that lacks the current internal endpoints.
  sh ./scripts/docker-compose.sh up -d --no-deps --force-recreate updater
  sh ./scripts/docker-compose.sh up -d backend mediamtx frontend
else
  printf '%s\n' 'Warnung: Der optionale Updater konnte nicht gebaut werden. Kamera, Livebild, PTZ und Recording werden trotzdem gestartet.' >&2
  if ! is_true "$UPDATER_OPTIONAL_VALUE"; then
    printf '%s\n' 'UPDATER_OPTIONAL=false: Start wird wegen des fehlenden Updaters abgebrochen.' >&2
    exit 1
  fi
  sh ./scripts/docker-compose.sh up -d backend mediamtx frontend
fi
HTTP_PORT_VALUE=$(awk -F= '$1 == "HTTP_PORT" {print $2}' .env | tail -n1)
[ -n "$HTTP_PORT_VALUE" ] || HTTP_PORT_VALUE=8080
printf '\nTMP Camera Surveillance ist unter http://localhost:%s erreichbar.\n' "$HTTP_PORT_VALUE"
printf 'Im LAN: http://MAC-IP:%s\n' "$HTTP_PORT_VALUE"
MANUAL_SCAN_RANGES=$(awk -F= '$1 == "HOST_SCAN_RANGES" {sub(/^[^=]*=/, ""); print}' .env | tail -n1)
printf 'Automatisch erkannte Kamera-Netze: %s\n' "${HOST_SCAN_RANGES_VALUE:-keine Host-/VPN-Route erkannt}"
printf 'Manuell konfigurierte Kamera-Netze: %s\n' "${MANUAL_SCAN_RANGES:-keine}"
printf 'Updates: Administration -> Update-Center\n'
printf 'Optionales HTTPS: ./scripts/docker-compose.sh --profile https up -d\n\n'
sh ./scripts/docker-cache-cleanup.sh post-start || true
sh ./scripts/docker-compose.sh ps
