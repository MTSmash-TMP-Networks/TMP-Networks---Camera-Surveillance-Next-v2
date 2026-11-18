# TMP Camera Surveillance Next v2.20.71 – fairer Kamerastart mit 26 Kameras

## Ausgangslage und belegte Messung
Bei einer Anlage mit 26 Kameras lief der eigene TMP-go2rtc-Broker ohne Abstuerze (RestartCount=0, OOMKilled=false). Die Startwarteschlange erlaubte vier gleichzeitige Kameraaufbauten. Zahlreiche spaet eingereihte Kameras warteten 140–194 Sekunden vor dem ersten FFmpeg-Start, obwohl die eigentliche FFmpeg-zu-HLS-Bereitstellung haeufig nur 10–13 Sekunden brauchte. Manche fehlerhafte Quellen blockierten ihren Startplatz sehr lange durch mehrere Profil-, Encoder- und Snapshot-Versuche.

## Reparatur
- Der automatische Backend-Kaltstart beginnt mit einer kurzen **ersten Welle** fuer alle 26 aktivierten Kameras. Maximal vier Startvorgaenge gleichzeitig und 250 ms Standardstaffelung bleiben erhalten.
- Die erste Welle versucht einen bevorzugten ONVIF- beziehungsweise direkten Videokandidaten und nur den zuerst geeigneten Encoder. Der HLS-Erstaufbau erhaelt ein standardmaessiges aktives Medienwartebudget von 20 Sekunden (`BACKGROUND_CAMERA_BOOTSTRAP_MAX_MEDIA_MS=20000`, Werte 12000–60000).
- Nicht sofort erreichbare Kameras duerfen nicht alle folgenden Kameras blockieren. Weitere Profile, die ONVIF-Profil-Neuerkennung, alternative Encoder und der Snapshot-Notfallpfad werden **nach der ersten Welle** ueber die vorhandene automatische Wiederherstellung abgearbeitet. Dies ist kein dauerhafter Verzicht auf Fallbacks.
- Ein fehlerhafter erster Versuch zaehlt weiterhin als echter Verbindungsfehler und respektiert den zentralen Startlimiter und Restart-Schutz. Im Normalbetrieb sind die bisherigen 60-Sekunden-Grenzen unveraendert.
- Pro Kamera und Startvorgang wird `CAMERA_START_TIMING` mit `queuedMs`, `activeMs`, `fastPass` und `state` protokolliert; Nutzernamen, Passwoerter und RTSP-Adressen werden nicht ausgegeben.

## Bewahrte Funktionen
- Erhalt des TMP Hardened Media Brokers mit Go-Map-Racefix sowie bestehender VAAPI-/H.264-Copy-First-Regeln
- Dauerhafte Backend-Publisher und Frontend nur als Abnehmer
- Unveraenderter Mainstream fuer Aufnahme, Bewegungserkennung, PTZ, manuell gewaehlte Quellen und Recovery
- Keine Datenbankmigration, keine Aenderung gespeicherter Kameras, Medienquellen, Aufnahmen oder .env
- Vollstaendige Aufwaertskompatibilitaet ab v2.20.32 im regulaeren Update-Center

## Validierung
- Test: vier Startplaetze reichen fuer 26 Kameras ohne Ueberschreitung
- Regression: erste Welle benutzt kurzen HLS-Erstversuch, verschiebt Wiederherstellung, laesst Aufnahme und Motion unberuehrt
- Nach der Installation sollten alle 26 Kameras vor dem Oeffnen der Liveansicht unabhaengig vom Browser beim Backendstart in die Startwarteschlange aufgenommen werden.
- Erfolgskriterien: `CAMERA_START_TIMING` je Kamera; wenige Minuten statt verzoegerter FFmpeg-Starts bei funktionierenden Kameras; kein `concurrent map writes`; keine unnötigen Broker-Neustarts

## Installationshinweis
Update-Center ueber `main`, idealerweise im Wartungsfenster. Der Neustart kann laufende Aufnahmen und Livebilder kurz unterbrechen. Bei Kameras mit instabiler Verbindung bleiben die vorhandenen Restart-/Backoff-Grenzen aktiv. Eine Garantie fuer problemlose 26 gleichzeitige Kamerastreams erfordert eine reale Messung auf dem Produktionsserver.


## Frontend-Reparatur und CI-Qualitaet
- Browserzugriff auf sessionStorage ist abgesichert: Das Frontend funktioniert auch in isolierten Browser-, SSR- und Testumgebungen, ohne dass ein sofortiger Importfehler die Kameraseite verhindert.
- WHEP-Signalisierung bekommt eine harte Deadline inklusive SDP-Antwortbody. Ein aushaengender RTSP-/WebRTC-Aufbau blockiert den Browser nicht unbegrenzt.
- Der Aufnahmespeicher-Reiter hat wieder vollstaendige deutsche und englische Sprachschluessel.
- Aeltere Tests wurden auf die heute zentral gebuendelten Live-Videoplayer, die lokalisierte Aufnahme-/Update-Oberflaeche und echte FFmpeg-Snapshot-Video-Sessions aktualisiert, ohne sie zu deaktivieren.
- Vitest und native node:test-Suiten werden in getrennten Prueflaeufen ausgefuehrt. Beide muessen bestehen, bevor ein Release als vollstaendig geprueft gilt.
