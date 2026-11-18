# TMP Camera Surveillance Next 2.20.68 – Local-HLS stabil bei vielen Kameras

## Ziel
Bei 25 gleichzeitig aktiven Kameras darf ein vorübergehend fehlendes oder verzögertes HLS-Segment weder einen massenhaften Publisher-Neustart noch sichtbares Flackern des Kiosks auslösen. Der Browser bleibt ein reiner Abnehmer der zentralen Backend-Streams.

## Technische Änderungen
- Weniger Dateisystemlast: Die Backend-Healthprüfung durchsucht eine HLS-Playlist von hinten und prüft nur so viele aktuelle TS-Dateien wie nötig, statt alle 30–60 Dateien für jede Kamera und jede Abfrage per stat zu untersuchen.
- Zehn Sekunden Continuity-Grace für **bereits bereite** HLS-Ringe, falls Playlist oder Segment beim Rotieren kurz fehlen. Das gilt ausschließlich solange der zugehörige FFmpeg-Prozess läuft; beim Erststart oder bei tatsächlichem Prozessausfall ist die Bereitstellung unverändert streng.
- Mindestens 60 Segmente im lokalen Ring (LOCAL_HLS_STABLE_MIN_SEGMENTS=60), auch bei aufbewahrtem LOCAL_HLS_LIST_SIZE=30 aus älteren Update-Center-Installationen. Individuell höhere Werte bleiben höher. Ein expliziter Wert 0 für die neue Mindestreserve deaktiviert die zusätzliche Mindestgrenze.
- Größerer hls.js-Vorwärtspuffer, Zielverzögerung 10 Sekunden, vorsichtigere Wiedergabe-Aufholrate. Vorhandene Frames werden bei kurzzeitigen Fragmentfehlern weiter abgespielt, anstatt den Decoder sofort abzubauen.
- Längere, aber begrenzte hls.js-interne Retry- und Browser-Recovery-Fristen für tatsächlich anhaltende Fehler; fortgesetzter Medienfortschritt verhindert einen unnötigen Neuaufbau.

## Kompatibilität und Grenzen
- Direktupdate ab Version 2.20.32, inklusive aller früheren Fixes für Compose V2, go2rtc, schnellen Kamera-Hintergrundstart und Voscam ONVIF 888.
- Kameraeinstellungen, Netzwerkzugänge, Aufnahme-/Motion-Funktionen und das bestehende .env bleiben erhalten.
- Kurze Verzögerungen werden toleriert, aber ein tatsächlicher Publisher-Prozessausfall löst weiter eine kontrollierte Backend-Wiederherstellung aus.
- Diese Änderung begrenzt Flackern durch HLS-Health-/Player-Reconnects, garantiert ohne reale 25-Kamera-Messung jedoch noch keine vollständige Unterbrechungsfreiheit.
- Update im Wartungsfenster installieren, da der reguläre Backend-/Frontend-Container-Neustart laufende Aufnahmen und Livebilder unterbrechen kann.

## Prüfung nach dem Update
Die 25 Kameras für mehrere Minuten im Kiosk laufen lassen, dabei Motion und Aufnahme eingeschaltet lassen. In den Kameraereignissen auf LOCAL_HLS_READY, PUBLISHER_READY, HLS_PLAYER_FATAL, HLS_RECOVERY_ESCALATED, STREAM_STALLED, FFMPEG_EXIT und STREAM_READY achten. Bei einem gelegentlichen Segment-Lesefehler muss der Stream ohne sichtbare Anzeigeunterbrechung weiterlaufen. Auch `docker stats` und den Segmentstand pro Kamera beobachten.
