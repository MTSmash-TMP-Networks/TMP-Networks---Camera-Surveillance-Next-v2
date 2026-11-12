# TMP Camera Surveillance Next - Installation Guide

This guide covers a new installation of TMP Camera Surveillance Next 2.20.41 and the most common maintenance tasks.

## 1. Requirements

You need:

- Docker Engine with Docker Compose v2, or a compatible `docker-compose` v1 installation. **If Docker is fully missing on a supported Linux/systemd host, the startup script can install Docker Engine and Compose automatically.**
- A Linux host, a Docker-capable NAS, macOS with Docker Desktop, or Windows with Docker Desktop and WSL2
- Local disk space for the application database and recording spool; optional SMB/CIFS or SFTP storage can be configured directly in the web interface
- Network connectivity from the Docker host to the cameras
- A modern web browser

Default network ports used by the package:

- TCP `8080` - web interface
- TCP/UDP `8189` - WebRTC/ICE media transport when used
- TCP `8443` - optional HTTPS profile

The host must also be able to reach the camera ports required by the devices, typically ONVIF/HTTP(S) and RTSP.

## 2. Extract the package

Extract the complete ZIP into a permanent local application directory. Do not run the application directly from inside the ZIP file.

Example on Linux:

```bash
mkdir -p /opt/tmp-camera
unzip TMP_Networks_Camera_Surveillance_Next_v2.20.34.zip -d /opt/tmp-camera
cd /opt/tmp-camera/TMP_Networks_Camera_Surveillance_Next_v2.20.34
```

If the archive tool removed executable permissions, restore them with:

```bash
chmod +x start.sh stop.sh update.sh logs.sh scripts/*.sh
```

You can also run the launcher through `sh` if required:

```bash
sh ./start.sh
```

## 3. First start

From the application directory run:

```bash
./start.sh
```

If Docker requires root privileges:

```bash
sudo ./start.sh
```

The startup script first checks Docker Engine and Docker Compose. If both are missing on Ubuntu, Debian, Linux Mint (Ubuntu base) or Fedora with systemd, it installs the official Docker packages using the distribution package manager, then starts and enables Docker. This requires administrator rights and access to `download.docker.com`. Existing Docker packages are **never** removed or overwritten automatically.

Disable automatic host installation with `DOCKER_AUTO_INSTALL=0 ./start.sh`. To only check prerequisites, run `sh scripts/install-docker.sh --check`; to prepare Docker separately, run `sh scripts/install-docker.sh --ensure`. A supported host without Docker can then use `./start.sh` directly (sudo may request a password).

The startup script automatically:

1. creates `.env` on the first start,
2. generates secure application secrets,
3. stores the current host user/group IDs as `PUID` and `PGID`,
4. creates the persistent `data/` directories,
5. detects suitable local camera scan ranges,
6. builds the backend, frontend and updater images,
7. starts the backend, TMP-Encoder media service, frontend and updater.

At the end of the process the script prints the application URL. The default is:

```text
http://SERVER-IP:8080
```

The generated administrator credentials are also stored in `.env`. Protect this file and do not publish it.

## 4. Verify the installation

Check the containers:

```bash
./scripts/docker-compose.sh ps
```

On systems where Docker requires elevated privileges:

```bash
sudo ./scripts/docker-compose.sh ps
```

The frontend and backend should remain running. The backend should not be in a restart loop.

Run the built-in diagnostic report:

```bash
sudo ./scripts/diagnose.sh
```

Test the public frontend health endpoint:

```bash
curl -fsS http://127.0.0.1:8080/healthz
```

Test backend routing through the frontend proxy:

```bash
curl -i http://127.0.0.1:8080/api/auth/runtime
```

A `502 Bad Gateway` means the frontend proxy cannot reach the backend. In that case inspect:

```bash
sudo ./scripts/docker-compose.sh logs --tail=200 backend
```

### Docker installation policy and failure recovery

- **Ubuntu, Debian, Linux Mint (Ubuntu-based), Fedora:** supported for automatic Docker installation when no Docker CLI exists and systemd is available. Package install is non-interactive except for local sudo authentication.
- **Synology/QNAP/other NAS:** the launcher deliberately does **not** install host packages. Use Docker or Container Manager provided by the device vendor.
- **macOS/Windows:** install and start Docker Desktop. The Linux bootstrap does not run on these platforms.
- **Docker installed but Compose missing or daemon inaccessible:** the installer stops with diagnostics instead of changing an existing installation. Check `docker info`, `docker compose version`, service status and socket permissions.
- **Conflicting distro Docker/Podman packages:** no automatic package removal. Resolve manually before opting into the official Docker repo.
- **Security:** adding a user to the `docker` group is deliberately not done because it grants root-equivalent privileges. Use `sudo ./start.sh` if needed.
- **Proxy/air gap:** installation needs access to the distro mirrors and `download.docker.com`. On offline networks install Docker and supply the application images beforehand.
- **Rootless Docker:** not automatically configured or reconfigured.

Official platform instructions: https://docs.docker.com/engine/install/

## 5. Synology NAS installation

The package can run on Synology DSM systems that provide Docker or Container Manager and Docker Compose compatibility.

Recommended procedure:

1. Install Docker or Container Manager from DSM.
2. Enable SSH temporarily in DSM if you want to perform the installation from a shell.
3. Create a permanent shared-folder location, for example:

```text
/volume1/docker/tmp-camera
```

or another local volume with sufficient recording space.

4. Extract the full package into that directory.
5. Connect through SSH and change into the extracted application folder.
6. Start the package with:

```bash
sudo ./start.sh
```

Using `sudo` is recommended when the DSM account does not have direct access to the Docker socket. The launcher preserves the original invoking user's UID/GID through `SUDO_UID` and `SUDO_GID`, so persistent application files can still be assigned to the correct DSM user.

Do not manually bind application source files into `/app` inside the backend container. The shipped image contains the application code and normalizes its read permissions during the Docker build for NAS compatibility.

If DSM ACLs or restored backups cause data permission problems, run `sudo ./start.sh` again. The launcher repairs ownership and expected permissions for the persistent `data/` tree.

### Synology reverse proxy

If the application should be available through a DSM reverse proxy or a public hostname, proxy the external HTTPS host to:

```text
http://127.0.0.1:8080
```

Preserve the original host and forwarding headers. If the DSM reverse-proxy interface provides a WebSocket option, enable it.

The application should still be tested directly on port `8080` before troubleshooting an external reverse proxy.

## 6. Recording storage and network devices

By default, recordings are stored locally below `data/recordings`. Administrators can configure a remote archive directly from the web interface:

```text
Recordings -> Storage
```

The application supports two direct network-storage protocols in this release:

- **SMB / CIFS** - suitable for NAS shares and Windows-compatible file servers
- **SFTP / SSH** - suitable for Linux, Unix and NAS servers that provide an SFTP service

No SMB/SFTP mount is required on the Docker host. TMP Camera Surveillance connects to the network device itself.

### Local storage

Select **Local storage** to keep finalized recording blocks in the application's persistent `data/recordings` directory. This is the default configuration.

### SMB / CIFS

Select **Network storage** and choose **SMB / CIFS**. Enter:

- **Server / IP address** - for example `192.168.1.20` or `nas.example.lan`
- **Port** - normally `445`
- **SMB share** - the DSM shared-folder name only, for example `recordings` or `surveillance`; do not enter `/volume1/recordings` here
- **Destination folder** - an optional folder inside that SMB share, for example `TMP-Camera`
- **Username / password** - credentials that can create, read and delete files in the destination
- **Domain / workgroup** - optional; use it only when required by the SMB server

The current version also accepts common locations copied directly from another system. When pasted into the server or SMB-share field, these are split automatically into server, port, share and destination folder:

```text
smb://192.168.1.20/recordings/TMP-Camera
\\diskstation\recordings\TMP-Camera
//diskstation/recordings/TMP-Camera
192.168.1.20:445
```

For Synology DSM, **SMB share** is the name shown under **Control Panel -> Shared Folder**, not the physical Linux path such as `/volume1/...`. The backend first attempts SMB3 and automatically retries with SMB2 when protocol negotiation fails. SMB1 is not enabled. Local NAS username/password sessions are made without Kerberos, and resolved IPv4 addresses are passed directly to `smbclient` to avoid unnecessary NetBIOS name-resolution ambiguity.

### SFTP / SSH

Select **Network storage** and choose **SFTP / SSH**. Enter:

- **Server / IP address**
- **Port** - normally `22`
- **Destination folder** - for example `/srv/video/TMP-Camera` or `video/TMP-Camera`
- **Username / password**
- **SSH host-key policy**

`Accept new keys on first connection` stores the server host key in the persistent application data directory. After the first successful connection you can switch to **strict** host-key verification if desired. A changed server host key is then rejected instead of silently accepted.

### Test and activate a network target

1. Open **Recordings -> Storage** as an administrator.
2. Select **Network storage** and choose SMB/CIFS or SFTP/SSH.
3. Enter the server, destination and credentials.
4. Click **Test connection**.
5. For SMB, the backend first verifies that the selected share can be opened, then creates a small probe file, reads it back, verifies its contents and removes it again.
6. If the test fails, the interface distinguishes name resolution, TCP port, authentication, missing SMB share, permissions and SMB protocol negotiation instead of showing one generic port/path warning.
7. Click **Save storage target** after the test succeeds.

Passwords are encrypted server-side with the installation credential key and stored in the local SQLite database. They are never included in the Storage API response.

### How network recording works

The active FFmpeg writer deliberately keeps the current block in the local recording spool. A finalized block is first queued for the same background compression pipeline used by local recordings. Each finalized block is eligible for compression immediately, even while the same or another camera continues recording. The active `.partial` block is never touched. The network-storage worker waits until compression has completed, has intentionally been skipped (for example because the block is already efficient or below the configured minimum size), is disabled, or has exhausted its configured retry attempts. Only then is the finalized block transferred to the selected SMB or SFTP target.

This order prevents direct network storage from bypassing recording compression while still protecting the active writer from short network interruptions and remote filesystem semantics. Background compression uses one low-priority worker thread and a constrained H.264 CRF profile with a default 2500 kbit/s video ceiling (`RECORDING_COMPRESSION_MAX_VIDEO_BITRATE_KBPS`) so high-bitrate camera streams cannot remain unnecessarily large in the archive. The original local spool copy remains available until the remote upload has been verified.

After a verified upload:

- the block is marked as remotely stored in the database;
- the local spool copy is removed;
- playback, download and evidence export retrieve the block from the network target when needed;
- retrieved blocks use a bounded local cache (`NETWORK_RECORDING_CACHE_MAX_BYTES`, default 2 GiB).

If the NAS or SFTP server is temporarily unavailable, the finalized block remains in the local spool and is marked for retry. The network-storage worker retries automatically. This prevents a short NAS outage from immediately discarding the recording block.

Important behavior:

- The SQLite database always remains local in `data/kamera_server.db`.
- Changing the storage target affects newly finalized blocks; existing remote blocks keep the storage profile that was used when they were uploaded.
- Old storage profiles are retained internally so recordings can still be played and exported after the active target changes.
- Deleting or expiring a recording also removes its corresponding remote block. If the remote server cannot be reached during retention cleanup, the database entry is kept and cleanup is retried later.
- Network credentials should be created specifically for the recording destination and should have only the permissions required to create, read and delete recording files.
- SFTP password authentication is supported in this release.
- SMB/CIFS and SFTP/SSH are the direct network protocols included in this release. NFS still requires a host mount and is not configured through this page.

## 7. Linux installation notes

For a normal Linux Docker host:

```bash
cd /path/to/TMP_Networks_Camera_Surveillance_Next_v2.20.34
./start.sh
```

Use `sudo ./start.sh` if the current account cannot access Docker.

Keep the project and `data/` directory on a local filesystem. For reliable SQLite operation and continuous recordings, avoid placing the active database on an unstable SMB/NFS mount.

## 8. macOS installation notes

Install and start Docker Desktop first. Extract the package to a local folder that Docker Desktop is allowed to access, then run:

```bash
./start.sh
```

Do not use `sudo` with Docker Desktop unless your local Docker setup specifically requires it.

If macOS removed executable permissions during extraction, use:

```bash
sh ./start.sh
```

For best reliability, keep the active database on a local filesystem. Remote recording archives can be configured directly with SMB/CIFS or SFTP/SSH as described in the Recording storage section.

## 9. Windows installation notes

Use Docker Desktop with WSL2. Extract the package to a local disk and run the Linux shell scripts from WSL2.

For best performance and file-permission behavior, keep the project and database inside the WSL2 filesystem or another Docker-supported local path. External recording storage can use a direct SMB/CIFS or SFTP/SSH target as described above.

## 10. Change the web port

After the first start, edit `.env` and change:

```text
HTTP_PORT=8080
```

For example:

```text
HTTP_PORT=8090
```

Then recreate the frontend container:

```bash
./scripts/docker-compose.sh up -d --force-recreate frontend
```

## 11. Camera network ranges

The launcher automatically records detected host networks in `.env`. You can add permanent camera networks with:

```text
HOST_SCAN_RANGES=192.168.1.0/24,10.20.0.0/16
```

Only add networks that are routable from the Docker host. Camera discovery cannot find devices on unreachable networks.

## 12. Optional HTTPS profile

The package contains an optional HTTPS Compose profile. Start it with:

```bash
./scripts/docker-compose.sh --profile https up -d
```

For Internet-facing installations, using an existing trusted reverse proxy in front of the application is usually preferable.

## 13. Stop and start

Stop the application:

```bash
./stop.sh
```

Start it again:

```bash
./start.sh
```

View logs:

```bash
./logs.sh
```

## 14. Backups

Create a backup with:

```bash
./scripts/backup.sh
```

Back up at least:

```text
.env
data/
```

Store a copy outside the Docker host. Recording archives can be large, so database/configuration backups and video retention can use separate policies.

## 15. Updates

Use the integrated Update Center for compatible official update ZIP files whenever possible.

For manual maintenance, never delete `.env` or `data/` unless you intentionally want to remove the installation state.

After changing Docker build files, rebuild the affected service without cache when necessary. Example:

```bash
./scripts/docker-compose.sh build --no-cache backend
./scripts/docker-compose.sh up -d --no-deps --force-recreate backend
```

Backend-to-updater control traffic uses a local Unix-domain HTTP socket at `/data/updates/tmp-camera-updater.sock` by default. Both services already share the persistent `data/` directory, so update health, installation, rollback and system-control requests do not depend on Docker DNS. The updater creates the socket with the configured `PUID:PGID`; Docker service discovery remains a compatibility fallback.

During an in-app update, the currently running updater agent is deliberately kept online. Backend, frontend and media services are updated and restarted, but the updater does not replace itself from inside its own transaction. This keeps the local IPC socket and internal service aliases stable through the complete update.

The update still builds and stages the updater image contained in the new release. Updater-agent changes are activated only during a normal host-side start or an explicit updater repair:

```bash
./scripts/repair-updater.sh
```

or by a normal:

```bash
./stop.sh
./start.sh
```

A normal application update does not require either command. They are only needed when you intentionally want to activate a newly staged updater-agent image.

For compatibility with 2.20.16, the package wrapper can receive the historical detached self-replacement call once during the 2.20.16 -> 2.20.19 upgrade. Version 2.20.19 records that call in `data/updates/updater-finalizer.log` and intentionally leaves the healthy updater untouched.

## 16. Troubleshooting

### Frontend opens but login returns 502

Check whether the backend is restarting:

```bash
sudo ./scripts/docker-compose.sh ps
sudo ./scripts/docker-compose.sh logs --tail=200 backend
```

The current build includes the NAS permission fix that makes `/app` readable for the configured runtime `PUID:PGID` while keeping the container filesystem read-only.

### Permission errors in `data/`

Run the launcher again with the required Docker privileges:

```bash
sudo ./start.sh
```

Then inspect:

```bash
ls -ld data data/recordings data/updates
```

### Camera is not discovered

Confirm that the Docker host can reach the camera IP and that the required camera ports are routed and not blocked by a firewall. Add the camera network to `HOST_SCAN_RANGES` if automatic detection does not include it.

### Browser can open the UI but video does not play

Check the TMP-Encoder service and backend logs:

```bash
sudo ./scripts/docker-compose.sh logs --tail=200 mediamtx backend
```

Also verify that TCP/UDP port `8189` is allowed when WebRTC is enabled.

## 17. Optional TMP Device Pack import

The application includes an optional local import helper under:

```text
tools/tmp-device-pack/
```

It does not download or redistribute third-party device packs. If an operator has a legally obtained compatible source package, it can be analyzed with:

```bash
./tools/tmp-device-pack/update_device_pack.sh /path/to/device-pack-or-directory [source-version]
```

The generated catalog is stored at:

```text
backend/src/data/tmp-device-pack-catalog.json
```

The main application does not require this optional tool.

## 18. Security recommendations

- Protect `.env` and never publish it.
- Use HTTPS for remote access.
- Restrict the application to trusted networks or a controlled reverse proxy.
- Use strong administrator and camera passwords.
- Keep Docker and the host operating system updated.
- Back up the database and configuration regularly.
- Review `docs/PRIVACY_AND_DATA_PROCESSING.md` before processing camera footage in production.

## 19. License and third-party notices

Read:

```text
LICENSE_AGREEMENT.md
docs/THIRD_PARTY_NOTICES.md
```

Third-party names are used only where required for compatibility, protocol, dependency or attribution information. No affiliation, sponsorship or certification is implied.

## Recording storage audit

If local disk usage does not match the visible recording archive, run:

```bash
sudo ./scripts/recording-storage-audit.sh
```

The audit reports local recording spool usage, network playback cache usage, stale temporary files and SQLite segment/compression states without deleting recordings. Version 2.20.22 automatically reconciles safe interrupted upload/compression states during backend startup.

The System Status page reads disk usage live from the data bind mount in 2.20.23. A Docker image/build-cache cleanup therefore appears immediately without requiring `start.sh` to rewrite host disk usage values.

## Automatic Docker cache maintenance

Repeated application updates rebuild Docker images. Version 2.20.22 automatically removes dangling images and unused Docker builder/buildx cache before and after update builds and during host-side startup. Application volumes, containers, tagged images and recording data are never pruned by this maintenance. Set `UPDATER_DOCKER_CACHE_CLEANUP=false` in `.env` to opt out. The maintenance log is `data/updates/docker-cleanup.log`.


## Desktop client (Linux workstation)

Open **Desktop-Client** from the authenticated application's sidebar and download the Linux x86_64 ZIP. Extract it on the workstation and run `sh ./install-linux.sh` **without sudo**. Missing Node.js 20+ or npm are automatically installed locally (Node.js 24 LTS, verified SHA-256); Electron is downloaded on first install. If Electron needs missing Linux libraries on Debian/Ubuntu/Linux Mint, the installer invokes apt-get with a one-time sudo password prompt. Internet is required for the first installation. The client uses the configured server address and the existing login. The recording server remains headless; no desktop packages need to be installed on it.

## GitHub direct updates

After upgrading to 2.20.41, open **Administration → Update-Center** and choose **Auf GitHub prüfen**, then **Herunterladen & prüfen**, then **Installieren**. GitHub's commit archive must contain exactly the files declared in `FILES.sha256`. The installer will reject any missing or additional files. DNS, TLS and access to `api.github.com`, `raw.githubusercontent.com` and `codeload.github.com` are required from inside the backend container.

For the initial repair from older releases, upload the full 2.20.41 ZIP through the existing ZIP upload option.


### Optional Intel VAAPI video acceleration

See README.md (Intel N97 / Intel iGPU). The opt-in workflow runs an isolated hardware encoding smoke test before setting `GO2RTC_FFMPEG_HARDWARE=vaapi` and `ENABLE_INTEL_GPU_COMPOSE=true`; a render-device-only Compose override is used instead of privileged containers. CPU fallback is built into the live-stream startup. The default remains software for NAS and non-Intel systems.


### Versionsuebergreifende Aktualisierung

Ab v2.20.32 kann auf v2.20.41 direkt via GitHub oder ZIP aktualisiert werden. Das Update-Center verifiziert SHA-256 und die Freigabe der Pfade; Backup und Rollback sind verpflichtend. Vor v2.20.32 einen getesteten Brueckenschritt einplanen. Siehe `docs/UPGRADE_COMPATIBILITY.md`.
