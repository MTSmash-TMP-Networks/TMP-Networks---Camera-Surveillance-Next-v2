# TMP Camera Surveillance Next 2.20.41 - Direktupdate ab 2.20.32

- **Von niedrigeren Versionen direkt aktualisieren:** Ab dem getesteten Grundstand 2.20.32 ist keine Folgeinstallation jeder Zwischenversion erforderlich.
- **Root-Pfad-Kompatibilitaet:** Der bisherige root-Ordner `desktop-client/` wird zu `frontend/desktop-client/` verschoben. So kann auch ein alter Update-Dienst das unveraenderte GitHub-Quellarchiv inspizieren.
- **Unveraenderter Benutzerdownload:** Der Linux-Client bleibt ueber den vorhandenen Download-Button im Frontend erreichbar.
- **Release-Guard:** Der Kompatibilitaetscheck prueft Mindestversion, geschuetzte Dateien, Legacy-Root-Allowlist, Dateilisten, SHA-256 und Versionskonsistenz. In GitHub Actions vor jedem neuen Commit auf main oder Pull Request pruefbar.
- **Datensicherheit:** `.env`, `data/` und `.git` bleiben von der installierenden Synchronisation ausgeschlossen, inklusive Kamera-Aufnahmen und Konfigurationen. Sicherung/Rollback erfolgen wie bisher.
- **Grenze:** Sehr alte Systeme vor 2.20.32 sowie funktional inkompatible Host- oder DB-Staende benoetigen eine gepruefte Bridge-Migration. Kein blindes Ignorieren der Mindestversion.

Hinweis: Legacy-Inspector- und Regressionstests pruefen die Paketannahme. Ein realer Multi-Versionen-Docker-Upgrade-Test muss auf entsprechenden Referenzinstallationen erfolgen.
