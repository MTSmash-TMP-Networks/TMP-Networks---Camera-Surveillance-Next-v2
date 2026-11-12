#!/usr/bin/env sh
set -eu
umask 077

# Install TMP Camera Desktop for the current Linux user. Node.js and npm are
# bootstrapped into the user's application directory if they are unavailable.
# System packages are installed only if Electron actually needs libraries.

BASE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/tmp-camera-desktop"
APPLICATIONS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
BIN="${HOME}/.local/bin"
RUNTIME="$DEST/runtime/node"
NODE_RELEASE_URL="https://nodejs.org/dist/latest-v24.x"

say() { printf '[TMP Camera Desktop] %s\n' "$*"; }
fail() { printf '[TMP Camera Desktop] FEHLER: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = Linux ] || fail 'Dieses Installationsskript ist nur fuer Linux vorgesehen.'
[ "$(id -u)" -ne 0 ] || fail 'Nicht mit sudo starten! Der Desktop-Client wird im Benutzerkonto installiert.'
[ -n "${HOME:-}" ] || fail 'HOME ist nicht gesetzt.'
for file in package.json main.cjs preload.cjs setup.html setup.js; do
  [ -f "$BASE/$file" ] || fail "Client-Paket ist unvollstaendig: $file fehlt."
done

case "$(uname -m)" in
  x86_64|amd64) NODE_ARCH=x64 ;;
  aarch64|arm64) NODE_ARCH=arm64 ;;
  *) fail "Nicht unterstuetzte Architektur: $(uname -m) (Linux x64 oder arm64 erforderlich)." ;;
esac

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  command -v npm >/dev/null 2>&1 || return 1
  major=$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || printf '0')
  case "$major" in ''|*[!0-9]*) return 1 ;; esac
  [ "$major" -ge 20 ] || return 1
  npm --version >/dev/null 2>&1
}

fetch() {
  address=$1
  output=$2
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --show-error --silent --retry 3 --connect-timeout 15 --max-time 240 "$address" -o "$output"
  elif command -v wget >/dev/null 2>&1; then
    wget --https-only --tries=3 --timeout=60 -q -O "$output" "$address"
  else
    fail 'curl oder wget wird benoetigt, um Node.js herunterzuladen.'
  fi
}

install_local_node() {
  command -v tar >/dev/null 2>&1 || fail 'tar wird zum Entpacken von Node.js benoetigt.'
  command -v sha256sum >/dev/null 2>&1 || fail 'sha256sum wird zur sicheren Download-Pruefung benoetigt.'
  mkdir -p "$DEST/runtime"
  work=$(mktemp -d "$DEST/runtime/.node-download.XXXXXXXX") || fail 'Temporäres Installationsverzeichnis konnte nicht erstellt werden.'
  trap 'rm -rf "$work"' EXIT HUP INT TERM

  say 'Node.js 24 LTS und npm fehlen oder sind zu alt. Lade die offizielle Laufzeit herunter ...'
  fetch "$NODE_RELEASE_URL/SHASUMS256.txt" "$work/SHASUMS256.txt" || fail 'Node.js-Pruefsummen konnten nicht geladen werden. Internet/TLS pruefen.'
  entry=$(awk -v suffix="-linux-$NODE_ARCH.tar.gz" '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-linux-/ && substr($2, length($2)-length(suffix)+1) == suffix {print $1 " " $2; exit}' "$work/SHASUMS256.txt")
  [ -n "$entry" ] || fail "Kein offizielles Node.js-24-Archiv fuer $NODE_ARCH gefunden."
  sha=${entry%% *}
  archive=${entry#* }
  case "$sha" in *[!0-9a-f]*|'') fail 'Ungueltige Node.js-SHA-256-Pruefsumme.' ;; esac
  [ "${#sha}" -eq 64 ] || fail 'Ungueltige Node.js-SHA-256-Laenge.'
  case "$archive" in node-v24.*-linux-"$NODE_ARCH".tar.gz) : ;; *) fail 'Ungueltiger Node.js-Dateiname.' ;; esac
  fetch "$NODE_RELEASE_URL/$archive" "$work/$archive" || fail 'Node.js konnte nicht heruntergeladen werden.'
  (cd "$work" && printf '%s  %s\n' "$sha" "$archive" | sha256sum -c - >/dev/null) || fail 'Node.js-Download hat die SHA-256-Pruefung nicht bestanden.'

  mkdir -p "$work/extracted"
  tar -xzf "$work/$archive" -C "$work/extracted" --strip-components=1 || fail 'Node.js-Archiv konnte nicht entpackt werden.'
  [ -x "$work/extracted/bin/node" ] && [ -e "$work/extracted/bin/npm" ] || fail 'Node.js-Paket ist unvollstaendig.'
  if [ -d "$RUNTIME" ]; then mv "$RUNTIME" "$work/previous-node"; fi
  mv "$work/extracted" "$RUNTIME"
  export PATH="$RUNTIME/bin:$PATH"
  node_ok || fail 'Node.js wurde entpackt, ist aber nicht lauffaehig (glibc/Architektur pruefen).'
  say "Node.js $(node --version) und npm $(npm --version) lokal installiert (ohne sudo)."
  rm -rf "$work"
  trap - EXIT HUP INT TERM
}

# A previously downloaded runtime is always preferred, because desktop launch
# scripts must not break when a distribution's Node installation changes.
if [ -x "$RUNTIME/bin/node" ] && [ -e "$RUNTIME/bin/npm" ]; then
  PATH="$RUNTIME/bin:$PATH"
  export PATH
fi
if [ "${TMP_CAMERA_FORCE_BUNDLED_NODE:-0}" = 1 ] || ! node_ok; then
  install_local_node
else
  say "Vorhandene Laufzeit gefunden: Node.js $(node --version), npm $(npm --version)."
fi

mkdir -p "$DEST" "$APPLICATIONS" "$BIN"
for file in package.json main.cjs preload.cjs setup.html setup.js; do cp "$BASE/$file" "$DEST/$file"; done
cd "$DEST"
say 'Installiere den Electron-Client ...'
# Electron downloads its pinned native runtime through its npm install hook.
# Do not suppress install scripts, and do not install it globally.
npm install --omit=dev --no-audit --no-fund || fail 'Electron konnte nicht installiert werden. Internetzugang und npm-Protokoll pruefen.'
ELECTRON="$DEST/node_modules/electron/dist/electron"
[ -x "$ELECTRON" ] || fail 'Electron-Programm fehlt nach npm install.'

missing_libraries() {
  command -v ldd >/dev/null 2>&1 || return 0
  ldd "$ELECTRON" 2>/dev/null | awk '/not found/ {print $1}' | sort -u
}

package_for_library() {
  case "$1" in
    libnss3.so) printf '%s' libnss3 ;;
    libgtk-3.so.0) printf '%s' libgtk-3-0 ;;
    libXss.so.1) printf '%s' libxss1 ;;
    libXtst.so.6) printf '%s' libxtst6 ;;
    libatk-bridge-2.0.so.0) printf '%s' libatk-bridge2.0-0 ;;
    libatspi.so.0) printf '%s' libatspi2.0-0 ;;
    libgbm.so.1) printf '%s' libgbm1 ;;
    libasound.so.2) printf '%s' libasound2 ;;
    libdrm.so.2) printf '%s' libdrm2 ;;
    libX11-xcb.so.1) printf '%s' libx11-xcb1 ;;
    libXcomposite.so.1) printf '%s' libxcomposite1 ;;
    libXdamage.so.1) printf '%s' libxdamage1 ;;
    libXfixes.so.3) printf '%s' libxfixes3 ;;
    libXrandr.so.2) printf '%s' libxrandr2 ;;
    libxkbcommon.so.0) printf '%s' libxkbcommon0 ;;
    libxshmfence.so.1) printf '%s' libxshmfence1 ;;
    libcups.so.2) printf '%s' libcups2 ;;
    *) printf '' ;;
  esac
}

check_electron_dependencies() {
  missing=$(missing_libraries)
  [ -n "$missing" ] || { say 'Electron-Systembibliotheken sind vorhanden.'; return 0; }
  say "Fehlende Electron-Bibliotheken: $(printf '%s' "$missing" | tr '\n' ' ')"
  if [ "${TMP_CAMERA_SKIP_SYSTEM_PACKAGES:-0}" = 1 ]; then
    fail 'Systempakete fehlen. TMP_CAMERA_SKIP_SYSTEM_PACKAGES deaktiviert die automatische Paketinstallation.'
  fi
  command -v apt-get >/dev/null 2>&1 || fail 'Automatische Systembibliotheken werden derzeit auf Debian/Ubuntu/Linux Mint unterstuetzt. Bitte die oben genannten Bibliotheken ueber die Paketverwaltung installieren.'
  command -v sudo >/dev/null 2>&1 || fail 'sudo fehlt. Bitte die erforderlichen Bibliotheken als Administrator installieren.'
  packages=''
  unknown=''
  for lib in $missing; do
    pkg=$(package_for_library "$lib")
    if [ -z "$pkg" ]; then unknown="$unknown $lib"; continue; fi
    case " $packages " in *" $pkg "*) : ;; *) packages="$packages $pkg" ;; esac
  done
  [ -z "$unknown" ] || fail "Unbekannte fehlende Bibliotheken:$unknown. Bitte zuerst per Linux-Paketverwaltung installieren."
  [ -n "$packages" ] || fail 'Keine automatisch installierbaren Bibliotheken erkannt.'
  # On Ubuntu 24.04+ several packages have t64 names. apt-cache identifies
  # available packages after refreshing metadata, without distro guesses.
  say 'Installiere fehlende Electron-Systembibliotheken einmalig mit sudo (Passwortabfrage moeglich) ...'
  sudo apt-get update || fail 'apt-get update fehlgeschlagen.'
  actual_packages=''
  for pkg in $packages; do
    if apt-cache show "$pkg" >/dev/null 2>&1; then
      actual_packages="$actual_packages $pkg"
    elif apt-cache show "${pkg}t64" >/dev/null 2>&1; then
      actual_packages="$actual_packages ${pkg}t64"
    else
      fail "Kein geeignetes Debian-Paket gefunden: $pkg"
    fi
  done
  # shellcheck disable=SC2086
  sudo apt-get install -y $actual_packages || fail 'Installation der Electron-Systembibliotheken ist fehlgeschlagen.'
  remaining=$(missing_libraries)
  [ -z "$remaining" ] || fail "Nach Paketinstallation fehlen weiterhin: $remaining"
}
check_electron_dependencies

# Wrapper with a stable PATH: it also works if Node.js was installed only in
# this app's runtime, or later removed from the host's package manager.
cat > "$BIN/tmp-camera-desktop" <<EOF_WRAPPER
#!/usr/bin/env sh
export PATH="$RUNTIME/bin:\$PATH"
cd "$DEST"
exec "$ELECTRON" "$DEST" "\$@"
EOF_WRAPPER
chmod 755 "$BIN/tmp-camera-desktop"
cat > "$APPLICATIONS/tmp-camera-desktop.desktop" <<EOF_DESKTOP
[Desktop Entry]
Type=Application
Name=TMP Camera Desktop
Comment=TMP Camera Surveillance Client
Exec=$BIN/tmp-camera-desktop
Terminal=false
Categories=Network;Video;Security;
StartupNotify=true
EOF_DESKTOP
chmod 644 "$APPLICATIONS/tmp-camera-desktop.desktop"
if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$APPLICATIONS" >/dev/null 2>&1 || true; fi
say 'Installation abgeschlossen. Server unveraendert; kein Docker oder Root fuer die App erforderlich.'
say "Starte TMP Camera Desktop ueber das Anwendungsmenue oder $BIN/tmp-camera-desktop"
