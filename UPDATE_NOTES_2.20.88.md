# TMP Camera Surveillance Next 2.20.88 – iPhone WebApp JSX Build Hotfix

## Fehlerursache des gescheiterten Updates
Das Update 2.20.87 wurde beim Frontend-Build mit `[builtin:vite-transform] Adjacent JSX elements must be wrapped in an enclosing tag` beendet, nachdem der neu hinzugefügte `{webAppUrl && ...}`-Bereich in `frontend/src/pages/SystemStatusPage.jsx` nicht mit `}` geschlossen wurde. Das Backend-Image wurde erfolgreich erstellt, das Frontend-Image jedoch nicht. Der Updater führte den automatischen Rollback auf 2.20.86 aus.

## Änderungen
- Die fehlende schließende JSX-Klammer unmittelbar vor „Portalstatus“ wurde ergänzt.
- Ein neuer Node-Regressionstest prüft den Abschluss der JSX-Bedingung; GitHub Actions führt ihn vor den bestehenden Frontend-Tests und dem produktiven Vite-Build aus.
- Die iPhone-WebApp-Verknüpfung mit der permanenten Installations-ID, „Link kopieren“ und „Öffnen“ bleibt vollständig erhalten.
- Version 2.20.88 ist in Backend, Frontend, Updater, Docker Compose, Lockfiles und Update-Paket einheitlich gesetzt.

## Installation
Nach einem erfolgreich durchlaufenen GitHub-Actions-Build in der lokalen Kamera-Software unter **Systemstatus → Updates → GitHub prüfen → Herunterladen & prüfen → Installieren** auf 2.20.88 aktualisieren. Bei einem Rollback auf 2.20.86 ist kein manuelles Zurücksetzen der Datenbank erforderlich.

## Sicherheit und Datenbestand
Keine Änderungen an `.env`, `data/`, Benutzerkonten, Kameraquellen, Aufnahmen und Kiosk. Das private Plesk-PHP-Portal 3.0.3 bleibt außerhalb des öffentlichen GitHub-Repositories und muss nicht erneut installiert werden.
