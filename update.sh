#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
sh ./scripts/backup.sh
exec sh ./start.sh
