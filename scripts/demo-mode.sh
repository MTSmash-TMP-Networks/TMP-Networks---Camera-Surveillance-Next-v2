#!/usr/bin/env sh
set -eu
cat <<'MSG'
TMP Camera Surveillance v2.20.1 and newer manage Public Demo Mode directly in the web administration.

Open:
  Administration -> System status -> Public demo mode

The setting is stored in the system database. No DEMO_MODE or DEMO_MODE_ALLOW_EXPORTS .env setting is required or evaluated after the one-time upgrade migration.
MSG
