# Public Demo Mode

TMP Camera Surveillance Next includes an optional server-enforced demo mode for marketplace reviews, sales demonstrations and public product previews.

## Enable or disable from the administration UI

Demo Mode is managed directly in the application and does not require `.env` configuration or shell access.

1. Sign in with an **administrator** account.
2. Open **Administration → System status**.
3. Find **Public Demo Mode**.
4. Enable or disable the mode and choose whether evidence exports are allowed.
5. Select **Save demo settings**.

The setting is stored persistently in the application database and takes effect immediately. The application reloads its public runtime status after saving, so the demo banner is updated without a container restart.

The demo-mode settings endpoint remains available to authenticated administrators even while Demo Mode is active. When an administrator enables Demo Mode, TMP Camera automatically creates or reactivates the dedicated **Viewer** account `demo` with password `demo`. This public account cannot access the administrator-only Demo Mode switch.

### Upgrade compatibility

Installations that previously used the legacy `DEMO_MODE` / `DEMO_MODE_ALLOW_EXPORTS` environment variables are migrated once into the database when the new setting does not yet exist. After that one-time migration, Demo Mode is controlled by the administration UI and the persisted database setting.

## What remains available

- Sign-in and session restoration
- Dashboard and camera overview
- Live view and kiosk view
- Stream sessions and heartbeats required for playback
- Snapshots and read-only camera details
- Recording list and playback
- Events, system status and notification history
- Recording-plan and evidence previews that do not save data
- Language switching and all local browser preferences

## What is blocked

The backend returns HTTP `423` with error code `DEMO_MODE_READ_ONLY` for protected operations, including:

- User creation, role changes and password changes
- Camera discovery, camera creation, edits and deletion
- Camera log deletion and media/profile changes
- PTZ movement, home and preset changes
- Stream restart
- Manual recording start/stop and recording deletion
- Recording schedules, retention changes, cleanup and manual event creation
- SMTP and AI setting changes or test calls
- System restart
- Update upload, installation, rollback and package deletion

This protection is enforced server-side. Removing or changing buttons in the browser does not bypass it.

## Demo video sources

For a marketplace demo, add any dedicated demo cameras or permitted public network streams before enabling Demo Mode. Direct RTSP/HLS/MJPEG/HTTP/RTMP/SRT sources can be added through **Add camera → Add network stream** and then behave like normal live/recording/event sources.

Demo Mode intentionally blocks later camera/source edits. An administrator can temporarily disable Demo Mode from **Administration → System status**, maintain the demo sources, and enable it again. Do not connect a public demo instance to production/customer cameras, and only use third-party streams when their terms permit the intended use.

## Evidence exports

Evidence ZIP exports are disabled by default in public Demo Mode because they can generate considerable CPU and disk I/O. For a controlled private demo, an administrator can enable **Allow evidence exports in Demo Mode** in the same administration panel.

The export preview remains available even when actual exports are blocked.

## Demo account

Demo Mode automatically manages only the dedicated public reviewer account `demo` / `demo`. The account is forced to the Viewer role while Demo Mode is active and is disabled again when Demo Mode is turned off. Existing administrator credentials are never exposed or replaced. Keep the administrator account private for maintaining the installation and changing Demo Mode.

## Security note

Demo Mode is an additional application-level safety layer. A public instance should still be deployed behind HTTPS, with normal firewall/rate-limit controls and without production camera credentials, production SMTP recipients or other customer data.
