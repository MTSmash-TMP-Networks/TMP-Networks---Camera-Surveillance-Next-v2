# Update-Kompatibilitaet / Upgrade-Policy

## Stabiler Direktupdate-Pfad

- Unterstuetzter alter Grundstand: **2.20.32** (bekannte Dateistruktur und historische Update-Validatoren); Ziel dieses Releases: **2.20.42**.
- Alle Voll-Update-Pakete sind selbstenthaltend (Backend, Frontend, Updater, Konfiguration, Migrationen) und werden unveraendert sowohl als herunterladbares ZIP als auch als GitHub-Source-ZIP geprueft.
- Ab 2.20.32 keine Zwischenrelease-Pflicht: Versionsnummern dienen der Ordnung, nicht als Zwang zum inkrementellen Patchen.
- Vor v2.20.32 ist eine getestete Legacy-Bridge erforderlich. Es gibt **keine** Zusicherung beliebiger uralter Versionsstaende.

## Release-Vertrag

1. Vor jeder Release: `node scripts/check-update-compatibility.mjs` ausfuehren. Der Test ist Teil der GitHub-Actions-Pruefung. Verwendet wird der Root-Allowlist-Stand von Updater v2.20.32.
2. Keine neuen Top-Level-Verzeichnisse oder Dateien ohne eine getestete Legacy-Bridge. Neue Komponenten unter `backend/`, `frontend/`, `scripts/`, `docs/` oder anderen historisch erlaubten Pfaden ablegen.
3. Die Felder `minimumVersion`, `minVersion`, `compatibleFrom`, `fromVersion` stehen auf dem aeltesten **tatsaechlich geprueften** Direktupgrade-Baseline-Stand, nicht auf der unmittelbaren Vorgängerversion. Bei inkompatiblen Schema-Aenderungen die Mindestversion anheben und eine Bruecke anbieten.
4. Neue Datenbank-/Konfigurationsmigrationen muessen vor der Freigabe mit dem aeltesten unterstuetzten Zustand getestet werden. Alte Docker-Updater kennen moeglicherweise neue Syntax nicht; deshalb bleibt der Payload im alten JSON-/ZIP-Schema.
5. `FILES.sha256` muss genau jede Datei ausser sich selbst abdecken. `MANIFEST.txt` und `UPDATE_PACKAGE.json` muessen denselben Bestand melden. GitHub-Quellarchive enthaelt keine unversionierten Dateien.
6. `.env`, `.git` und `data/` werden nie vom Update überschrieben oder geloescht; der Updater erstellt vor jeder Installation ein Backup und faehrt bei Fehlern einen Rollback.
7. Der Updater wird nicht innerhalb seines eigenen laufenden Updateprozesses ausgetauscht. Fuer einen noch aelteren Updater mit bereits bekannten Kompatibilitaetsproblemen ist ein separat verifizierter Bootstrap/Host-Rebuild erforderlich.

## Fehlerbehandlung

Bei `Unbekannter oberster Paketpfad` oder `Mindestens Version ... erforderlich` nicht die Sicherheitspruefung ausschalten und keine Aufnahmeordner loeschen. Kompatibilitaetsmatrix pruefen, gegebenenfalls eine eigene SHA-256-gepruefte Bridge ausliefern. Der lokale Host-Repair-Befehl `sudo sh ./scripts/repair-updater.sh` kann einen alten Updater nur dann aktualisieren, wenn der auf Platte vorhandene Quellstand die benoetigte Funktion bereits enthaelt.
