#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
sh -n "$ROOT/scripts/install-docker.sh"
sh -n "$ROOT/start.sh"
grep -q 'scripts/install-docker.sh --ensure' "$ROOT/start.sh"
grep -q 'DOCKER_AUTO_INSTALL' "$ROOT/scripts/install-docker.sh"
grep -q 'docker-compose-plugin' "$ROOT/scripts/install-docker.sh"
grep -q 'systemctl enable --now docker' "$ROOT/scripts/install-docker.sh"
grep -q 'Konfliktpaket' "$ROOT/scripts/install-docker.sh"
if grep -Eq 'curl .*\|[[:space:]]*(sh|bash)|usermod .*docker|apt-get .*remove' "$ROOT/scripts/install-docker.sh"; then
  echo 'Unsafe Docker installer pattern' >&2
  exit 1
fi
printf 'Docker bootstrap static checks: OK\n'
