# TMP Camera Surveillance Next 2.20.51

TMP Camera Surveillance Next is a self-hosted camera surveillance and recording platform designed for Docker environments. It supports ONVIF discovery, direct network streams, live view, PTZ, recording, motion events, notifications, user management, diagnostics and integrated updates.

## Quick start

1. Extract the complete ZIP into a permanent local directory.
2. Open a terminal in the extracted application directory.
3. Start the application:

```bash
./start.sh
```

On Linux or NAS systems where Docker requires administrative privileges, use:

```bash
sudo ./start.sh
```

4. Wait until the containers are built and started.
5. Open the URL printed by the startup script. The default address is:

```text
http://SERVER-IP:8080
```

On Ubuntu, Debian, Linux Mint and Fedora with systemd, the first start can also install Docker Engine and the Docker Compose plugin from Docker's official package repository when Docker is entirely missing. Existing Docker installations are not replaced. On NAS, macOS and Windows, install Docker via the platform vendor first. Set `DOCKER_AUTO_INSTALL=0` to disable host-level auto-installation.

The first start creates `.env`, generates secure application secrets, prepares persistent storage and builds the Docker services automatically.

For the complete setup procedure, NAS notes, reverse-proxy guidance, updates, backups and troubleshooting, read `INSTALLATION.md`.

## Updates across supported older versions

The complete GitHub source archive and the downloadable update ZIP use a stable root-directory layout supported since v2.20.32. A server at any tested release from v2.20.32 onward can validate the v2.20.41 package directly; it does not need to install every intermediate release. See `docs/UPGRADE_COMPATIBILITY.md` for the supported baseline, compatibility checks, data safety and recovery steps. Releases below v2.20.32 must use an individually verified intermediate bridge, not bypass the validation rules.

## Installation and GitHub updates

If the Update-Center reports an available GitHub version, choose **Auf GitHub prüfen → Herunterladen & prüfen → Installieren**. The version is installed through the same checksum-verified ZIP route with backup and rollback as a manual upload. Direct `git pull` inside a running installation is not required.

## Main features

- ONVIF camera discovery and authenticated capability detection
- Visible ONVIF and PTZ verification during camera setup
- Direct RTSP, RTSPS, HLS, MJPEG, HTTP(S), RTMP, RTMPS and SRT sources
- Central TMP-Encoder media pipeline
- Local HLS live and kiosk playback
- Saved multi-camera kiosk layouts with equal and asymmetric focus grids and per-tile camera assignment
- PTZ controls and presets
- Continuous, scheduled, manual and event recording
- Configurable local or direct SMB/CIFS or SFTP network recording storage
- Background recording compression before SMB/SFTP transfer, including active multi-camera recording sessions and a default 2500 kbit/s archive video ceiling
- Motion and event processing with per-camera selectable detection regions
- Recording archive and evidence export
- SMTP email notifications and event rules
- Optional AI event analysis with OpenAI or compatible vision endpoints
- User roles, audit events and public read-only demo mode
- System and container status dashboard
- Integrated update and rollback workflow
- Local Backend-to-Updater IPC channel that avoids a hard Docker-DNS dependency
- 24 interface languages with RTL support for Arabic

## Video-CPU-Optimierung (Intel N97 / go2rtc)

Version 2.20.40 nutzt fuer als H.264 erkannte Kamera-Profile zunaechst go2rtc `#video=copy` und prueft das erste HLS-Segment auf echten H.264-Codec. Erst wenn das fehlschlaegt, wird die Quelle ueber Intel VAAPI (falls aktiviert) oder Software neu kodiert. `GO2RTC_H264_COPY_FIRST=false` in `.env` deaktiviert nur diese Kopieroptimierung. Hardware-Beschleunigung und Kamera-Aufzeichnungen bleiben unabhaengig davon erhalten. Fallbacks anderer Kameras werden nicht global umgeschaltet.

## Desktop client for Linux workstations

Authenticated users can open **Desktop-Client** in the left navigation and download `TMP-Camera-Desktop-Linux-x64.zip`. It provides a dedicated Electron window connected to the existing Docker server, without opening Firefox or Chrome. After extracting on a Linux x86_64 workstation, run `sh ./install-linux.sh`. The installer automatically downloads and checksum-verifies a local Node.js 24 LTS runtime including npm if needed, then downloads Electron. The Electron postinstall hook is specifically approved for its pinned version and native runtime presence is verified. Missing Electron libraries on Debian/Ubuntu/Linux Mint can be installed with a sudo password prompt. Run the installer as the regular user (not with sudo). TLS certificate validation remains enabled. No extra server or Docker instance is installed. Source and install instructions are in `frontend/desktop-client/`.

## Frontend foundation

The administration shell uses the open-source CoreUI CSS framework 5.9.0 (MIT) as a documented layout and navigation foundation. TMP-specific surveillance views such as Live View, camera cards, PTZ, recordings, timeline and kiosk remain purpose-built components. CoreUI is imported before the TMP stylesheet so the product theme and surveillance workflows remain visually distinct. No CoreUI PRO assets are included. See `docs/UI_FOUNDATION.md` and `docs/THIRD_PARTY_NOTICES.md`.

## Persistent data

Do not delete these items during normal updates:

```text
.env
data/
```

They contain the installation identity, credentials, configuration, database, local recordings, update state and other persistent application data. Recording blocks transferred to network storage remain on the configured SMB/CIFS or SFTP target. Network-storage passwords are encrypted in the local database and are never returned to the browser.

## Documentation

- `INSTALLATION.md` - complete installation and maintenance guide
- `UPDATE_NOTES_2.20.43.md` - current release notes
- `docs/UI_FOUNDATION.md` - frontend shell architecture and CoreUI attribution
- `docs/COMPATIBILITY.md` - platform and browser compatibility
- `docs/NETWORK_STREAMS.md` - direct network-stream sources
- `docs/DEMO_MODE.md` - public read-only demo mode
- `docs/PRIVACY_AND_DATA_PROCESSING.md` - privacy and deployment notes
- `docs/THIRD_PARTY_NOTICES.md` - third-party licenses and notices
- `LICENSE_AGREEMENT.md` - software license notice

## License and trademarks

This distribution is governed by the license agreement supplied with the software. Third-party components remain subject to their own licenses.

Third-party product and company names may appear only where needed for factual compatibility, protocol, dependency or attribution purposes. Their trademarks belong to their respective owners. No affiliation, sponsorship or certification is implied.

## Support

Support is provided according to the applicable software license or a separate support agreement.

## Storage integrity

Network recording storage uses a verified local-spool workflow. A completed block is compressed locally, uploaded to SMB/SFTP, verified on the remote target, and only then removed from the local spool. Startup reconciliation repairs interrupted upload/cleanup states after container restarts or in-app updates. Use `./scripts/recording-storage-audit.sh` to inspect local spool, cache and pipeline state.

## Automatic Docker cache maintenance

Repeated application updates rebuild Docker images. Version 2.20.22 automatically removes dangling images and unused Docker builder/buildx cache before and after update builds and during host-side startup. Application volumes, containers, tagged images and recording data are never pruned by this maintenance. Set `UPDATER_DOCKER_CACHE_CLEANUP=false` in `.env` to opt out. The maintenance log is `data/updates/docker-cleanup.log`.

System Status storage capacity is read live from the mounted data filesystem in 2.20.23. The `SYSTEM_HOST_DISK_*` values written by `start.sh` are only a filesystem identity/fallback snapshot and are no longer used as live free/used values. This prevents stale disk percentages after Docker cleanup.

## Intel N97 / Intel iGPU hardware acceleration (opt-in)

Intel GPU discovery in the status page does not automatically mean FFmpeg is using Quick Sync/VAAPI. Live video is copied when possible and uses no GPU; go2rtc may otherwise normalize video using software encoding by default. For compatible Linux hosts with an Intel render node, 2.20.39 adds a safe, opt-in VAAPI route for go2rtc H.264 normalization.

1. After updating, run `sudo sh ./scripts/intel-vaapi.sh --check` on the **camera server**, not the desktop client. This uses the pinned go2rtc Docker image and tests actual H.264 VAAPI encoding without privileged mode; it does not alter the installation.
2. Only if that succeeds, run `sudo sh ./scripts/intel-vaapi.sh --enable`. It preserves `.env` permissions and configures only the render node. To apply the settings, run `sudo sh ./scripts/docker-compose.sh build updater`, then `sudo sh ./scripts/docker-compose.sh up -d --no-deps --force-recreate updater mediamtx backend`. This also activates the updated updater's Intel Compose support. It briefly interrupts active video streams; do so during a maintenance window. Existing recordings remain on disk.
3. The go2rtc normalized video path now requests `#hardware=vaapi`. If stream startup times out with VAAPI, the orchestrator retries using software encoding once. For removal, run `sudo sh ./scripts/intel-vaapi.sh --disable`, then recreate updater, mediamtx and backend.

Never enable VAAPI without the hardware test. The Intel iGPU shares system RAM, so dedicated VRAM figures are normally unavailable. GPU busy percentages are driver-dependent and 0% or unavailable do not prove whether hardware encoding is used. Archive compression remains software-based in this version.
