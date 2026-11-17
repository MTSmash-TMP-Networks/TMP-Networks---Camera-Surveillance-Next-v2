# TMP Camera Surveillance Next 2.20.63 – Original-Kamerastreams kehren automatisch zurueck

Nach gemeinsamem Broker-Ausfall blieben mehrere Kameras im Snapshot-Video-Fallback haengen. Der Fallback publizierte weiter eigene HLS-Segmente und galt deshalb fuer den Backend-Watchdog als gesund. Eine erneute Pruefung des Originalstreams fehlte.

- Snapshot bleibt eine erlaubte Notversorgung fuer schwierige WLAN-Kameras sowie Aufnahme/Motion.
- Jeder permanente Snapshot-Publisher merkt sich einen naechsten nativen Probezeitpunkt, standardmaessig 90 Sekunden plus pro Kamera zeitversetztem Jitter.
- Die Wiederherstellung prueft zuerst die Erreichbarkeit der go2rtc-API sowie echte Medienframes aus einer bereits bekannten beziehungsweise aktuellen RTSP-/ONVIF-/manuellen Quelle.
- Vor dieser Pruefung wird der aktive Snapshot-Ring NICHT beendet.
- Nur eine Kamera nach der anderen wird geprueft; parallele reconnect-/FFmpeg-Spitzen aller Kameras werden vermieden.
- Bei erfolgreicher Medienpruefung wird der native Publisher kontrolliert aufgebaut. Scheitert er trotzdem, bleibt der etablierte Snapshot-Video-Fallback zulaessig und wird spaeter erneut geprueft.
- Der Browser erkennt den Moduswechsel am zentralen Publisher und synchronisiert gezielt den Decoder, um das Originalbild samt Ton zurueckzuholen.
- Containerlimits fuer Backend und go2rtc werden standardmaessig auf je 1536 MB angehoben, ohne die cgroup-Schutzgrenzen zu entfernen. Explizite vorhandene .env-Werte werden nicht ueberschrieben.
- Die Aufnahmedateien, Kameraeinstellungen, PTZ- und Audiopipelines, Snapshot-Berechtigungen sowie die dauerhafte zentrale HLS-Versorgung bleiben erhalten.
- Bestehende Installationen ab 2.20.32 koennen wie bisher aktualisiert werden.

Hinweis: Ohne Docker-/Kernel-Logs ist nicht bewiesen, dass das 768-MB-Limit den urspruenglichen gemeinsamen Streamausfall ausgeloest hat. Diese Version behebt auch die fehlende Rueckkehr aus einem zwischenzeitlich erforderlichen Fallback.
