# TMP Camera Surveillance Next 2.20.92 – MP4 statt HLS fuer Cloud-Aufnahmen

## Hintergrund
Bei frueheren Cloud-Versionen blieb der Wiedergabeknopf auf dem iPhone scheinbar ohne Reaktion. Der Browser wartete beim Klick zunaechst auf die blockierende Anfrage `recording-segments`. Auch die anschliessende dynamische HLS-Segment-Uebertragung ist unter PHP-FPM und MySQL mit langen Wartezeiten verbunden.

## Was neu ist
- Ein direkt herunterladbarer, 15 Sekunden langer MP4-Ausschnitt pro Anforderung.
- Vor dem Download braucht das PHP-Portal weder HLS.js noch den Aufruf `recording-segments`.
- Der Kamera-Server ermittelt aus der gewaehlten Aufnahmestartposition den passenden Aufnahmeblock selbst, auch wenn ein Block auf einem NAS liegt.
- Die Datei wird fuer den Fernzugriff in 360p/H.264/AAC erstellt und direkt als `video/mp4`/Attachment ausgeliefert.
- Sicherheit: Nur mit gueltiger Kamera-Anmeldung; keine Rohdatei-Downloads, keine Aufnahmeloeschung, keine Export- oder Administrations-API. Die Server-ID und der geheime Agentenschluessel bleiben bestehen.
- PHP-Version 3.0.9 erhaelt neben dem optionalen alten HLS-Player einen primaeren Button `MP4 herunterladen (15 Sek.)` und eine Startminute, in 15-Sekunden-Schritten.

## Grenzen des aktuellen HTTPS-Relays
Die PHP-Gegenstelle speichert zwischengespeicherte Agenten-Antworten in MySQL. Lange Aufnahmedateien passen nicht in die 3,5-MB-Medienantwortgrenze. Deshalb koennen vorerst nur kurze, jeweils 15 Sekunden lange Ausschnitte heruntergeladen werden. Es handelt sich nicht um einen kompletten Original-Export. Fuer ganze, lange Aufnahmen waere kuenftig ein separater Download-Job mit Streaming-Dateispeicher statt PHP/MySQL notwendig.

## Installation
1. Die private Plesk-`/cam/index.php` auf **3.0.9** ersetzen. Der PHP-Code gehoert nicht nach GitHub.
2. Danach das Kamera-System ueber das GitHub-Updatecenter auf **2.20.92** aktualisieren.
3. In der iPhone-WebApp `Aufnahmen` oeffnen und `MP4 herunterladen` antippen. Standardmaessig ist dies der erste 15-Sekunden-Ausschnitt; spaetere Startpositionen ueber `MP4 ab Minute` waehlen.

## Tests
Lokale PHP- und JavaScript-Syntaxpruefung und FFmpeg-MP4-Test erfolgreich. Das Zusammenwirken mit echtem Plesk, Kamera-Agent und iPhone ist nach der Installation zu testen.
