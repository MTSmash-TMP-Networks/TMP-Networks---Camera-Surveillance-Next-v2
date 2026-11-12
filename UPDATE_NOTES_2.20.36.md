# TMP Camera Surveillance Next 2.20.36 — Camera setup and GitHub update reliability

## Behobene Fehler

- **Kamera hinzufügen:** ONVIF-/Scan-Metadaten werden beim Speichern in den zulässigen Grenzen aufbereitet. Profil-Token, Zugangsdaten und Stream-Adressen bleiben unverändert. Die Fehlermeldung zeigt jetzt das konkrete fehlerhafte Eingabefeld statt nur „Eingaben sind ungueltig“.
- **GitHub Update-Center:** Release-Dateiliste und GitHub-Repository werden exakt aufeinander abgestimmt. `.env.example` und `.gitignore` sind im GitHub-Quellarchiv enthalten, eine nicht zum Update gehörende zusätzliche Datei wird entfernt. Das reguläre SHA-256-Prüfsummenverfahren bleibt zwingend.
- GitHub-Fehler melden unterscheidbar DNS-/Netzwerkprobleme, Zeitüberschreitungen, TLS-Fehler und API-Limits. Ein unvollständiges Quellarchiv erhält einen eigenen Fehlercode.
- Regressionstests für den Kamera-Assistenten und die GitHub-Archiv-Vollständigkeit.

## Aktualisierung

Das reguläre ZIP über Administration → Update-Center installieren. Das Paket übernimmt die bestehenden `.env`-Einstellungen und `data/`-Aufnahmen und verwendet den vorhandenen Backup-/Rollback-Ablauf. Danach kann wieder direkt über GitHub aktualisiert werden.

Das GitHub-Quellarchiv ist keine alternative Installationsroutine, sondern wird von der unveränderten Paket-Validierung geprüft.
