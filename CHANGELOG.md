## 2.20.37 - Linux Desktop Client dependency bootstrap

- Desktop installer fetches and SHA-256-verifies Node.js 24 LTS with bundled npm in the user directory when not present.
- Electron dependency preflight with apt-based repair for Debian, Ubuntu and Linux Mint.
- Updated web UI instructions, packaged download and offline/error regression checks.

## 2.20.36 - Camera setup and GitHub update fixes

- Camera input metadata handling and detailed field validation feedback.
- Align GitHub source archive with the signed file manifest and improve GitHub diagnostics.

## 2.20.35 – Linux Desktop Client

- Add downloadable Linux x86_64 Electron desktop client source installer in the authenticated interface.
- Add a dedicated Desktop-Client navigation screen and static client archive.
- Desktop client connects to existing surveillance servers; no extra Docker instance.
- Enforce origin restrictions, sandboxing, certificate validation and disabled Node integration.
- Keep ZIP and GitHub application update paths unchanged.

## 2.20.34 - Docker installation bootstrap (2026-11-12)

- Install Docker Engine and Compose plugin during first start on supported Ubuntu, Debian, Linux Mint and Fedora hosts when Docker is absent.
- Keep existing Docker runtimes and NAS/container managers untouched, with explicit failure diagnostics and a disable switch.
- Add automated regression tests for first-start behavior and unsupported systems.

# Changelog

## 2.20.32 - 2026-10-03

- Fixed the Update Center remaining permanently at 42% (or another intermediate value) when the updater process/container restarts during an update.
- Added startup recovery for interrupted validating, preflight, installing, building, cleanup and rollback phases.
- Interrupted jobs are now closed explicitly with a diagnostic error and preserved backup reference instead of being shown as still running.
- Added update-history evidence for interrupted transactions.
- Removed the one-shot 60-second stale-status window so fast updater restarts are recovered reliably.
- Preserved all v2.20.31 timeline playback behavior unchanged.

## 2.20.32 - 2026-09-03

- Added click-to-time playback on the 24-hour recording timeline so playback starts at the selected point instead of always at the beginning of the recording.
- Added automatic sequential playback through every later recording for the same camera until the final recording of the selected day finishes.
- Added gap-aware handoff: clicks inside condensed gaps start at the next available block and gaps between recordings are skipped automatically.
- Added block-to-media offset metadata to the recording timeline API for accurate seeking across block archives and discontinuities.
- Added a compact current/total sequence indicator to the recording player while continuous timeline playback is active.
- Preserved double-click evidence-export selection and unchanged single-recording playback from the detailed archive list.

## 2.20.30 - 2026-09-03

- Reworked the recording archive into a compact 24-hour timeline per camera instead of printing every interval as an additional text/chip list.
- Removed overlapping start-time labels from short recording segments so dense event-recording days remain readable.
- Kept every available recording interval directly clickable on the timeline; hover/focus still exposes the exact time range and block count.
- Preserved double-click transfer of a timeline range to the evidence export and added click/double-click disambiguation so playback does not open accidentally during export selection.
- Reduced the minimum visual width of very short recording ranges to avoid artificial overlap while keeping one- and two-minute recordings visible.
- Kept the existing block-based archive, recording data, storage pipeline, motion regions, kiosk layouts and updater compatibility unchanged.

## 2.20.29 - 2026-09-03

- Completed Kiosk Mode localization across all 24 supported UI languages, including the layout editor, saved views, grid templates, camera assignment, quality controls, fullscreen actions, status labels, empty states and accessibility text.
- Completed Update Center localization across all 24 supported UI languages, including loading/error states, updater diagnostics, package workflow, confirmations, progress phases, backups, history, security notices and technical action labels.
- Replaced German/English-only update-service fallbacks with native locale entries for every supported language.
- Localized update progress from stable technical phase codes so German backend status sentences no longer leak into non-German interfaces.
- Made Update Center date and number formatting follow the selected locale.
- Updated the kiosk layout smoke test to assert i18n integration rather than a hard-coded German label.
- Added regression checks for 24-locale key parity, interpolation placeholders and hard-coded German UI literals.
- Preserved per-camera motion regions from v2.20.28, the v2.20.27 sidebar collapse fix and existing updater/recording/storage behavior.

## 2.20.28 - 2026-09-03

- Added a per-camera motion detection region that can be drawn directly on a current camera snapshot.
- Motion zones are stored as normalized coordinates so the selection remains valid across snapshots, substreams and differing camera resolutions.
- The motion comparator now ignores pixels outside the selected region, including stabilization and brightness compensation calculations.
- Existing cameras continue to use the complete image until a motion region is explicitly enabled.
- Added automatic SQLite migration for the nullable `motion_zone` camera setting without requiring manual database changes.
- Motion comparison baselines are reset safely when a camera motion region is changed to avoid false events during reconfiguration.
- Added regression coverage for ROI filtering, camera persistence and the snapshot-based drag selector.
- Preserved the v2.20.27 sidebar collapse fix, updater workflow, recording/storage pipeline and kiosk layouts.

## 2.20.27 - 2026-09-03

- Fixed the complete application layout breaking after pressing the desktop sidebar collapse button.
- Removed the conflicting CoreUI `sidebar-narrow` class from the TMP shell collapse state.
- Synchronized the collapsed sidebar and application grid at a fixed 72 px width to prevent overlap and content displacement.
- Preserved compact icon navigation, persisted collapse state and the existing mobile navigation behavior.
- Added regression coverage for the collapse class and width contract.
- Kept updater, recordings/storage, Docker cleanup, system status and kiosk layouts unchanged.

## 2.20.26 - 2026-09-02

- Fixed the CoreUI sidebar clipping lower administration entries when the browser viewport is too short or zoomed.
- Made the primary sidebar navigation vertically scrollable while keeping the logo and user/logout area fixed.
- Restored reliable visibility and access to the existing administrator Update Center entry.
- Added a navigation regression test for `/system/update` and sidebar overflow behavior.
- Kept the stable updater, recording/storage pipeline, Docker cleanup, system metrics and kiosk layout manager unchanged.

## 2.20.25 - 2026-09-02

- Added a Surveillance Station style kiosk layout manager with multiple named, persistent monitor views.
- Added eight grid templates including equal grids and asymmetric focus layouts such as 1+4, 1+6 and 2+4.
- Added per-tile camera assignment, empty tiles, automatic assignment, duplicate/delete actions and one-click switching between saved kiosk views.
- Preserved the automatic camera-count layout as the default and kept fullscreen mode compatible with saved asymmetric layouts.
- Stored kiosk layout preferences in versioned browser local storage; no camera, recording or backend schema changes are required.
- Kept recording, SMB/SFTP storage, updater, Docker cleanup and live disk metrics behavior from 2.20.24 unchanged.

## 2.20.24 - 2026-09-02

- Introduced a documented CoreUI 5.9.0 (MIT) foundation for the application shell, navigation, header and footer.
- Kept Live View, camera cards, PTZ, recordings, timeline and kiosk as TMP-specific surveillance components rather than generic admin-template screens.
- Centralized navigation metadata in `frontend/src/config/navigation.js` to remove duplicated menu structure and keep role-aware routes consistent.
- Added a compact application context header while preserving the existing dark TMP camera theme and responsive sidebar behavior.
- Added transparent UI provenance and the complete CoreUI MIT license under `docs/UI_FOUNDATION.md` and `docs/third-party/CoreUI-MIT.txt`.
- Added CoreUI and its Popper peer dependency as pinned frontend dependencies; no CoreUI PRO assets are used.
- Kept the stable recording, updater, Docker cleanup and live storage metrics behavior from 2.20.23 unchanged.

## 2.20.23

- Fixed stale disk usage in System Status after Docker image/build-cache cleanup.
- Host filesystem used/free values are now read live from the data bind mount instead of frozen `SYSTEM_HOST_DISK_*` startup values.
- Host snapshot capacity is used only to identify whether the live bind mount belongs to the host filesystem.
- Filesystem percentage now follows `df` semantics by excluding reserved blocks from user-available capacity.
- `start.sh` refreshes the fallback host-disk snapshot immediately after pre-build Docker cache cleanup.
- Binary byte values in System Status are labelled correctly as KiB/MiB/GiB/TiB instead of KB/MB/GB/TB.


## 2.20.22

- Added automatic pruning of dangling Docker images produced by repeated application builds.
- Added automatic pruning of unused Docker builder/buildx cache before and after updates.
- Added the same safe maintenance to host-side startup and updater repair.
- No Docker volumes, containers, tagged base images or recording files are removed by this maintenance.
- Added `data/updates/docker-cleanup.log` for disk-cleanup diagnostics.

## 2.20.21 - 2026-09-02

- Reworked recording storage integrity across compression, SMB/SFTP upload, retention and restart recovery.
- Remote uploads now verify the final remote file before local spool cleanup, and SQLite is only marked `remote` after the local copy is actually removed.
- Added startup reconciliation for interrupted uploads, legacy duplicate local copies and stale network-cache `.part` files.
- Fixed retention minimum-free-space cleanup deleting remote-only archive rows even though this could not free local disk space.
- Recordings with queued/running compression or unfinished network transfer are protected from retention cleanup until the pipeline reaches a safe terminal state.
- Interrupted recording recovery now requeues recovered blocks for compression and direct SMB/SFTP storage.
- Added transient compression-file recovery/cleanup for `.compressing` and `.compression-backup` states after restarts.
- Added `scripts/recording-storage-audit.sh` and recording-storage details to `diagnose.sh`.
- Kept the stable updater-agent lifecycle unchanged.

## 2.20.20 - 2026-09-02

- Fixed background recording compression being globally paused whenever any recording was active.
- Finalized blocks from active recordings are now eligible for compression and subsequent SMB/SFTP transfer while the next block continues recording.
- Kept active `.partial` writer files isolated from the compression worker.
- Added constrained-CRF archive encoding with a default 2500 kbit/s H.264 video ceiling to prevent high-bitrate source streams from remaining oversized after archival.
- Added startup requeue for oversized local blocks previously marked `skipped` by the unconstrained compression policy.
- Updated regression coverage for continuous recording plus background compression/network transfer.
- Kept the stable updater-agent lifecycle unchanged.

## 2.20.19 - 2026-09-02

- Removed marketplace-specific edition branding and distribution references from the neutral release package.
- Fixed direct SMB/SFTP recording storage bypassing the background recording compression pipeline.
- Finalized recording blocks are now queued for compression before they become eligible for network transfer.
- Network uploads wait until compression is completed, intentionally skipped, disabled, or finally failed, preventing premature upload of oversized source blocks.
- Compression backfill now also covers local spool files already marked as pending or retrying for network storage.
- Network transfer waits for the parent recording to be finalized before removing the local spool copy.
- Reworked the recording archive so the long completed-recording list is collapsed by default and can be expanded as one section.
- Added a compact archive summary with recording count, total duration and total storage size.
- Kept the stable updater-agent lifecycle and SMB/Synology compatibility from 2.20.17/2.20.18 unchanged.

## 2.20.18 - 2026-09-02

- Fixed misleading SMB validation that could report a generic server/port/path error for valid NAS workflows.
- Added parsing of common SMB URLs, UNC paths and `host:port` copy/paste formats.
- Added Synology-oriented SMB3-to-SMB2 negotiation fallback while keeping SMB1 disabled.
- Added direct IPv4 targeting and disabled Kerberos for local NAS username/password sessions.
- Split SMB errors into hostname, port, authentication, share, permission, protocol and operation classes.
- Added share-level probing before the destructive write/read/delete storage test.
- Extended all 24 Recording Storage translations for the new diagnostics.
- Kept the stable updater-agent lifecycle from 2.20.17 unchanged.

## 2.20.17 - 2026-09-02

- Removed in-transaction updater self-replacement from the in-app update lifecycle.
- Kept the active updater container online after successful application updates so the local IPC socket and Docker-network aliases remain stable.
- Continued building/staging the new updater image, but activation now occurs only during a normal host-side `start.sh` or explicit `repair-updater.sh`.
- Added a compatibility guard to `scripts/docker-compose.sh` that safely ignores the detached self-replacement call emitted by a running 2.20.16 updater while installing 2.20.17.
- Added regression coverage proving that a 2.20.17 backend accepts a healthy 2.20.16 updater agent over IPC.
- Removed the automatic full Compose down/up finalizer that could leave the updater unreachable on both Debian and Synology after an otherwise successful update.

## 2.20.16 - 2026-09-02

- Replaced Docker DNS as the primary Backend-to-Updater control path with a local Unix-domain HTTP socket in the shared persistent data directory (`/data/updates/tmp-camera-updater.sock`).
- The updater creates the socket with the configured `PUID:PGID`, allowing the unprivileged backend process to use the same authenticated update API without a network lookup.
- Docker service discovery (`updater:3010` / `tmp-camera-updater:3010`) remains available only as a compatibility fallback.
- Update health, package installation, rollback and system-control requests now prefer the local IPC channel, removing persistent `UPDATER_DNS_ERROR` failures observed after in-app self-updates on Synology DSM.
- Post-update validation and `diagnose.sh` now test the IPC channel first and fall back to TCP only when required.
- The existing detached full Compose restart remains as a secondary recovery mechanism, but updater availability no longer depends on Docker DNS being rebuilt correctly.
- Added a dedicated IPC regression test and retained the updater finalizer log at `data/updates/updater-finalizer.log`.

## 2.20.15 - 2026-09-01

- Changed the detached post-update finalizer to perform a complete Docker Compose `down` / clean `up` cycle after updater self-replacement.
- Recreated the project network and Docker DNS aliases instead of relying only on individual service recreation, matching the manual `stop.sh` + `start.sh` recovery used on Synology DSM.
- Started services in dependency-safe order and restored optional HTTPS/Caddy automatically.
- Retried the full restart once and persisted finalizer diagnostics in `data/updates/updater-finalizer.log`.

## 2.20.14 - 2026-09-01

- Branded the public media/container service as `TMP-Encoder`.
- Added Synology/NAS-safe backend application-code permissions for custom runtime `PUID:PGID` values.
- Changed frontend logo delivery to Vite-managed assets for improved NAS/reverse-proxy compatibility.
- Renamed the optional internal device-pack integration to `TMP Device Pack`.
- Removed automatic third-party device-pack downloads from the distribution package; optional imports now require a locally supplied source archive.
- Removed historical release-note files from the buyer package and added one complete English installation guide.
- Completed the Add Camera localization for all 24 supported UI languages and removed mixed German/English interface text.
- Switched automatic camera placeholders to language-neutral `CAM-*` names while preserving legacy `Kamera-*` numbering compatibility.
- Prevented raw German discovery evidence/generated discovery names from leaking into the Add Camera UI.
- Added direct recording storage on network devices using SMB/CIFS or SFTP/SSH with server, port, share/path and encrypted credential configuration from the web UI.
- Added connection/write verification, automatic transfer retry, remote playback/export materialization and a bounded local playback cache.
- Added complete Recording Storage UI translations for all 24 supported languages while keeping the SQLite database and active recording spool local for resilience.
- Stabilized in-app updater self-replacement on Synology DSM and legacy Docker Compose by waiting for the new updater health state and validating Docker DNS from the backend.
- Added automatic backend/frontend network recovery only when the backend cannot resolve/reach the recreated updater.
- Suppressed expected transient `UPDATER_DNS_ERROR` diagnostics during the bounded post-update restart grace period and added a persistent finalizer log for troubleshooting.
