<p align="center">
  <img src="frontend/src/assets/tmp-camera-icon-512.png" width="140" height="140" alt="Offizielles Logo – TMP Camera Surveillance Next">
</p>

<h1 align="center">TMP Camera Surveillance Next</h1>

<p align="center">
  <strong>Professionelle Videoüberwachung. Lokal betrieben. Zentral verwaltet.</strong>
</p>

<p align="center">
  Kameraerkennung, Liveansicht, Aufnahmen und Systemverwaltung in einer gemeinsamen Weboberfläche.
</p>

<p align="center">
  <a href="#schnellstart">Schnellstart</a> ·
  <a href="docs/INSTALLATION_DE.md">Installation</a> ·
  <a href="#funktionen">Funktionen</a> ·
  <a href="#aktualisierungen">Aktualisierungen</a> ·
  <a href="CHANGELOG.md">Versionshistorie</a>
</p>

---

## Überblick

**TMP Camera Surveillance Next** ist eine selbst gehostete Kamera- und Aufzeichnungsplattform für Docker-Umgebungen. Die Anwendung vereint die Verwaltung von ONVIF-Kameras und direkten Netzwerkstreams mit einer responsiven Weboberfläche, einem zentralen Medienbroker sowie Funktionen für Livebild, PTZ, Aufnahmen, Ereignisse, Benutzer und Updates.

Die Software kann innerhalb des eigenen Netzwerks betrieben werden. Für den optionalen HTTPS-Fernzugriff steht eine **separat installierte private Cloud-WebApp** zur Verfügung. Die private PHP-Portaldatei gehört bewusst **nicht** zum GitHub-Repository.

**Aktuelle Version:** `2.20.104` · **Installationsart:** Docker · **Oberflächensprachen:** 24

## Funktionen

| Bereich | Möglichkeiten |
|---|---|
| **Kameras** | ONVIF-Erkennung, manuelle Einrichtung, Herstellerprofile und direkte Netzwerkstreams |
| **Liveansicht** | Browser-Livebild über lokalen HLS-Ring, Kamerawechsel und optionaler AAC-Ton |
| **Kiosk-Modus** | Konfigurierbare Kameraraster, individuelle Zuordnung und Vollbilddarstellung |
| **Steuerung** | PTZ-Funktionen, Presets und gerätespezifische Funktionen |
| **Aufnahmen** | Dauer-, Zeitplan-, manuelle und ereignisgesteuerte Aufzeichnung, Wiedergabe und Export |
| **Speicher** | Lokale Aufnahmeblöcke sowie optionale Archivierung über SMB/CIFS oder SFTP |
| **Ereignisse** | Bewegungserkennung, Benachrichtigungen, SMTP und optionale KI-Auswertung |
| **Administration** | Benutzerrollen, Systemstatus, Protokolle, Diagnosen und Update-Center |
| **Clients** | Responsive Browseroberfläche und separater Linux-Desktop-Client |
| **Sprachen** | 24 Oberflächensprachen einschließlich Arabisch mit Rechts-nach-links-Darstellung |

Die verfügbaren Funktionen hängen vom Kameramodell, der Firmware und den angebotenen ONVIF-/Medienprofilen ab.

## Schnellstart

### Voraussetzungen

- Docker-fähiger Linux-Server, unterstütztes NAS oder Docker Desktop auf macOS/Windows mit WSL2
- Docker Engine und Docker Compose (auf unterstützten Linux-Distributionen kann der Erststart fehlendes Docker installieren)
- Netzwerkzugriff vom Kameraserver zu den ONVIF-/RTSP-Adressen der Kameras
- Ausreichend Speicherplatz für System, Docker-Images, Update-Sicherungen und Aufnahmen

**Speicherempfehlung:** Für Betriebssystem, Docker und Updates sind **etwa 40 GB oder mehr als Planungsgröße** sinnvoll; Aufnahmen benötigen zusätzlichen Speicher. Vor umfangreichen Updates sollten möglichst **6–8 GB frei** sein. Dies sind Planungswerte, keine garantierten Mindestanforderungen.

### Installation unter Linux

1. Das Repository über **Code → Download ZIP** herunterladen und vollständig in einen dauerhaften lokalen Ordner entpacken.
2. Im Terminal in den Ordner wechseln, in dem `start.sh` und `docker-compose.yml` liegen.
3. Die Anwendung starten:

```bash
chmod +x start.sh stop.sh update.sh logs.sh scripts/*.sh
./start.sh
```

Wenn der Docker-Zugriff Administratorrechte erfordert:

```bash
sudo ./start.sh
```

Beim ersten Start erzeugt das Skript eine geschützte `.env`, legt persistente Datenordner an, baut die Docker-Images und startet die Dienste.

**Weboberfläche:** `http://SERVER-IP:8080`

**Erstanmeldung:** Benutzer `admin`. Das automatisch erzeugte Kennwort wird beim ersten Start angezeigt und in `.env` abgelegt. Diese Datei enthält vertrauliche Schlüssel und darf nicht veröffentlicht werden.

Die vollständige Anleitung steht in der **[deutschen Installationsdokumentation](docs/INSTALLATION_DE.md)**. Eine [englische Installationsanleitung](INSTALLATION.md) ist ebenfalls verfügbar.

## Kameraeinrichtung und Livebild

1. Unter **Systemstatus** die laufenden Dienste kontrollieren.
2. Über **Kamera hinzufügen** einen ONVIF-Scan starten oder die Kamera-IP manuell angeben.
3. Kamera-Zugangsdaten sowie Main-/Substream prüfen und das Profil speichern.
4. **Liveansicht** öffnen und bei unterstützten Kameras PTZ oder den Kiosk-Modus konfigurieren.
5. Aufnahmespeicher unter **Aufnahmen → Speicher** einrichten und die Verbindung testen.

Bestimmte Kameras benötigen einen manuell angegebenen ONVIF-Port, etwa `8000` bei einigen Reolink-Modellen.

**Live-Ton:** Die normale Vorschau startet stumm. Bei Kameras mit geeigneter Audioquelle kann der Ton bewusst über die Lautsprechertaste aktiviert werden. Der AAC-Audiopfad ist vom sichtbaren Liveplayer getrennt. Browser können zur Tonfreigabe eine Nutzeraktion verlangen; fehlt eine Tonspur, läuft das Video weiter.

## Architektur

| Dienst | Aufgabe |
|---|---|
| `frontend` | Weboberfläche und geschützte Browser-Medienzugriffe |
| `backend` | Kameras, Benutzer, Streaming-Sitzungen, Aufnahmen und APIs |
| `mediamtx` | go2rtc-/FFmpeg-Medienbroker und Codec-Normalisierung |
| `updater` | Prüfung, Sicherung, Installation und Rollback von Updates |

Anwendungsdaten liegen im persistenten Verzeichnis `data/`, Konfiguration und Geheimnisse in `.env`. **Beides darf bei Updates nicht gelöscht oder öffentlich geteilt werden.**

Für geeignete Intel-Systeme steht optional Intel VAAPI nach erfolgreichem Hardwaretest zur Verfügung. Ein Betrieb ohne passende GPU ist möglich.

## Aufnahmen und Speicherung

Standardmäßig liegen Aufnahmen unter `data/recordings/` und die lokale SQLite-Datenbank unter `data/kamera_server.db`. Optional lassen sich abgeschlossene Aufnahmeblöcke in ein SMB-/CIFS- oder SFTP-Archiv übertragen. Laufende Aufnahmen bleiben bis zur Fertigstellung lokal.

Speicherzustand prüfen, **ohne Aufnahmen zu löschen**:

```bash
sudo sh ./scripts/recording-storage-audit.sh
```

Mehr Informationen: [Aufnahmen und Netzwerkspeicher](docs/INSTALLATION_DE.md#5-aufnahmen-und-netzwerkspeicher).

## Aktualisierungen

Das integrierte **Update-Center** führt durch den Ablauf:

**Auf GitHub prüfen → Herunterladen & prüfen → Installieren**

Der Updater prüft Release-Manifest und SHA-256-Prüfsummen, erstellt einen Wiederherstellungspunkt und kann bei Fehlern zurückrollen.

- `.env`, `data/`, Kameradaten und Aufnahmen unbedingt erhalten.
- Genügend freien Platz auf dem Docker-Dateisystem bereitstellen.
- Alte `data/backups/update-*`-Sicherungen bewusst verwalten. Eine Docker-Cache-Bereinigung entfernt diese **nicht**.
- Direktupdates ab **2.20.32** folgen den dokumentierten Kompatibilitätsregeln; ältere Versionen benötigen gegebenenfalls einen geprüften Zwischenschritt.
- Kein unkontrolliertes `git pull` über eine laufende Installation ausführen.

Alle Änderungen und früheren Versionsstände sind zentral in der **[Versionshistorie](CHANGELOG.md)** dokumentiert.

## Optionaler HTTPS-Fernzugriff

Ein privat verwalteter Plesk-HTTPS-Zugang ermöglicht die mobile Nutzung über die eindeutige Installations-ID. Die Anmeldung verwendet die normalen Kamera-Server-Zugangsdaten und den ausgehenden Cloud-Agenten. Öffentliche RTSP-Portfreigaben sind dafür nicht erforderlich.

Die **private PHP-WebApp (3.1.2)** wird unabhängig vom Docker-Kameraserver installiert und aktualisiert. Ihr Quellcode, Datenbankzugänge, Geräteschlüssel und andere Geheimnisse werden **nicht in GitHub veröffentlicht**.

## Sprachen und Übersetzungen

Die Weboberfläche unterstützt **24 Sprachen**. Die Auswahl wird im Browser gespeichert; Arabisch aktiviert die Rechts-nach-links-Darstellung. Regionale chinesische Varianten werden korrekt zugeordnet.

Automatische Tests prüfen Schlüssel, Platzhalter und Sprachzuordnung. Die ausführlichen rechtlichen Detailtexte stehen derzeit nur auf Deutsch und Englisch zur Verfügung; in anderen Sprachen weist die Oberfläche ausdrücklich darauf hin.

[Sprachübersicht und Qualitätssicherung](docs/TRANSLATIONS.md)

## Betrieb und Diagnose

Befehle im Projektverzeichnis ausführen:

```bash
# Containerstatus
sudo sh ./scripts/docker-compose.sh ps

# Diagnosebericht
sudo sh ./scripts/diagnose.sh

# Backend- und Medienprotokolle
sudo sh ./scripts/docker-compose.sh logs --tail=150 backend mediamtx

# Docker- und Update-Backup-Speicher
sudo docker system df
sudo du -sh /var/lib/docker /var/lib/containerd data/backups 2>/dev/null
```

Bei wenig freiem Platz zuerst die Speichernutzung prüfen. Kameraaufnahmen und für Rollbacks benötigte Sicherungen niemals pauschal löschen.

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [Deutsche Installationsanleitung](docs/INSTALLATION_DE.md) | Erststart, NAS, Kameras, Cloud, Wartung und Fehlersuche |
| [Englische Installationsanleitung](INSTALLATION.md) | Ausführliche Anleitung in englischer Sprache |
| [Update-Kompatibilität](docs/UPGRADE_COMPATIBILITY.md) | Direktupdates und Legacy-Sicherheitsprüfungen |
| [Plattform-Kompatibilität](docs/COMPATIBILITY.md) | Betriebssysteme, Browser und Medienprotokolle |
| [Netzwerkstreams](docs/NETWORK_STREAMS.md) | Zusätzliche Videoquellen und deren Einrichtung |
| [Übersetzungen](docs/TRANSLATIONS.md) | Sprachkatalog, Fallbacks und Prüfverfahren |
| [Datenschutz](docs/PRIVACY_AND_DATA_PROCESSING.md) | Datenschutz und Betreiberverantwortung |
| [Drittanbieter-Hinweise](docs/THIRD_PARTY_NOTICES.md) | Komponenten und Lizenzen |
| [Versionshistorie](CHANGELOG.md) | Zusammengefasste Änderungen aller Versionen |

## Lizenz und Hersteller

Die Nutzung unterliegt den mit der Software bereitgestellten **[Lizenzbedingungen](LICENSE_AGREEMENT.md)**. Drittanbieter-Komponenten behalten ihre jeweiligen Lizenzbedingungen. Hersteller- und Produktnamen dienen nur der technischen Beschreibung und bedeuten keine Zertifizierung oder Partnerschaft.

**TMP Camera Surveillance Next** · TMP-SYSTEM-SERVICE GmbH


### Behördenexport für ganze Tage (2.20.104)

Der Behördenexport kann jetzt einen kompletten Kalendertag über **Ganzer Tag (00:00–24:00)** auswählen. Große ZIP-/ZIP64-Archive werden direkt an den Browser übertragen, statt zunächst als mehrgigabytegroße Kopie auf dem Kameraserver gespeichert und danach als JavaScript-Blob geladen zu werden. Die ZIP-Datei enthält weiterhin `manifest.json`, `README.txt`, `export.m3u8` und die Original-Aufnahmeblöcke mit SHA-256- und CRC32-Prüfsummen. Für den Download dient eine kurzlebige, einmalige und rollenbeschränkte Freigabe. Die eigentlichen Aufnahmen werden nicht verändert.
