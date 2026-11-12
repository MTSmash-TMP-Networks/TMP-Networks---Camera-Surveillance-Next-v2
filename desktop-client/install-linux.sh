#!/usr/bin/env sh
set -eu
# Installs a per-user desktop client. No root, no Docker, no system changes.
BASE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/tmp-camera-desktop"
APPLICATIONS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
BIN="${HOME}/.local/bin"
if ! command -v npm >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  echo 'Node.js und npm werden auf dem Desktop-Rechner benoetigt (Node.js 20+ empfohlen).' >&2
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then echo 'Node.js 20 oder neuer wird benoetigt.' >&2; exit 1; fi
mkdir -p "$DEST" "$APPLICATIONS" "$BIN"
for file in package.json main.cjs preload.cjs setup.html setup.js; do cp "$BASE/$file" "$DEST/$file"; done
cd "$DEST"
npm install --omit=dev --no-audit --no-fund
cat > "$BIN/tmp-camera-desktop" <<EOF
#!/usr/bin/env sh
cd "$DEST"
exec "$DEST/node_modules/.bin/electron" "$DEST" "\$@"
EOF
chmod 755 "$BIN/tmp-camera-desktop"
cat > "$APPLICATIONS/tmp-camera-desktop.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=TMP Camera Desktop
Comment=TMP Camera Surveillance Client
Exec=$BIN/tmp-camera-desktop
Terminal=false
Categories=Network;Video;Security;
StartupNotify=true
EOF
chmod 644 "$APPLICATIONS/tmp-camera-desktop.desktop"
printf '\nInstallation abgeschlossen. Starte TMP Camera Desktop ueber das Anwendungsmenue oder %s\n' "$BIN/tmp-camera-desktop"
