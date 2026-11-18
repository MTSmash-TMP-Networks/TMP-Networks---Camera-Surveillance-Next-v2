# TMP Camera Surveillance Next 2.20.69 – Docker-Installationsfix und Kamerasuche 52/53

## Ursache des fehlgeschlagenen Updates 2.20.68
Der produktive Kameraserver verwendet den klassischen Docker-Builder. Im ersten 2.20.68 Dockerfile stand `FROM --platform=$BUILDPLATFORM golang:1.25-alpine`; auf klassischen Docker-Systemen ist `BUILDPLATFORM` leer. Dadurch brach der Build mit `failed to parse platform: ""` ab. Der Updater stellte 2.20.67 erfolgreich wieder her.

## Korrektur
- Der TMP-gepatchte go2rtc-Broker baut jetzt mit `FROM golang:1.25-alpine` und `CGO_ENABLED=0 go build` nativ fuer die vom Docker-Daemon ausgewählte Plattform, ohne BuildKit-Variablen.
- GitHub CI testet sowohl modernen Build als auch `DOCKER_BUILDKIT=0 docker build` fuer klassische Docker-Umgebungen, zusaetzlich zum Go-Race-Detector und HTTP-API-Smoke-Test.
- Die vorherige go2rtc-Race-Korrektur bleibt erhalten: paralleles API-GET/DELETE darf nicht mehr die globale Go-Streams-Map ohne Lock verändern.

## Kamerasuche bleibt bei 52/53 stehen
- HTTP-Requests in der Geräte-Fingerprint-Prüfung bekommen eine absolute Wall-Clock-Deadline, nicht nur einen beim Datenempfang zurueckgesetzten Socket-Inaktivitaets-Timeout.
- RTSP- und ONVIF-Requests erhalten ebenfalls feste Zeitgrenzen.
- Jeder Geräte-Fingerprint bekommt ein Gesamtbudget von maximal 12 Sekunden (neue Option `DISCOVERY_FINGERPRINT_MAX_MS`, Standard 12000, Bereich 2500–60000). Bereits bestaetigte Geräte werden sofort in den laufenden Auftrag aufgenommen.
- Die Anzeige praesentiert schon waehrend des laufenden Auftrags bestaetigte, nicht bereits eingerichtete Kameras. Ein einziger offline/fehlerhaft antwortender Host muss die zuvor gefundenen Geräte nicht mehr blockieren.
- Die finale kamerabezogene Pruefung und Duplikatfilterung bleiben erhalten; offene Ports allein reichen weiterhin nicht als Kameranachweis.

## Installation
Normales Update-Center ab der bestehenden Installation (z.B. 2.20.67). Der Medienbroker wird vor der Container-Neuerstellung kompiliert; falls der Build scheitert, sollte das Update vor dem Dienstwechsel abbrechen. Durch den regulaeren Neustart koennen Livebild und laufende Aufnahmen kurz unterbrochen werden, daher Wartungsfenster bevorzugen.

## Nachkontrolle
- Version im Update-Center: `2.20.69`.
- Unter `Kamera hinzufuegen` Suchauftrag starten. Bereits gepruefte Kameras muessen waehrend der Anzeige `Gefundene Geräte werden verifiziert …` erscheinen; der Zaehler darf nicht dauerhaft bei 52/53 stehen bleiben.
- Prüfen, dass `tmp-camera-surveillance-next-mediamtx:1.9.14-tmp-racefix1` verwendet wird und `RestartCount` im beobachteten Zeitfenster nicht weiter zunimmt.
- Keine Änderung an vorhandenen Aufnahmen, Motion, Streamprofilen, Zugangsdaten, ONVIF-Portlisten oder der `.env`.
