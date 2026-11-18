# TMP Camera Surveillance Next 2.20.75

## Kameravorschau: zentraler persistenter Bildcache

In der Kameraübersicht und im visuellen Kiosk-Rastereditor werden keine Kamera-Snapshots mehr direkt beim Öffnen eines Fensters ausgelöst. Das Frontend liest ausschließlich bereits vorhandene JPEGs aus dem Datenverzeichnis des Servers (authentifizierter API-Endpunkt `/api/cameras/:id/thumbnail`).

Der Backend-Scheduler extrahiert alle 60 Sekunden je Kamera ein kompaktes JPEG aus einem **bereits laufenden lokalen HLS-Segment**. Die Anläufe sind über die Minute verteilt, maximal **ein FFmpeg-Decoder** arbeitet gleichzeitig. Keine zusätzlichen Kamera-Streams, keine Live-Snapshot-Abfragen, keine ONVIF-Probes. Fehlt ein funktionsfähiger HLS-Ring, bleibt das letzte gültige Vorschaubild bestehen; ist noch kein Bild vorhanden, erscheint ein neutraler Platzhalter.

Speicherung: `/data/thumbnails`; Kamera-IDs werden in SHA-256-Dateinamen überführt. Bilddaten werden begrenzt und atomar ersetzt. Beim Ändern der Kameraquelle oder Löschen einer Kamera wird ihr Cache invalidiert. Eine erfolgreiche Aufnahme/Motion-Erkennung wird nicht von der Vorschaubildgenerierung abhängig gemacht.

## Linux-Client: Login über dieselbe Serveradresse

Der Server-Login wurde durch einen Nginx-Headerfehler verhindert: `Host $host` ließ den Port, beispielsweise `:8080`, weg. Die Desktop-Session prüft aus Sicherheitsgründen Origin und Host einschließlich Port. Der API-Proxy reicht nun `Host $http_host` weiter. Die Same-Origin-Sicherung bleibt aktiv; unsichere Cross-Origin-Ausnahmen und Zertifikats-Bypasses werden nicht verwendet.

Die Linux-Loginmaske erhält ein eigenständiges responsives Layout mit normal großer Checkbox, lesbarer Beschreibung und eindeutigen Abständen. Die Desktop-Geraetesitzung bleibt serverseitig widerrufbar. Die bereits verteilte Electron-2.20.74-Laufzeit kann weiterverwendet werden; der enthaltene Download ist binär unverändert.

## Upgrade und Kompatibilität

Direktes Upgrade ab 2.20.32 über das bestehende ZIP-Updatezentrum. `.env`, `data` und `.git` bleiben geschützt. Der Hintergrundcache benutzt das bereits vorhandene Datenvolume und verändert keine Streams, Kameraeinstellungen, Aufnahmen, Rasterlayouts oder Aufnahmeplanung.
