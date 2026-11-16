# TMP Camera Surveillance Next 2.20.58 – WLAN-/RTSP-Start und Audio

- Permanenter zentraler Preview-Publisher behaelt wieder die ONVIF-Audiospur und bietet G.711 via separat konvertiertem AAC-Pfad fuer HLS an. Dedizierte Motion-/Prebuffer-Worker koennen weiterhin video-only bleiben.
- Eine aktive RTSP-Quelle wird bei langsam eintreffendem GOP nicht mehr nach exakt 12 Sekunden verworfen: FFmpeg-Medienfortschritt verlaengert begrenzt die Frist bis STREAM_ACTIVE_MEDIA_START_MAX_MS (Standard 60000 ms).
- Der HLS-Remux respektiert native MPEG-TS-Zeitstempel statt einer erzwungenen Wallclock-Ueberschreibung.
- Snapshot-H.264 ist weiterhin die letzte Notversorgung, kein Ersatz fuer eine noch aktive RTSP-Quelle.
- Rueckwaertskompatibel ab 2.20.32; keine neuen Migrationen, keine Aenderung bestehender Aufnahmen, Kameraeintraege oder Stream-URLs.
- Kiosk-Kacheln sind fuer Browser-Autoplay weiterhin initial stummgeschaltet; Live-Ansicht bietet den Ton bei aktiviertem Lautsprecher.
- Reale Kamera-, WLAN- und Dauertests sind vor Produktivfreigabe weiterhin erforderlich.
