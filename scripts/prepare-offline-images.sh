#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
TARGET_PLATFORM="${TARGET_PLATFORM:-${2:-}}"
platform_suffix="$(printf '%s' "${TARGET_PLATFORM:-native}" | tr '/:' '--')"
OUTPUT="${1:-tmp-camera-base-images-${platform_suffix}.tar}"
IMAGES="node:24.18.0-bookworm-slim nginx:1.29.8-alpine alexxit/go2rtc:1.9.13 caddy:2.11.4-alpine"
for image in $IMAGES; do
  printf 'Lade %s%s ...\n' "$image" "${TARGET_PLATFORM:+ fuer $TARGET_PLATFORM}"
  if [ -n "$TARGET_PLATFORM" ]; then
    docker pull --platform "$TARGET_PLATFORM" "$image"
  else
    docker pull "$image"
  fi
done
printf 'Erzeuge %s ...\n' "$OUTPUT"
docker save -o "$OUTPUT" $IMAGES
printf 'Basis-Images gespeichert: %s\n' "$OUTPUT"
