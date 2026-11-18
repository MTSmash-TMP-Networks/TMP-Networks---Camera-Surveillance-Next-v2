# TMP Camera Surveillance Next 2.20.80

## Bedingte HLS-Startnachfrist
Das Kamerasystem meldete in 45 Minuten 452 lokale FFmpeg-Starts, 383 PROFILE_MEDIA_TIMEOUT und nur 44 STREAM_READY. Version 2.20.80 verhindert bei nachweislich gestarteten go2rtc-Produzenten ein zu fruehes Abbrechen waehrend der ersten Videoframes: Nach Ablauf des bisherigen kurzen HLS-Fensters wird ein einziges Mal der go2rtc-Broker abgefragt. Nur wenn dieser einen aktiven Produzenten meldet oder FFmpeg echte Fortschrittswerte liefert, wird bis zum bestehenden hart begrenzten Maximum gewartet. Ohne belegte Aktivitaet gelten weiterhin die kurzen Ausfallzeiten. Im schnellen Kaltstart maximal acht Sekunden zusaetzliche Zeit, bei ungeeigneten/fehlenden Quellen keine unendliche Warteschleife.

Die Kamera gilt **nur dann als bereit**, wenn weiterhin ein tatsaechlich geschriebenes und frisches HLS-Segment vorhanden ist. Dieser Schutz ist fuer Aufnahmeintegritaet und Livebilder unveraendert.

## Bessere Diagnose
Ein Medien-Timeout unterscheidet nun: upstreamReady (go2rtc-Produzent), progressUpdates (tatsaechlich fortschreitende FFmpeg-Ausgabe), processExited, hlsReason (z. B. missing-playlist, missing-segments oder stale-segments) sowie upstreamError. Die Felder bleiben in ATTEMPT_FAILED.error.details verfuegbar, ohne Passwort oder Kamera-URL.

FFmpeg-Nullwerte (frame=0, total_size=0) zaehlen nicht mehr als echter Fortschritt.

## Hinweis
Der Fix beseitigt nicht nachweislich alle gerateseitigen RTSP-/Codec-/Encoder-Probleme. Er macht zu fruehe Abbrueche bei spaet startenden go2rtc-Produzenten seltener und trennt die Ursachen fuer die weitere Analyse. Vorhandene Kamera-, Aufnahme- und Kiosk-Einstellungen sowie Medienarchive bleiben erhalten. Kompatibles Upgrade ab 2.20.32.
