# TMP Camera Surveillance Next 2.20.65 – Updater-Rettung und zentrale Kamera-Streams

## Korrekturen

- Neuer Updater mit Docker Compose V2: Der bisherige Docker Compose V1.29.2-Fehler `KeyError: 'ContainerConfig'` wird beim Aktualisieren und beim Rollback vermieden.
- go2rtc: Bei HTTP 404 auf der konfigurierten `/media/go2rtc/api/streams`-Adresse wird automatisch die funktionierende Root-API `/api/streams` erkannt. Dieser Endpunkt wird auch fuer den MPEG-TS-Zugriff verwendet.
- Enthält die verbesserte Kamerastartsteuerung aus 2.20.64: vier begrenzte parallele Starts statt zwei und 250 ms statt 1500 ms Staffelung, inklusive Migration bisheriger Standardwerte.
- Bestehende Kameraeinstellungen, Datenbank, Aufnahmen, Motion und HLS-Puffer bleiben erhalten. Direktupdate-Basis ab 2.20.32.

## WICHTIG: Auf bereits defektem Compose-V1-Updater zuerst Host-Reparatur

Der bereits laufende alte Updater kann sich NICHT aus dem Update-Center selbst reparieren, da die Installationsaktion noch mit Compose V1 ausgefuehrt wird. Auf Linux-Hosts mit Docker Compose V2/V5:

```bash
cd /home/kamera/TMP-Networks---Camera-Surveillance-Next-v2 || exit 1
curl -fL --retry 3 -o /tmp/recover-updater-compose-v2.sh \
  https://raw.githubusercontent.com/MTSmash-TMP-Networks/TMP-Networks---Camera-Surveillance-Next-v2/main/scripts/recover-updater-compose-v2.sh
sudo sh /tmp/recover-updater-compose-v2.sh "$PWD"
```

Der isolierte Reparaturweg prueft vorher den aktiven Updater-Projekt-Mount, erstellt und verifiziert ein Compose-V2-Updater-Image, sichert das alte Image und ersetzt nur den Updater mit Healthcheck und Rueckfallpfad. Backend, go2rtc und Frontend werden dabei nicht neu gestartet.

**Danach** das Vollupdate 2.20.65 ueber **Update-Center > Auf GitHub pruefen > Herunterladen und pruefen > Installieren** ausfuehren. Der regulaere Neustart kann laufende Aufnahmen unterbrechen: Wartungsfenster empfohlen. Ist noch kein funktionierender Host-Compose-V2-Zugang vorhanden, diese Host-Reparatur nicht ausfuehren.

## Kontrolle

```bash
sudo docker compose version
sudo docker ps -a --format 'table {{.Names}}\t{{.Status}}'
curl -fsS http://127.0.0.1:8080/healthz
```
