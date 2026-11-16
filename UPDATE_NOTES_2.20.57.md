# TMP Camera Surveillance Next 2.20.57 – Stabilitaet

Dieses Update bewahrt die bestehende Direktupdate-Basis **2.20.32**.

## Korrekturen

- Kontrollierte Compose-Neuerstellung statt harter Containerentfernung; kein doppelter Backend-/Broker-/Frontend-Neustart nach der Installation.
- 100 Sekunden Docker-Stop-Frist und 85 Sekunden Backend-Shutdown-Grenze, mit paralleler Fertigstellung unabhaengiger Kameraaufnahmen.
- Begrenzte parallele Starts von unterschiedlichen Kameras bei fortbestehender Serialisierung derselben Kamera; eine Offline-Kamera blockiert nicht den Aufnahme-Scheduler.
- Veraltete Kamerastart-Auftraege nach Entfernung oder Stopp werden verworfen.
- Frische und im HLS-Manifest referenzierte TS-Segmente sind Pflicht fuer den Live-Gruenstatus; vorhandene go2rtc-Spuren allein gelten nicht mehr als Videofortschritt.
- Die HLS-Dateipfade fordern Medientoken auch fuer Segmente an. hls.js benutzt Bearer-Header, native HLS-Wiedergabe eng begrenzte HttpOnly-Cookies.
- Browser-Kiosk-Polling laeuft ohne parallele Statusanfragen; blockierende API-Requests erhalten Standard-Timeouts; identische Kamera-Kacheln besitzen getrennte Videoelemente.
- Der Snapshot-H.264-Fallback ist wieder fuer permanente Vorschauen, Aufnahmen, Bewegungserkennung und Vorlaufpuffer zulaessig; die bisherige Sperre wurde entfernt.
- Bei ONVIF-Profilfehlern oder nicht erreichbarem go2rtc kann ein verfuegbarer Snapshot weiterhin als lokaler HLS-Ring starten. Aufnahme und Bewegungserkennung lesen diesen Ring intern ohne go2rtc-Umweg; dieser Notmodus hat kein Kameraton-Signal und kann bei Verbindungsstoerungen das letzte Bild wiederholen.
- Neue ausfuehrbare Tests fuer Segment-Frische, Kamerastart-Limit und sichere Updater-/HLS-Regeln sowie erweitertes Build-/Test-CI.

## Update-Kompatibilitaet

- `minimumVersion`, `minVersion`, `compatibleFrom` und `fromVersion` bleiben **2.20.32**.
- `.env`, `.git` und `data/` werden beim Update weiter geschuetzt; keine destruktive Datenbankmigration.
- Bestehende HLS-URLs, Kameraeintraege, Aufnahmen, Kiosk-Layouts und Docker-Compose-Service-Namen bleiben erhalten.
- Neue optionale Parameter: `STREAM_START_CONCURRENCY=2`, `LOCAL_HLS_FRESHNESS_SECONDS=30` und `SNAPSHOT_VIDEO_MAX_WIDTH=960` (320 bis 1920); alte `.env`-Dateien funktionieren ohne Aenderung.

Vor dem produktiven Einsatz ist die CI-Pruefung abzuwarten und das Verhalten mit echten Kameras, Netzwerkunterbrechungen und laufender Aufnahme am Zielsystem zu verifizieren.
