#!/bin/sh
set -u

printf '%s\n' '=== Recording storage filesystem ==='
df -h ./data 2>/dev/null || df -h . 2>/dev/null || true
printf '\n%s\n' '=== Persistent data directories ==='
for dir in ./data/recordings ./data/network-recording-cache ./data/backups ./data/updates; do
  if [ -e "$dir" ]; then du -sh "$dir" 2>/dev/null || du -sk "$dir" 2>/dev/null || true; fi
done

printf '\n%s\n' '=== Largest persistent subdirectories (KiB) ==='
for dir in ./data/recordings ./data/network-recording-cache ./data/backups ./data/updates; do
  if [ -d "$dir" ]; then
    du -ak "$dir" 2>/dev/null | sort -n | tail -n 12 || true
  fi
done

printf '\n%s\n' '=== Recording transient files ==='
TMP_COUNT=$(find ./data/recordings -type f \( -name '*.compressing' -o -name '*.compression-backup' -o -name '*.partial' \) 2>/dev/null | wc -l | tr -d ' ')
printf 'transient file count: %s\n' "${TMP_COUNT:-0}"
find ./data/recordings -type f \( -name '*.compressing' -o -name '*.compression-backup' -o -name '*.partial' \) -exec ls -ln {} \; 2>/dev/null | head -n 40 || true

printf '\n%s\n' '=== Network cache partial files ==='
CACHE_PARTS=$(find ./data/network-recording-cache -type f -name '*.part' 2>/dev/null | wc -l | tr -d ' ')
printf 'cache .part count: %s\n' "${CACHE_PARTS:-0}"
find ./data/network-recording-cache -type f -name '*.part' -exec ls -ln {} \; 2>/dev/null | head -n 40 || true

if command -v sqlite3 >/dev/null 2>&1 && [ -f ./data/kamera_server.db ]; then
  printf '\n%s\n' '=== Recording segment storage states ==='
  sqlite3 ./data/kamera_server.db "SELECT COALESCE(storage_state,'local'),COUNT(*),COALESCE(SUM(size_bytes),0) FROM recording_segments GROUP BY COALESCE(storage_state,'local') ORDER BY 1;" 2>/dev/null || true
  printf '\n%s\n' '=== Compression job states ==='
  sqlite3 ./data/kamera_server.db "SELECT status,COUNT(*),COALESCE(SUM(saved_bytes),0) FROM recording_compression_jobs GROUP BY status ORDER BY status;" 2>/dev/null || true
fi

printf '\n%s\n' '=== Recording database / local spool reconciliation ==='
if [ -x ./scripts/docker-compose.sh ]; then
  ./scripts/docker-compose.sh exec -T backend node scripts/recording-storage-db-audit.js 2>/dev/null || printf '%s\n' 'Backend database audit is currently unavailable.'
fi
