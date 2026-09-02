#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
sh ./scripts/docker-compose.sh logs -f --tail=250 "$@"
