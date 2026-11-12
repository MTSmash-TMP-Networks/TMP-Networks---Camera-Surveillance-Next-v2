#!/usr/bin/env sh
# TMP Camera: safe Docker Engine / Compose bootstrap for supported Linux hosts.
set -eu

log() { printf '[Docker-Setup] %s\n' "$*"; }
fail() { printf '[Docker-Setup] FEHLER: %s\n' "$*" >&2; exit 1; }

MODE="${1:---ensure}"
case "$MODE" in --ensure|--check|--install) : ;; *) fail 'Nutzung: sh scripts/install-docker.sh [--ensure|--check|--install]' ;; esac

has_compose() {
  (command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1) ||
  (command -v docker-compose >/dev/null 2>&1 && docker-compose version >/dev/null 2>&1)
}
engine_access() {
  if [ "$(id -u)" = 0 ]; then docker info >/dev/null 2>&1; return; fi
  docker info >/dev/null 2>&1 && return 0
  if command -v sudo >/dev/null 2>&1; then sudo -n docker info >/dev/null 2>&1 && return 0; fi
  return 1
}

check_runtime() {
  if ! command -v docker >/dev/null 2>&1; then return 1; fi
  if ! has_compose; then
    log 'Docker ist vorhanden, aber Docker Compose fehlt.' >&2
    return 2
  fi
  if engine_access; then
    log 'Docker Engine und Compose sind betriebsbereit.'
    return 0
  fi
  log 'Docker ist vorhanden, aber der Daemon ist nicht erreichbar oder Berechtigungen fehlen.' >&2
  return 3
}

# No host-level installation on platforms that normally manage Docker themselves.
OS_ID=unknown
OS_LIKE=''
OS_CODENAME=''
OS_UBUNTU_CODENAME=''
if [ "$(uname -s)" = Linux ] && [ -r /etc/os-release ]; then
  # /etc/os-release is host-provided; do not eval arbitrary values.
  . /etc/os-release
  OS_ID="${ID:-unknown}"
  OS_LIKE="${ID_LIKE:-}"
  OS_CODENAME="${VERSION_CODENAME:-}"
  OS_UBUNTU_CODENAME="${UBUNTU_CODENAME:-}"
fi

if check_runtime; then exit 0; else status=$?; fi
if [ "$MODE" = --check ]; then
  fail 'Docker/Compose nicht bereit. Nutze sh scripts/install-docker.sh --ensure.'
fi
if [ "$status" -eq 2 ] || [ "$status" -eq 3 ]; then
  if [ "$status" -eq 3 ] && command -v systemctl >/dev/null 2>&1 && [ "$(uname -s)" = Linux ]; then
    log 'Versuche vorhandenen Docker-Dienst zu starten (keine Neuinstallation).'
    if [ "$(id -u)" = 0 ]; then systemctl start docker 2>/dev/null || true
    elif command -v sudo >/dev/null 2>&1; then sudo systemctl start docker 2>/dev/null || true; fi
    if check_runtime; then exit 0; fi
  fi
  fail 'Vorhandene Docker-Installation wird nicht überschrieben. Prüfe docker info, Docker-Dienst und Compose-Plugin; Anleitung: INSTALLATION.md.'
fi

[ "$(uname -s)" = Linux ] || fail 'Docker Desktop auf macOS/Windows manuell installieren und starten.'
case "$OS_ID" in
  ubuntu|debian|linuxmint|fedora) : ;;
  *) fail "System $OS_ID nicht für automatische Installation freigegeben (z.B. Synology/NAS). Docker dort über den Hersteller installieren." ;;
esac
[ "${DOCKER_AUTO_INSTALL:-1}" != 0 ] || fail 'Automatische Docker-Installation durch DOCKER_AUTO_INSTALL=0 deaktiviert.'
command -v systemctl >/dev/null 2>&1 || fail 'Kein systemd erkannt. Docker muss auf diesem Host manuell eingerichtet werden.'

# Privilege separation: require an explicit local sudo authentication when needed.
if [ "$(id -u)" = 0 ]; then
  as_root() { "$@"; }
else
  command -v sudo >/dev/null 2>&1 || fail 'sudo fehlt. Starte mit administrativen Rechten.'
  log 'Administratorrechte sind nur für Docker-Paketinstallation und Dienststart erforderlich.'
  sudo -v || fail 'sudo-Authentifizierung nicht möglich.'
  as_root() { sudo "$@"; }
fi

if [ "$OS_ID" = fedora ]; then
  command -v dnf >/dev/null 2>&1 || fail 'dnf fehlt.'
  if rpm -q docker docker-client docker-common docker-engine podman-docker >/dev/null 2>&1; then
    fail 'Konflikt mit vorhandenen Docker/Podman-Paketen. Kein automatisches Entfernen; bitte manuell prüfen.'
  fi
  log 'Installiere offizielle Docker-Pakete für Fedora.'
  as_root dnf -y install dnf-plugins-core ca-certificates curl
  as_root dnf config-manager addrepo --from-repofile https://download.docker.com/linux/fedora/docker-ce.repo
  as_root dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  command -v apt-get >/dev/null 2>&1 || fail 'apt-get fehlt.'
  command -v dpkg >/dev/null 2>&1 || fail 'dpkg fehlt.'
  for pkg in docker.io docker-compose docker-compose-v2 podman-docker containerd runc; do
    if dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install ok installed'; then
      fail "Konfliktpaket $pkg vorhanden. Es wird nichts automatisch deinstalliert. Bitte Anleitung beachten."
    fi
  done
  case "$OS_ID" in
    ubuntu) DOCKER_DISTRO=ubuntu; SUITE="$OS_CODENAME" ;;
    linuxmint) DOCKER_DISTRO=ubuntu; SUITE="$OS_UBUNTU_CODENAME" ;;
    debian) DOCKER_DISTRO=debian; SUITE="$OS_CODENAME" ;;
  esac
  case "$SUITE" in ''|*[!a-z0-9]*) fail 'Ubuntu/Debian-Basiscodename konnte nicht sicher erkannt werden.';; esac
  log "Installiere offizielle Docker-Pakete: $DOCKER_DISTRO/$SUITE."
  as_root apt-get update
  as_root apt-get install -y ca-certificates curl
  as_root install -m 0755 -d /etc/apt/keyrings
  # Download as a file, never execute a remote install script.
  as_root curl --proto '=https' --tlsv1.2 -fsSL "https://download.docker.com/linux/$DOCKER_DISTRO/gpg" -o /etc/apt/keyrings/docker.asc
  as_root chmod a+r /etc/apt/keyrings/docker.asc
  ARCH="$(dpkg --print-architecture)"
  case "$ARCH" in ''|*[!a-z0-9]*) fail 'Ungültige Paketarchitektur.' ;; esac
  TEMP_SOURCE="$(mktemp)"
  trap 'rm -f "$TEMP_SOURCE"' EXIT HUP INT TERM
  printf 'Types: deb\nURIs: https://download.docker.com/linux/%s\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' "$DOCKER_DISTRO" "$SUITE" "$ARCH" > "$TEMP_SOURCE"
  as_root install -m 0644 "$TEMP_SOURCE" /etc/apt/sources.list.d/docker.sources
  rm -f "$TEMP_SOURCE"
  trap - EXIT HUP INT TERM
  as_root apt-get update
  as_root apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

as_root systemctl enable --now docker
command -v docker >/dev/null 2>&1 || fail 'Docker CLI nach Installation nicht gefunden.'
has_compose || fail 'Docker Compose Plugin nach Installation nicht gefunden.'
as_root docker info >/dev/null 2>&1 || fail 'Docker-Daemon nach Installation nicht betriebsbereit.'
log 'Docker Engine und Compose erfolgreich eingerichtet.'
if [ "$(id -u)" != 0 ] && ! docker info >/dev/null 2>&1; then
  log 'Hinweis: Bei fehlenden Socket-Rechten start.sh mit sudo ausführen. Kein automatisches Hinzufügen zur docker-Gruppe (root-äquivalent).'
fi
