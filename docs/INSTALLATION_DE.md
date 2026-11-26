# TMP Camera Surveillance Next – Installation und Betrieb (Deutsch)

**Stand:** 2.20.110 · Selbst gehosteter Kameraserver mit Docker, go2rtc/FFmpeg und optionalem HTTPS-Cloud-Zugang.

Diese Anleitung richtet sich an neue Installationen und Administratoren bestehender Installationen. Die [englische Detailanleitung](../INSTALLATION.md), [Update-Kompatibilität](UPGRADE_COMPATIBILITY.md), [Plattformhinweise](COMPATIBILITY.md) und [Datenschutzhinweise](PRIVACY_AND_DATA_PROCESSING.md) ergänzen sie. Die private Plesk-PHP-Cloud-WebApp wird **nicht** aus diesem GitHub-Repository installiert.

## Inhalt

1. [Vorbereitung und Voraussetzungen](#1-vorbereitung-und-voraussetzungen)
2. [Installation unter Linux](#2-installation-unter-linux)
3. [Erster Login und Funktionstest](#3-erster-login-und-funktionstest)
4. [Kamera hinzufügen und Liveansicht](#4-kamera-hinzufügen-und-liveansicht)
5. [Aufnahmen und Netzwerkspeicher](#5-aufnahmen-und-netzwerkspeicher)
6. [Updates und sichere Rollbacks](#6-updates-und-sichere-rollbacks)
7. [Speicherplatz und Update-Backups](#7-speicherplatz-und-update-backups)
8. [NAS, Windows, macOS und Desktop-Client](#8-nas-windows-macos-und-desktop-client)
9. [Optionaler HTTPS-Cloud-Zugang](#9-optionaler-https-cloud-zugang)
10. [Sprachen und Barrierefreiheit](#10-sprachen-und-barrierefreiheit)
11. [Fehlerdiagnose](#11-fehlerdiagnose)
12. [Sicherheit und Wartung](#12-sicherheit-und-wartung)

## 1. Vorbereitung und Voraussetzungen

**Empfohlener Einstieg:** Linux-Host mit Docker Engine und Docker Compose. Die Installation kann auf Ubuntu, Debian, Linux Mint und Fedora mit systemd fehlendes Docker automatisch aus den offiziellen Docker-Paketquellen installieren. Vorhandene Docker-Installationen werden nicht ersetzt. Für Synology/QNAP sowie Docker Desktop muss Docker zunächst über den Hersteller eingerichtet sein.

| Bereich | Empfehlung / Hinweis |
|---|---|
| Betriebssystem | Linux-Server bevorzugt; Docker-fähiges NAS, Windows/WSL2 und macOS möglich |
| CPU | x86_64 oder ARM64, ausreichend Leistung für Anzahl und Codec der Kameras |
| Arbeitsspeicher | Kapazität nach Kameraanzahl/Transcoding dimensionieren; RAM-Limits für Backend und go2rtc sind konfigurierbar |
| System-/Docker-Datenträger | Für wiederholte Image-Builds und Rollbacks **40 GB oder mehr als Planungsgröße**, nicht als garantierte Mindestanforderung |
| Freier Platz vor Updates | Möglichst **6–8 GB Reserve** auf dem Dateisystem von Docker **und** Projekt/Backup-Verzeichnis |
| Aufnahmen | Eigenes ausreichend großes Laufwerk oder NAS (SMB/CIFS beziehungsweise SFTP) |
| Netzwerk | Kameraserver muss ONVIF-/RTSP-Endpunkte der Kameras direkt erreichen können |
| Browser | Aktueller Firefox, Chromium/Chrome, Edge oder Safari |

> Ein 15-GB-Systemlaufwerk ist bei vielen wiederholten Docker-Updates oft zu knapp. Ein realer Fehlerfall zeigte über 7 GB alte Update-Backups. Die automatische Docker-Cache-Bereinigung allein genügt dann nicht. Die Aufnahmekapazität zusätzlich zu Docker und Rollback-Speicher planen.

**Standardports:** TCP `8080` für Weboberfläche, optional TCP/UDP `8189` für WebRTC/ICE. Kamera-Protokollports richten sich nach Hersteller und ONVIF/RTSP-Konfiguration. Direkte RTSP-Freigaben ins Internet sind nicht erforderlich und werden nicht empfohlen.

## 2. Installation unter Linux

### 2.1 Aktuelle Dateien beziehen

1. Das Repository [TMP-Networks—Camera-Surveillance-Next-v2](https://github.com/MTSmash-TMP-Networks/TMP-Networks---Camera-Surveillance-Next-v2) öffnen und über **Code → Download ZIP** das vollständige Paket herunterladen.
2. Die ZIP-Datei in einen **dauerhaften** lokalen Ordner entpacken (nicht direkt im ZIP oder auf einem flüchtigen Downloads-Verzeichnis starten).
3. Terminal im entpackten Ordner öffnen, **in dem `start.sh`, `docker-compose.yml` und `frontend/` liegen**.

Beispiel für eine schon entpackte Anwendung:

```bash
cd /opt/tmp-camera/TMP-Networks---Camera-Surveillance-Next-v2
ls start.sh docker-compose.yml frontend/package.json
```

Der Ordnername ist frei wählbar und kann bei GitHub-ZIP/Release-Paketen anders aussehen. Nicht blind einen historischen Versionsordner übernehmen.

### 2.2 Docker prüfen

```bash
sh ./scripts/install-docker.sh --check
docker info
docker compose version
```

Wenn Docker auf einer unterstützten Linux-Distribution vollständig fehlt, kann `start.sh` die Einrichtung vornehmen. Ohne automatische Installation: `DOCKER_AUTO_INSTALL=0 sh ./start.sh`. Benutze kein fremdes, ungeprüftes Installationsskript.

### 2.3 Erststart

```bash
chmod +x start.sh stop.sh update.sh logs.sh scripts/*.sh
./start.sh
```

Wenn der Docker-Socket Root-Rechte verlangt:

```bash
sudo ./start.sh
```

Beim ersten Start werden die private Konfigurationsdatei `.env`, zufällige Zugangsschlüssel und das persistente Verzeichnis `data/` erzeugt. Anschließend baut Docker Backend, Frontend, Updater und Medienbroker und startet die Container. Für Paket- und Image-Downloads ist eine Netzwerkverbindung erforderlich, sofern keine Offline-Images vorbereitet wurden.

**Niemals `.env` ins Git einchecken oder öffentlich weitergeben.** Sie enthält unter anderem Administrator-Zugangsdaten und Token-Schlüssel.

## 3. Erster Login und Funktionstest

1. Die vom Startskript ausgegebene Adresse aufrufen, normalerweise `http://SERVER-IP:8080`.
2. Mit Benutzer `admin` und dem beim Erststart erzeugten Kennwort anmelden. Das Kennwort steht zusätzlich geschützt in `.env`.
3. Ein eigenes starkes Administrator-Kennwort festlegen und die Zugangsdaten sicher aufbewahren.
4. In der Oberfläche **Systemstatus** und **Update-Center** öffnen.

Anschließend im Projektordner kontrollieren:

```bash
sudo sh ./scripts/docker-compose.sh ps
curl -fsS http://127.0.0.1:8080/healthz
sudo sh ./scripts/diagnose.sh
```

Erwartet werden laufende Container für `backend`, `frontend`, `mediamtx` und möglichst `updater`. Ein `502 Bad Gateway` deutet häufig auf ein nicht erreichbares Backend hin:

```bash
sudo sh ./scripts/docker-compose.sh logs --tail=150 backend frontend
```

## 4. Kamera hinzufügen und Liveansicht

1. Über **Kamera hinzufügen** einen ONVIF-Scan starten oder Kamera-IP manuell angeben.
2. Kamera-Benutzer und Kennwort eingeben, dann Verbindung, ONVIF-Fähigkeiten und Videoprofile prüfen.
3. Main- und Substream für die jeweilige Kamera testen. Bei Reolink kann der ONVIF-Port `8000` relevant sein; das manuelle Feld bei Bedarf ausfüllen.
4. Kamera speichern und über **Liveansicht** öffnen.
5. Optional PTZ prüfen und ein Kiosk-Raster speichern.

**Video und Ton:** Das Browser-Livebild startet standardmäßig stumm. Bei Kameras mit Mikrofon kann Ton über die Lautsprechertaste angefordert werden. Der Live-Audiopfad verwendet einen kombinierten H.264/AAC-Broker; der sichtbare Videoplayer bleibt beim Aktivieren und Kamerawechsel erhalten. Browser können die Tonfreigabe nach einer Nutzeraktion verlangen. Fehlt die Tonspur, läuft das Video weiter.

Für H.265/HEVC und andere nicht browserkompatible Formate normalisiert go2rtc/FFmpeg Video bei Bedarf auf H.264. Auf Intel-Hardware kann VAAPI **nach einem erfolgreichen Hardwaretest** aktiviert werden:

```bash
sudo sh ./scripts/intel-vaapi.sh --check
# Nur nach erfolgreichem Test und bewusster Entscheidung:
sudo sh ./scripts/intel-vaapi.sh --enable
```

Diese Option nicht ungeprüft einschalten; die Aktivierung erfordert ein gezieltes Neuaufsetzen der betroffenen Container. Ausführliche Befehle stehen in [README.md](../README.md#intel-n97--intel-igpu-hardware-acceleration-opt-in).

## 5. Aufnahmen und Netzwerkspeicher

**Standard:** Aufnahmen und Aufnahmeblöcke liegen im persistenten Ordner `data/recordings/`. Die SQLite-Datenbank liegt bei `data/kamera_server.db`. Das Verzeichnis `data/` darf bei Updates nicht gelöscht werden.

Als Administrator unter **Aufnahmen → Speicher** ein Ziel auswählen:

- **Lokal:** Datenträger für Aufnahmeblöcke mit ausreichender freier Kapazität.
- **SMB/CIFS:** NAS-/Windows-Freigabe (typischer TCP-Port 445, SMB2/SMB3; kein SMB1).
- **SFTP/SSH:** Netzwerk-Ziel über SSH (typischer TCP-Port 22) mit Host-Key-Prüfung.

Zuerst **Verbindung testen**, danach das Ziel speichern. Der Server schreibt abgeschlossene Blöcke zunächst lokal, komprimiert sie bei Bedarf und überträgt/verifiziert sie, bevor lokale Spool-Dateien entfernt werden. Die aktiven Aufnahmeblöcke werden dabei nicht vorzeitig gelöscht. Eine unterbrochene NAS-Verbindung wird erneut versucht.

**Kontrolle ohne Löschung:**

```bash
sudo sh ./scripts/recording-storage-audit.sh
```

## 6. Updates und sichere Rollbacks

Die Software wird bevorzugt über **Administration → Update-Center → Auf GitHub prüfen → Herunterladen & prüfen → Installieren** aktualisiert. Der Updater prüft Dateien und SHA-256-Prüfsummen, erstellt eine Sicherung und besitzt eine Rollback-Funktion. Vorher Daten- und Konfigurationssicherung erstellen und den freien Speicher überprüfen.

- Bestehende `.env`, `data/` und laufende Aufnahmen nicht entfernen.
- Direktupdates **ab 2.20.32** benutzen die dokumentierten Kompatibilitätsregeln; ältere Installationen benötigen einen geprüften Zwischenschritt: [Upgrade-Kompatibilität](UPGRADE_COMPATIBILITY.md).
- Bei fehlerhaftem Frontend-/Docker-Build darf ein Update zurückrollen. Prüfe die Installationslogs, statt unüberlegt wiederholt zu starten.
- Ein separates Aktualisieren des Updaters selbst erfolgt bei Bedarf über `scripts/repair-updater.sh` oder einen kontrollierten Host-Neustart.
- GitHub-Quellcode **nicht** mit einem unkontrollierten `git pull` in einer aktiven Installation überschreiben.

## 7. Speicherplatz und Update-Backups

Ab 2.20.108 werden die automatischen Update-Sicherungen in `data/backups` und `data/updates/backups` gemeinsam auf die zwei neuesten verifizierbaren Stände begrenzt. Der im Update-Status referenzierte Rollback-Stand bleibt zusätzlich geschützt, falls er älter ist. Manuelle TAR-Archive, nicht eindeutig prüfbare Sicherungen, aktive Aufnahmen und die laufende Datenbank werden nicht gelöscht. Historische Wiederherstellungspunkte bei Bedarf vorher extern sichern.

Vor einem Update:

```bash
df -h /
df -i /
sudo docker system df
sudo du -sh /var/lib/docker /var/lib/containerd data/backups 2>/dev/null
sudo du -h --max-depth=1 data/backups | sort -h
```

**Nur der Build-Cache kann gefahrlos separat bereinigt werden:**

```bash
sudo docker builder prune --all --force
sudo docker image prune --force
```

Die automatische Bereinigung erfolgt beim Start des neuen Updaters sowie vor und nach Updates. Beim ersten Update auf diese Version greift sie bereits über den vorhandenen Docker-Bereinigungs-Hook, sofern dieser aktiviert ist. Mit installiertem Node.js kann `node scripts/update-backup-cleanup.mjs --dry-run` im Projektverzeichnis die Löschkandidaten anzeigen, ohne etwas zu löschen. `--offline-apply` ausschließlich im Wartungsbetrieb bei gestopptem Updater und ohne laufendes Update oder Rollback verwenden. Keine pauschalen `rm -rf data/`, keine manuelle Löschung unter `/var/lib/containerd` und **niemals** `docker system prune --volumes` als vermeintliche Reparatur. Manuelle Vollsicherungen gegebenenfalls getrennt auf externe Datenträger verschieben.

Ein System mit weniger als einigen Gigabyte freiem Platz ist für einen vollständigen neuen Docker-Build ungeeignet. Im Zweifel die Systemdisk vergrößern beziehungsweise Docker-Daten auf ein ausreichend großes Laufwerk verschieben, bevor das Update wiederholt wird.

## 8. NAS, Windows, macOS und Desktop-Client

- **Synology/QNAP:** Docker/Container Manager über das NAS installieren, Anwendung auf dauerhaften lokalen Shared-Folder legen und via SSH starten. Die Anwendung installiert auf NAS keine Host-Docker-Pakete. Active SQLite-Datenbanken nicht auf unzuverlässigen Netzwerk-Mounts betreiben.
- **Windows:** Docker Desktop mit WSL2 nutzen; die Linux-Shell-Skripte in WSL2 ausführen. Projekt und Datenbank möglichst innerhalb des WSL2-Dateisystems ablegen.
- **macOS:** Docker Desktop starten; Projekt auf freigegebenem lokalem Volume ablegen und `sh ./start.sh` im Terminal ausführen.
- **Linux-Desktop-Client:** Im angemeldeten Webfrontend unter **Desktop-Client** das Linux-x64-Paket herunterladen. `install-linux.sh` auf dem Arbeitsplatzrechner **als normaler Benutzer, nicht mit sudo** starten. Der Desktop-Client benötigt keinen zusätzlichen Kamera-Docker-Server.

## 9. Optionaler HTTPS-Cloud-Zugang

Die lokale Kamera-Anwendung und die private **TMP Camera Cloud** sind **zwei getrennte Installationen**:

1. **Kamera-Server:** bleibt lokal in Docker; registriert sich mit eigener Installations-ID und geheimem Geräteschlüssel über den ausgehenden Cloud-Agenten.
2. **Private Cloud:** liegt auf einem eigenen Plesk-Webspace mit HTTPS, PHP 8.2+ und MySQL/MariaDB. Das Portal wird separat als private `index.php` unter `/cam/` installiert; Version 3.1.2 besitzt die überarbeitete Ein-Klick-Tonbedienung.

Die **PHP-Quelldatei, Datenbankpasswörter, Geräte-Keys und private Konfigurationen dürfen nicht in dieses öffentliche GitHub-Repository aufgenommen werden**. Die Cloud erhält zunächst ihre eigene MySQL-Datenbank und SSL/TLS-Konfiguration; beim ersten Aufruf prüft der private Full-Installer die Umgebung. Die Konfiguration wird außerhalb des Webroots gespeichert.

Danach wird der Kamera-Server über den Cloud-Agenten registriert. Am Portal meldet sich der Benutzer mit **Server-ID und den normalen Kamera-Server-Zugangsdaten** an. Administratoren können registrierte Installationen sperren/wieder freigeben. Ein direkter HTTP-/RTSP-Portzugriff aus dem Internet ist dafür nicht nötig.

Für iPhone/Android kann der persönliche HTTPS-Link im Browser geöffnet und als Web-App zum Startbildschirm hinzugefügt werden. Audio beginnt bewusst nach einer Nutzeraktion; die Browser-Autoplay-Politik kann Ton blockieren, obwohl der Stream verfügbar ist.

## 10. Sprachen und Barrierefreiheit

Das Webfrontend unterstützt **24 Oberflächensprachen**: Deutsch, Englisch, Französisch, Spanisch, Italienisch, Niederländisch, Polnisch, Portugiesisch (Brasilien), Türkisch, Tschechisch, Dänisch, Schwedisch, Norwegisch (Bokmål), Finnisch, Rumänisch, Ungarisch, Griechisch, Ukrainisch, Russisch, Arabisch, vereinfachtes/traditionelles Chinesisch, Japanisch und Koreanisch.

Sprache im Sprachauswahlmenü umstellen; die Auswahl wird im Browser gespeichert. Arabisch aktiviert rechts-nach-links (RTL). Einige technische Produkt- und API-Namen bleiben unverändert. **Detaillierte Lizenztexte** liegen derzeit auf Deutsch und Englisch vor; für andere Sprachen werden die Bedienelemente übersetzt und die englischen Detailabschnitte ausdrücklich gekennzeichnet. Neue Übersetzungen und Prüfschritte: [docs/TRANSLATIONS.md](TRANSLATIONS.md).

## 11. Fehlerdiagnose

| Symptom | Vorgehen |
|---|---|
| `502` im Frontend | `sudo sh ./scripts/docker-compose.sh logs --tail=150 backend frontend` |
| Kein Livebild | Kamera-RTSP/ONVIF prüfen; `sudo sh ./scripts/docker-compose.sh logs --tail=150 mediamtx backend` |
| Ton nicht verfügbar | Mikrofon im Kameraprofil prüfen; Audiobroker/FFmpeg-Meldungen und `LOCAL_HLS_AUDIO_VERIFIED` im Backend-Log prüfen |
| Browser blockiert Ton | Wiedergabe explizit per Lautsprechertaste starten; Safari kann zusätzliche Interaktion verlangen |
| Update abgebrochen | `df -h /`, `sudo docker system df`, `data/backups` sowie Update-Logs prüfen |
| Nach Update kein Login | Backend-Status prüfen, Datenbank und `.env` nicht neu erzeugen |
| Keine Kamera gefunden | Host-Routen und `HOST_SCAN_RANGES` prüfen; ONVIF-Port ggf. manuell setzen |

Weitere Diagnose:

```bash
sudo sh ./scripts/diagnose.sh
sudo sh ./scripts/camera-encoder-diagnostics.sh
sudo sh ./scripts/docker-compose.sh ps
```

Die Ausgabe kann sensible Infrastrukturinformationen enthalten. Zugangstokens, RTSP-Passwörter und öffentliche Zugänge vor Weitergabe entfernen.

## 12. Sicherheit und Wartung

- Starke Benutzerkonten, Rollenprinzip und HTTPS für entfernten Zugriff.
- Standardports für lokale Bedienung nur im vertrauenswürdigen Netz freigeben.
- `.env`, `data/` und Netzwerk-Storage-Zugangsdaten sichern, aber niemals veröffentlichen.
- Regelmäßige externe Sicherung **getrennt** von `data/backups` auf derselben Systemdisk aufbewahren.
- `sh ./scripts/backup.sh` erzeugt eine manuelle Sicherung und stoppt dafür das Backend kurzzeitig; bei großen lokalen Aufnahmen kann das Archiv erheblich wachsen. Für produktive Systeme zusätzlich konsistente externe Snapshots vorsehen.
- Betriebssystem, Docker, Browser und Software aktuell halten.
- Datenschutz- und Einwilligungsanforderungen der jeweiligen Einsatzorte beachten.

**Hinweis:** Technische Angaben spiegeln die Version 2.20.110 wider. Die tatsächlich installierte Softwareversion erscheint im Webfrontend bzw. in der Datei `VERSION`. Ältere Installationen können abweichende Menüs oder Funktionen besitzen.

### Behördenexport als MP4 (2.20.105)

Das ZIP enthält `export.mp4`, `manifest.json` und `README.txt`. ZIP entpacken und die MP4 direkt öffnen. Der Server erstellt vor dem Download die vollständige, spulbare MP4. Auf dem Aufnahmevolume muss dafür ausreichend temporärer Speicher vorhanden sein. Bei einem Formatwechsel innerhalb des gewählten Zeitraums kürzere kompatible Zeiträume exportieren. Die Originalaufnahmen bleiben unverändert.

### Durchgehender Aufnahmeplayer (2.20.106)

In der Tagesübersicht öffnet ein Klick die vollständige Tageszeitachse der ausgewählten Kamera. Farbige Bereiche markieren vorhandene Aufnahmen, graue Bereiche Aufnahmelücken. Der zusätzliche Regler und die Sprungtasten ermöglichen Vor- und Zurückspulen innerhalb der verfügbaren Blöcke. Einzeln geöffnete Aufnahmen zeigen ihren gesamten abgeschlossenen Aufnahmezeitraum. Neu abgeschlossene Blöcke werden beim erneuten Öffnen berücksichtigt.

### Upload-Priorität bei Rückstau (2.20.109)

Die optionale Hintergrundkomprimierung blockiert den SMB-/SFTP-Upload nicht mehr unbegrenzt. Unter 2 GiB freiem Speicher (oder einer höheren konfigurierten Reserve), ab 512 MiB Rückstau oder zehn Minuten Wartezeit werden fertige Blöcke ohne weitere Komprimierung archiviert. Der aktuell komprimierte Block und nicht bereinigte Komprimierungs-Zwischendateien bleiben geschützt. Normalerweise laufen zwei, bei Speicherdruck bis zu vier Upload-Aufträge parallel. Ab 2.20.110 werden SMB-Client-Aufrufe an denselben Server zum Kontoschutz serialisiert. Erst nach verifizierter Übertragung wird die lokale Kopie entfernt. Bei nicht erreichbarem Netzwerkspeicher werden ausstehende Aufnahmen nicht für diese Bereinigung gelöscht. Die Originalblöcke können mehr Platz auf dem NAS beanspruchen. Die Grenzwerte stehen in `.env.example`; vorhandene explizite Komprimierungseinstellungen bleiben unverändert.

### SMB-Kontoschutz (ab 2.20.110)

Nach einer abgelehnten SMB-Anmeldung (z. B. `NT_STATUS_LOGON_FAILURE`, gesperrtes Konto oder abgelaufenes Kennwort) setzt die Anwendung alle weiteren SMB-Verbindungsversuche zum betreffenden konfigurierten Servernamen bzw. zur IP-Adresse für 60 Minuten aus. Die Sperrfrist wird in der Systemdatenbank gespeichert. Uploads, Abrufe, manuelle Verbindungstests und Löschoperationen nutzen dieselbe Sperre. Das Frontend zeigt unter Aufnahmen → Speicher den frühesten nächsten Versuch an. Aufnahmen werden lokal gepuffert, solange ausreichend Speicher vorhanden ist; bereits archivierte Daten bleiben erhalten. Andere Speicherziele und SFTP sind nicht betroffen. SMB-Client-Aufrufe zum selben Server werden seriell ausgeführt, um parallele Fehlanmeldungen zu verhindern. Unterschiedliche Host-Aliase werden nicht automatisch als derselbe Server erkannt. Nach Ablauf wird automatisch erneut versucht. Bei einer dauerhaften NAS-Sperre oder falschen Zugangsdaten muss das Problem am NAS bzw. in den Speicherprofilen behoben werden.
