# TMP Camera Surveillance Next 2.20.99 – Audioerkennung

## Ursache

Bei zwei betroffenen Kameras meldete die Liveansicht, dass keine AAC-Audiospur
verfuegbar sei. Eine direkte go2rtc-Messung bestaetigte fuer eine Kamera eine
aktive G.711/PCM-A-law-Quelle sowie eine aktive AAC-Ausgabe mit kontinuierlich
steigenden Paketzaehlern.

In der lokalen HLS-Pruefung stand bis 2.20.98:
`String(stdout || '').trim().toLowerCase() === 'aac'`

FFprobe kann bei MPEG-TS dieselbe AAC-Spur unter Programm und Stream erneut
ausgeben, also z.B. `aac\naac`. Der alte Vergleich bewertete diesen gueltigen
Nachweis als false.

## Reparatur

- Der durch `-select_streams a:0` eingeschraenkte FFprobe-Ausgang wird
  zeilenweise geprueft und akzeptiert mindestens eine AAC-Codec-Zeile.
- Akzeptiert werden sowohl `aac` als auch `codec_name=aac`; Fremdcodecs
  und Teilstrings wie `not_aac` werden abgelehnt.
- Ein erfolgreicher Nachweis schreibt `LOCAL_HLS_AUDIO_VERIFIED` mit dem
  betroffenen Kameraprofil.
- Regressionstest fuer die doppelte FFprobe-Ausgabe und negative Faelle.
- Der Video- und Audio-Transport, FFmpeg-Parameter, Kamerazugangsdaten,
  Datenbank, Aufnahmefunktionen und Kioskmodus bleiben unveraendert.

## Nach dem Update

Auf 2.20.99 aktualisieren, Liveansicht oeffnen, eine Kamera auswaehlen,
Lautsprechertaste einmal zum Aufbauen und danach erneut zum Entstummen
druecken. Im Kamera-Ereignisprotokoll sollte `LOCAL_HLS_AUDIO_VERIFIED`
erscheinen, sofern das tatsaechliche HLS-Segment AAC enthaelt.

## Grenzen

Die Korrektur behebt den nachgewiesenen False-Negative in der Codecpruefung,
nicht automatisch jeden RTSP-Timeout oder jeden fehlenden Audio-Mux.
Falls weiterhin `LOCAL_HLS_AUDIO_NOT_PRESENT` gemeldet wird, muss ein
fertiges HLS-Segment direkt mit FFprobe untersucht werden.
