# TMP Camera Surveillance Next 2.20.98

## Fix: Live-Audio bricht beim HLS-Start ab

Das Audio-Update 2.20.96 erzwang beim Druecken der Lautsprechertaste
einen neuen High-Quality-Videostream. Bei nicht verfuegbaren Audioframes,
H.265 oder teurer Videonormalisierung konnte die Meldung
"Lokaler HLS-Ring wartet auf die ersten normalisierten Medienframes"
auftreten und die Audiowiedergabe scheitern.

### Geaendert

- Der sichtbare Liveplayer laeuft unabhaengig von Audioanforderungen weiter.
- Ein unsichtbarer Pool-Player fuer `live-audio` wird separat verbunden und
  beim Abbruch unmittelbar freigegeben.
- Der Audiozweig nutzt einen go2rtc-FFmpeg-Produzenten mit `#audio=aac`
  und ohne weitere Videokonvertierung.
- FFmpeg kombiniert die vorhandene normalisierte H.264-Spur und die
  AAC-Mikrofonspur ueber einen MPEG-TS- und einen ADTS-Audio-Endpunkt.
- Neue HLS-Segmente werden bis zu sechs Sekunden auf AAC geprueft, statt
  ausschliesslich den ersten Videofragmenten zu vertrauen.
- Wenn automatische Vorschauqualitaet keinen Audio-Stream hat, wird einmalig
  die Hauptqualitaet versucht, ohne die Liveansicht umzuschalten.
- Kamerawechsel setzt Audio zurueck und beendet die optionale Verbindung.
- Der separate bisherige kombinierte Video/AAC-Broker fuer Aufnahmen und
  bereits gestartete Mainstreams bleibt unveraendert.

### Installation

Kameraserver auf 2.20.98 aktualisieren. Die private Plesk-PHP-WebApp 3.1.1
bleibt unveraendert. Livebild oeffnen, Lautsprechertaste anklicken, bei der
Meldung "Audiokanal bereit" erneut klicken um den Ton abzuspielen.
Ein Kamerawechsel darf den Audiozweig nicht mitnehmen.

### Grenzen

Nur eine tatsaechlich vorhandene und von go2rtc erreichbare Kameratonspur
kann als AAC ausgegeben werden. Ein produktiver Test auf dem Kameraserver
ist erforderlich; ein reiner Quellcode-Fix bestaetigt noch keinen
funktionierenden Kamera-Mikrofoneingang.
