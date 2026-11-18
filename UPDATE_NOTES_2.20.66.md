# TMP Camera Surveillance Next 2.20.66 – Kameras im Hintergrund vorbereiten

## Ziel
Alle 25 aktivierten Kameras werden beim Start des Backend-Dienstes ohne Browserbesuch zentral vorbereitet. Kiosk und Live Auto lesen ausschließlich die vorbereiteten Publisher und dürfen keine eigenen Kamera-Anmeldungen auslösen.

## Änderungen
- Kamera-Publisher werden direkt nach dem Start des Backend-HTTP-Servers und dem go2rtc-Broker-Cleanup gestartet – unabhängig von der Wiederherstellung unterbrochener Aufnahmen, vom Abgleich entfernter Netzwerkspeicher und der Oberfläche.
- Erst das beste ONVIF-/Substream-Profil abfragen und sofort einen echten Videostream versuchen; übrige Profile folgen nur bei Fehlern. Bestehende manuelle alternative Quellen bleiben verfügbar. Der normale Onvif-Katalog und die Kameraeinstellungen bleiben erhalten.
- Permanente Kiosk-Preview wird video-first gestartet. Optionales Kamera-Audio verzögert nicht den Video-Start; bei explizitem Live-Mainstream und Aufnahmesessions bleibt Audio erhalten.
- Die neue BACKGROUND_CAMERA_BOOTSTRAP_STAGGER_MS-Einstellung verwendet standardmäßig 250 ms. Sie wirkt auch auf Installationen, deren ältere .env noch PERMANENT_CAMERA_INGEST_STARTUP_STAGGER_MS=1500 enthält, weil das In-App-Update start.sh nicht automatisch ausführt.
- Höchstens STREAM_START_CONCURRENCY gleichzeitig aktive Startvorgänge (standardmäßig 4, bei bestehender individueller .env ggf. abweichend). Serielle Starts derselben Kamera, Watchdog, Backoff, Fallback und Berechtigungen bleiben erhalten.

## Upgrade
Update aus dem vorhandenen Update-Center ab Version 2.20.32. Die Ausgabeversionen in VERSION, backend/frontend/updater package.json und docker-compose.yml sind einheitlich 2.20.66. Das Backend wird bei der Installation kontrolliert neu gestartet und kann laufende Aufnahmen unterbrechen; Wartungsfenster empfohlen.

## Kontrolle
- Backend-Protokoll: Kamera-Bootstrap startet; Streams werden mit begrenzter Parallelitaet aufgebaut. Es sollte einen pauseMs-Wert von 250 zeigen.
- Vor Öffnen des Kiosk: im Backend-Protokoll PUBLISHER_READY und STREAM_READY für aktive Kameras beobachten.
- Der Kiosk wartet nur auf bereits zentral erzeugte HLS-Ringe. Einzelne Offline-Kameras sind weiterhin durch Failover-/Recovery begrenzt und dürfen den Start anderer Kameras nicht blockieren.
- Bei weiterhin alten Startwerten prüfen, ob .env STREAM_START_CONCURRENCY=2 als individueller Wert enthält.

## Kompatibilität
Datenbank, bestehende Kameras, Aufnahmezeitpläne, Aufnahmedateien, benutzerdefinierte Streams und HLS-Puffer werden nicht überschrieben. Enthält die Docker-Compose-V2-Updater-Reparatur und den go2rtc-API-Fallback aus v2.20.65.
