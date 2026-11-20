# TMP Camera Surveillance Next 2.20.100 – Installation und Sprachen

## Inhalt der Aktualisierung

Dieses Release aktualisiert die **Dokumentation und Oberflächenübersetzungen**. Es ändert nicht den funktionierenden Live-/AAC-Broker, die Aufnahme-Pipeline oder die private Plesk-PHP-Cloud.

### Installationsdokumentation

- Neue deutschsprachige Anleitung: `docs/INSTALLATION_DE.md` mit Installationsvoraussetzungen, Docker-Erststart, Kameraeinrichtung, NAS/SMB/SFTP, Audio, Rollbacks, Cloud und Diagnose.
- Englische `INSTALLATION.md` auf aktuellen Stand gebracht und veraltete Beispiele aus früheren Versionen entfernt.
- System-/Docker-Speicherkapazität, `data/backups/update-*`-Sicherungen und sichere Bereinigung dokumentiert. Der Updater rotiert diese Sicherungen weiterhin **nicht automatisch**; dies ist eine Dokumentationswarnung, keine neue Funktion.
- README verlinkt beide Sprachen und die Übersetzungsrichtlinien.
- PHP-WebApp 3.1.2 wird nur als **separate private Plesk-Installation** erwähnt. Keine PHP-Quelldatei oder Zugangsdaten werden im öffentlichen Repository ausgeliefert.

### 24 Oberflächensprachen

- Die Lizenz-/Rechtsseiten-Bedienelemente erscheinen jetzt auch in 22 internationalen Sprachen in der gewählten Sprache, statt aufgrund eines späten Overrides wieder Englisch anzuzeigen.
- Die detaillierten rechtlichen Abschnitte liegen weiterhin auf Deutsch und Englisch vor. Alle 22 weiteren Sprachen erhalten einen klar übersetzten Hinweis auf diese englische Fassung.
- Regionale Sprachcodes `zh-HK` und `zh-MO` wählen traditionelles Chinesisch, `zh-SG` vereinfachtes Chinesisch.
- Neue Prüfroutinen testen alle 24 Sprachpakete, Schlüssel, Variablenplatzhalter, RTL (Arabisch), HTML-Seitenreferenzen und den produktiven Frontend-Build.
- `docs/TRANSLATIONS.md` dokumentiert Sprachen, Übersetzungsgrenzen und Qualitätsprüfung.

## Installation / Update

Das aktuelle vollständige Paket wie gewohnt über **Administration → Update-Center → Auf GitHub prüfen → Herunterladen & prüfen → Installieren** beziehen. Bei Neuinstallation `docs/INSTALLATION_DE.md` lesen. Vor Docker-Builds ausreichend freien Platz auf Docker- und Backup-Dateisystem sicherstellen (Planungsreserve 6–8 GB).

Vorhandene `.env`, `data/`, Kameradaten, Aufnahmen, Schlüssel und bestehende PHP-Portaldateien nicht löschen oder überschreiben.

## Nicht geändert

- go2rtc/FFmpeg, Livestreams und der stabile AAC-Pfad aus 2.20.99.
- Kamera-Discovery, PTZ, Aufnahme-Speicherorte und bestehende Medienbestände.
- Private PHP-Cloud-WebApp: weiterhin separate Installation 3.1.2.
- Bestehende Benutzerkonten, API-Zugänge und Video-Datenbank.

## Qualitätskontrolle

```bash
npm ci --prefix frontend --no-audit --no-fund
node --test frontend/src/i18n/*.test.mjs
node scripts/audit-locales.mjs
npm run build --prefix frontend
```

Die Tests prüfen strukturelle und bestimmte sprachliche Anforderungen. Die semantische Korrektur sämtlicher historischen 24-Sprachen-Texte benötigt zusätzlich fachliche und muttersprachliche Sichtprüfung.
