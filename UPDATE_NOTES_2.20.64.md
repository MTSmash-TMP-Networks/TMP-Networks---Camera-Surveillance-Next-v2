# TMP Camera Surveillance Next 2.20.64 – 25 Kameras schneller starten

## Verbesserung

- Der Backend-Kamerastart verwendet standardmaessig maximal vier parallel laufende Startvorgaenge statt zwei.
- Die Startanforderungen fuer permanent verwaltete Vorschau-Streams werden nun alle 250 ms statt alle 1500 ms eingereiht. Bei 25 Kameras sinkt die reine Staffelungszeit von 36 auf 6 Sekunden, ohne dass dadurch die eigentliche Zeit fuer RTSP-/ONVIF-Profilpruefung und die HLS-Bereitstellung garantiert wird.
- Die Browser-Kacheln im Kioskmodus werden ebenfalls schneller an die bereits verwalteten zentralen HLS-Streams angebunden: 120 ms Abstand, maximal 3 Sekunden Zusatzverzoegerung.
- Der zentrale Publisher bleibt alleiniger Eigentuemer der Kamera-Vorschaustreams; Kiosk und Live Auto sind weiterhin reine Abnehmer.

## Installation und Kompatibilitaet

- Installierbares Komplettupdate mit bisherigem Update-/Rollback-Verfahren ab Version 2.20.32.
- start.sh migriert nur bisherige Standardwerte: PERMANENT_CAMERA_INGEST_STARTUP_STAGGER_MS=1500 zu 250 und STREAM_START_CONCURRENCY=2 zu 4. Abweichende Administratorwerte bleiben unveraendert.
- Kameraeinstellungen, Datenbanken, Aufnahmen, Streamprofile, Bewegungserkennung und HLS-Puffergroessen bleiben unveraendert.
- Wie bei jedem Backend-/Frontend-Update kann der kurze Container-Neustart aktive Livebilder und laufende Aufnahmen unterbrechen. Installation im Wartungsfenster empfohlen.

## Ueberpruefung

Nach dem Update 25 aktive Kamera-Streams im Kiosk und der Kamerauebersicht pruefen. Im Diagnoseprotokoll CAMERA_START_ACQUIRED, LOCAL_HLS_READY und PUBLISHER_READY beobachten. Die Maximalparallelitaet bleibt auf vier begrenzt. Bei problematischen Kameranetzen kann STREAM_START_CONCURRENCY wieder auf 2 gesenkt werden.
