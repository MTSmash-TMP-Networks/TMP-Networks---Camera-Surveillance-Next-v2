# TMP Camera Surveillance Next 2.20.34

## GitHub-Update im Update-Center

- Neben dem manuellen ZIP-Upload kann die Administratoroberfläche den festgelegten offiziellen GitHub-main-Branch prüfen.
- Zeigt installierte und verfügbare Version sowie den festen Git-Commit an.
- Lädt den ZIP-Quellstand des geprüften Commits auf Anforderung herunter und führt den bestehenden Prüfprozess inklusive SHA-256-Dateimanifest, Versions- und ZIP-Sicherheitsprüfung aus.
- Installation erfolgt bewusst erst durch einen zweiten Klick über den bisherigen Updater mit Backup und Rollback.
- Kein `git pull`, keine Änderung an `.env` und `data/`, keine frei konfigurierbaren URLs.
- GitHub- oder Internet-Ausfälle beeinträchtigen den laufenden Kamerabetrieb nicht.

Hinweis: Öffentliche GitHub-Branch-Commits sind nicht kryptografisch signiert; vertraue der Repository-Schreibberechtigung.
