#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 /path/to/device-pack-or-directory [source-version]" >&2
  echo "The source must be obtained and used by the operator in accordance with its license." >&2
  exit 2
fi

SOURCE=$1
SOURCE_VERSION=${2:-}
OUTPUT="$ROOT/backend/src/data/tmp-device-pack-catalog.json"

if [ -d "$SOURCE" ]; then
  INPUT_DIR=$SOURCE
  SOURCE_NAME=$(basename "$SOURCE")
elif [ -f "$SOURCE" ]; then
  SOURCE_NAME=$(basename "$SOURCE")
  SAFE_NAME=$(printf '%s' "$SOURCE_NAME" | tr -c 'A-Za-z0-9._-' '_')
  INPUT_DIR="$SCRIPT_DIR/work/$SAFE_NAME"
  mkdir -p "$SCRIPT_DIR/work"
  python3 "$SCRIPT_DIR/extract_device_pack.py" "$SOURCE" "$INPUT_DIR" --clean
else
  echo "Device-pack source not found: $SOURCE" >&2
  exit 2
fi

set -- "$SCRIPT_DIR/analyze_device_pack.py" "$INPUT_DIR" "$OUTPUT" --source-name "$SOURCE_NAME"
if [ -n "$SOURCE_VERSION" ]; then
  set -- "$@" --source-version "$SOURCE_VERSION"
fi
python3 "$@"

echo "TMP Device Pack catalog updated. Restart the backend to load the new catalog."
