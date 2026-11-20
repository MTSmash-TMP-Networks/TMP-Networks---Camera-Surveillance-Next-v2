# TMP Camera Surveillance Next 2.20.99 - Live-Ton aus dem Aufnahme-A/V-Broker

## Befund aus der Live-Diagnose

Die betroffenen Kameras melden G.711/PCM A-law mit 8 kHz, und go2rtc zeigte
bei der ersten Kamera tatsaechlich fortlaufende AAC-Pakete mit 48 kHz. Die
Aufnahmen besitzen laut Anlagenbetreiber bereits funktionierenden Ton.
Das Problem liegt im Live-Wiedergabepfad nach der Audio-Konvertierung.

Bisher kombinierte der separate Browser-Live-Audioplayer zwei voneinander
unabhaengige HTTP-Eingaenge: Video aus go2rtc MPEG-TS und Audio aus go2rtc
ADTS. Der HLS-Ring meldete wiederholt `LOCAL_HLS_AUDIO_NOT_PRESENT`,
obwohl der AAC-Broker Pakete liefert. Zudem stellte die Codec-Erkennung
manche gueltigen MPEG-TS-Segmente faelschlich als stumm dar.

## Reparatur

1. Fuer `live-audio` wird der vorhandene kombinierte go2rtc
   H.264/AAC-Broker `*_audio` verwendet, den auch das Aufnahme-System
   fuer Aufnahmen referenziert (selbe Broker-Definition, gemeinsame
   Referenzzaehlung und Producer-Wiederverwendung).
2. FFmpeg liest diesen einen synchronisierten MPEG-TS-Eingang. Die
   separaten `*_video`- und `*_mic`-Eingaenge werden fuer
   `live-audio` nicht mehr gleichzeitig gemuxt.
3. Das sichtbare Livevideo bleibt vollstaendig separat und laeuft
   waehrend der Tonaktivierung ohne Camera-Remount weiter.
4. FFprobe prueft den Codec-Ausgang zeilenweise. Die bei MPEG-TS
   gaengige doppelte Ausgabe `aac\naac` zaehlt als AAC-Nachweis.
5. `LOCAL_HLS_AUDIO_VERIFIED` meldet einen erfolgreichen Nachweis
   in einem abgeschlossenen HLS-Segment.
6. Regressionstests pruefen die Aufnahme-Broker-Verwendung,
   das Ein-Eingang-FFmpeg-Muxing und eine echte FFmpeg/FFprobe-
   MPEG-TS-Datei (sofern die Programme in der Testumgebung vorhanden sind).

## Keine Aenderungen

Keine Aenderung am sichtbaren Liveplayer, Kiosk, Kamera-Konfiguration,
ONVIF/RTSP-Zugang, aktiven Aufnahmebefehlen, gespeicherten Videodaten,
Benutzern, Aktualisierungs-Recovery oder der privaten Plesk-PHP-WebApp 3.1.1.

## Live-Pruefung nach dem Update

Auf 2.20.99 aktualisieren, Liveansicht oeffnen und Ton einmal anfordern.
Nach Anzeige `Audiokanal bereit` erneut tippen/klicken, um ihn zu
entstummen. In den Kameraereignissen muss bei vorhandenem AAC
`LOCAL_HLS_AUDIO_VERIFIED` erscheinen. Ein Kamerawechsel darf den
sichtbaren Liveplayer nicht neu laden.

Dies ist eine anhand der Logs begruendete Korrektur, kein Ersatz fuer
den produktiven Test. RTSP-Timeouts und falsch konfigurierte einzelne
Kameras koennen weiterhin separate Fehler verursachen.
