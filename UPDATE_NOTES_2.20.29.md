# TMP Camera Surveillance Next 2.20.29

## Complete Kiosk Mode and Update Center localization

- Kiosk Mode is now fully connected to the application i18n system in every supported UI language.
- The kiosk layout editor, saved views, grid templates, camera assignment, quality controls, fullscreen actions, status labels, empty states, tooltips and accessibility labels are translated consistently.
- The Update Center is now fully localized for loading and error states, updater health, diagnostics, package upload and installation, confirmations, progress phases, backups, history, security notices and accessibility text.
- Update progress is rendered from stable technical phase codes instead of exposing German backend status sentences in non-German interfaces.
- Update-service issue states and technical installation actions now have native translations for all 24 supported locales instead of falling back to German or English.
- Date and number formatting in the Update Center follows the currently selected locale.
- Added regression coverage that verifies locale parity, interpolation placeholders and the absence of known hard-coded German UI strings in Kiosk Mode and Update Center.
- Existing kiosk layouts, camera settings, per-camera motion regions, recordings, updater compatibility and the v2.20.27 sidebar-collapse correction remain unchanged.

Supported locales: German, English, French, Spanish, Italian, Dutch, Polish, Brazilian Portuguese, Turkish, Czech, Danish, Swedish, Norwegian Bokmål, Finnish, Romanian, Hungarian, Greek, Ukrainian, Russian, Arabic, Simplified Chinese, Traditional Chinese, Japanese and Korean.
