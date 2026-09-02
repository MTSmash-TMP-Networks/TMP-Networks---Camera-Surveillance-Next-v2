#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
COMPOSE="./scripts/docker-compose.sh"
HTTP_PORT_VALUE="${HTTP_PORT:-}"
if [ -z "$HTTP_PORT_VALUE" ] && [ -f .env ]; then
  HTTP_PORT_VALUE=$(awk -F= '$1 == "HTTP_PORT" {print $2}' .env | tail -n1 | tr -d '"')
fi
[ -n "$HTTP_PORT_VALUE" ] || HTTP_PORT_VALUE=8080

printf '%s\n' '=== Docker Compose ==='
$COMPOSE ps || true
printf '%s\n' '\n=== Frontend Health ==='
curl -fsS "http://127.0.0.1:${HTTP_PORT_VALUE}/healthz" 2>/dev/null || printf '%s\n' 'Frontend nicht erreichbar'
printf '%s\n' '\n=== Backend Health (im Docker-Netz) ==='
$COMPOSE exec -T backend curl -fsS http://127.0.0.1:3000/health 2>/dev/null || printf '%s\n' 'Backend nicht erreichbar'
printf '%s\n' '\n=== Updater IPC-Socket ==='
ls -l data/updates/tmp-camera-updater.sock 2>/dev/null || printf '%s\n' 'Lokaler Updater-IPC-Socket ist nicht vorhanden.'
printf '%s\n' '\n=== Updater IPC aus Sicht des Backends ==='
$COMPOSE exec -T backend node -e "const http=require('node:http');const s=process.env.UPDATER_SOCKET_PATH||'/data/updates/tmp-camera-updater.sock';const q=http.get({socketPath:s,path:'/health'},r=>{let b='';r.setEncoding('utf8');r.on('data',c=>b+=c);r.on('end',()=>{try{const p=JSON.parse(b);if(p.service==='tmp-camera-updater'){console.log('IPC OK - Updater '+(p.version||'unbekannt'));process.exit(0)}}catch{}process.exit(1)})});q.setTimeout(5000,()=>q.destroy());q.on('error',()=>process.exit(1));" 2>/dev/null || printf '%s\n' 'Backend kann den lokalen Updater-IPC-Kanal nicht erreichen.'
printf '%s\n' '\n=== Updater-Auflösung aus Sicht des Backends ==='
$COMPOSE exec -T backend node src/cli/updater-healthcheck.js 2>/dev/null || printf '%s\n' 'Updater konnte über keinen konfigurierten Endpunkt erreicht werden'
printf '%s\n' '\n=== Direkter Updater-Container-Healthcheck ==='
$COMPOSE exec -T updater node src/healthcheck.js 2>/dev/null && printf '%s\n' 'Updater-Container antwortet lokal.' || printf '%s\n' 'Updater-Container antwortet lokal nicht.'
printf '%s\n' '\n=== Update-Speicherrechte ==='
ls -ld data data/backups data/updates data/updates/backups data/updates/docker-cli data/updates/docker-cli/config data/updates/docker-cli/home 2>/dev/null || true
printf '%s\n' '\n=== Letzte Updater-Logs ==='
$COMPOSE logs --tail=160 updater || true
printf '%s\n' '\n=== Letzter Update-Finalizer ==='
if [ -f data/updates/updater-finalizer.log ]; then
  tail -n 120 data/updates/updater-finalizer.log 2>/dev/null || true
else
  printf '%s\n' 'Noch kein Update-Finalizer-Protokoll vorhanden.'
fi
printf '%s\n' '\n=== go2rtc Info (im Docker-Netz) ==='
$COMPOSE exec -T backend sh -c 'curl -fsS http://mediamtx:1984/api 2>/dev/null || curl -fsS http://mediamtx:1984/media/go2rtc/api' 2>/dev/null || printf '%s\n' 'go2rtc-API nicht erreichbar'
printf '%s\n' '\n=== Aktive go2rtc-Streams ==='
$COMPOSE exec -T backend sh -c 'curl -fsS http://mediamtx:1984/api/streams 2>/dev/null || curl -fsS http://mediamtx:1984/media/go2rtc/api/streams' 2>/dev/null || printf '%s\n' 'go2rtc-Streamliste nicht erreichbar'
printf '%s\n' '\n=== Letzte Backend-Logs ==='
$COMPOSE logs --tail=150 backend || true
printf '%s\n' '\n=== Letzte go2rtc-Logs ==='
$COMPOSE logs --tail=150 mediamtx || true
if [ -n "${CAMERA_ID:-}" ] && [ -n "${ACCESS_TOKEN:-}" ]; then
  printf '%s\n' '\n=== Kamera-Diagnoseprotokoll ==='
  curl -fsS -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    "http://127.0.0.1:${HTTP_PORT_VALUE}/api/cameras/${CAMERA_ID}/logs?limit=300" 2>/dev/null \
    || printf '%s\n' 'Kameraprotokoll konnte nicht geladen werden'
fi
printf '%s\n' '\nHinweis: Zugangsdaten, Tokens, interne Updater-Adressen und vollständige Medien-URIs werden in der Benutzeroberfläche nicht ausgegeben.'

printf '\n=== Recording Storage Audit ===\n'
if [ -x ./scripts/recording-storage-audit.sh ]; then
  ./scripts/recording-storage-audit.sh 2>/dev/null || true
fi
