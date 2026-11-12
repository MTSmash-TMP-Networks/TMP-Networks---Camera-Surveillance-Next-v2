# TMP Camera Surveillance Next 2.20.44 – Stabilerer HLS-Puffer und Live-Status

- **Größerer Local-HLS-Ring:** Der serverseitige Ring hält standardmäßig 30 Segmente mit je einer Sekunde statt nur etwa acht Sekunden vor. Kurze WLAN-, LAN- oder Paketverluste können dadurch aus bereits vorhandenen Segmenten überbrückt werden.
- **Bewusster Abstand zur Live-Kante:** hls.js läuft standardmäßig rund acht Sekunden hinter dem neuesten Segment. Der Browser erhält bis zu 30 Sekunden Vorwärtspuffer und 15 Sekunden Rückpuffer, statt permanent an der Live-Kante zu hängen.
- **Ruhigere Recovery:** Waiting-Grace, Recovery-Watchdog sowie Manifest-, Level- und Fragment-Wiederholungen wurden erhöht. Ein kurzer Segmentfehler führt nicht mehr so schnell zu einem vollständigen Stream-Neuaufbau.
- **Konfigurierbarer Ring:** `LOCAL_HLS_SEGMENT_SECONDS` (Standard 1) und `LOCAL_HLS_LIST_SIZE` (Standard 30) erlauben eine spätere Anpassung über die bestehende `.env`, ohne die Kameraeinstellungen zu verändern.
- **Ampellogik repariert:** Ein fehlerhafter Hintergrund-, Kiosk- oder Profilstream setzt die Kamera nicht mehr pauschal auf `stream_error`, solange ein anderer Stream derselben Kamera gesund ist.
- **Live-Ampel nach echter Wiedergabe:** In der Live-Kameraliste hat die tatsächlich laufende Browserwiedergabe Vorrang: Grün bei `ready`, Gelb bei Verbindungsaufbau/Recovery und Rot nur, wenn die Kamera wirklich als offline gilt.
- **Keine Änderung an Aufzeichnungen oder Kameraadressen:** Kamera-, ONVIF-, RTSP- und Aufzeichnungsdaten bleiben erhalten. Beim Neustart der aktualisierten Dienste können Livebilder kurz unterbrochen werden.

Die Änderung priorisiert bei der Überwachungsansicht bewusst Bildstabilität vor minimaler Latenz. Die zusätzliche Verzögerung von ungefähr acht Sekunden ist beabsichtigt.
