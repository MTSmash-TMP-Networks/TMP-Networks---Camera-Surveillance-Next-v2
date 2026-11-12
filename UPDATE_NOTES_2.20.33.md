# TMP Camera Surveillance Next 2.20.33

This release adds Docker Engine and Docker Compose installation to the first-start workflow on supported Ubuntu, Debian, Ubuntu-based Linux Mint and Fedora hosts using systemd. The installer uses Docker's official package repositories, checks service health, and returns to the regular application startup.

Safety: Existing Docker installations are not replaced; conflicting packages are not uninstalled; Synology/QNAP, macOS and Windows remain vendor-managed. No user is silently added to the root-equivalent Docker group. Set `DOCKER_AUTO_INSTALL=0` to opt out.

The application, recording data, credentials and updater recovery behavior from 2.20.32 are preserved.
