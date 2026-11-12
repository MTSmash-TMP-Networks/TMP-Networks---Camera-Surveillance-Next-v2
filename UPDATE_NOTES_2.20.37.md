# TMP Camera Surveillance Next 2.20.37 — Desktop client setup repair

## Linux Desktop Client

- `sh ./install-linux.sh` no longer fails when Node.js/npm are missing.
- If no suitable runtime is available, downloads Node.js 24 LTS with npm from nodejs.org over HTTPS into the **desktop user** application directory, checks the official SHA-256 manifest, and does not alter system Node installations.
- Installs the pinned Electron client with npm. Missing ELF shared libraries are checked and, on Debian/Ubuntu/Linux Mint, offered through apt-get with sudo (only if needed).
- Does not install Docker on the workstation, and must not be launched as root. Electron sandbox and TLS verification remain enabled.
- The **Desktop-Client** page now provides the revised download and setup instructions.

## Installation

On an installed server version 2.20.36, update through the existing ZIP Update-Center or verified GitHub update. Server camera settings and recordings remain preserved by the existing backup/rollback workflow. Then download the new ZIP under **Desktop-Client** on a Linux workstation and run `sh ./install-linux.sh` as the local user.
