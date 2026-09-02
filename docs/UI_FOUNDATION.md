# UI Foundation

TMP Camera Surveillance Next uses a hybrid frontend architecture.

## Application shell

The application shell uses the open-source **CoreUI 5.9.0** CSS framework as a baseline for established admin-interface layout concepts such as the sidebar, navigation items, header, footer and responsive shell structure.

CoreUI is loaded from the pinned npm package `@coreui/coreui` and is imported before `frontend/src/styles/app.css`. TMP-specific CSS therefore remains the final visual layer and controls the dark surveillance-oriented theme.

No CoreUI PRO code, templates, assets or paid components are included.

## TMP-specific surveillance UI

The following areas remain purpose-built TMP application code rather than generic template screens:

- live camera view and multi-camera presentation
- camera cards and camera setup workflows
- ONVIF/PTZ controls and presets
- recording controls, archive and timeline
- event/evidence workflows
- kiosk view
- recording/storage status and surveillance-specific diagnostics

This separation keeps common shell patterns maintainable while leaving the actual NVR workflows under the product's own component architecture.

## Navigation architecture

Role-aware navigation metadata is defined in `frontend/src/config/navigation.js`. `AppShell.jsx` renders that configuration using CoreUI-compatible class names instead of owning a second hard-coded navigation model.

## Licensing and attribution

CoreUI 5.9.0 is MIT-licensed. The complete license text is retained in `docs/third-party/CoreUI-MIT.txt` and CoreUI is listed in `docs/THIRD_PARTY_NOTICES.md`.

`@popperjs/core` 2.11.8 is pinned because it is a peer dependency declared by CoreUI. TMP Camera Surveillance currently imports the CoreUI stylesheet only and does not depend on CoreUI's JavaScript widgets for the application shell.
