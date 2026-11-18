# TMP Camera Surveillance Next 2.20.76

## Aufnahmeplanung zentral übertragen

Im Menü **Aufnahmen → Aufnahmeplan & Aufbewahrung** dient die ausgewählte Kamera als Vorlage. Die neue Aktion **Auf alle Kameras anwenden** kopiert die gerade bearbeiteten Aufnahmepläne nach einer ausdrücklichen Sicherheitsbestätigung auf sämtliche vorhandenen Kameras. Die bestehende Einzelkamera-Auswahl bleibt erhalten. Ein Fehler führt zu einem vollständigen Rollback der Datenbankänderungen; es entstehen keine halb konfigurierten Kamera-Gruppen.

**Aufbewahrung optional:** Die Checkbox „Aufbewahrung und automatische Bereinigung ebenfalls übernehmen“ ist zunächst deaktiviert. Ohne diese Auswahl bleiben sämtliche individuellen Speicher- und Löschrichtlinien der Kameras unverändert.

Kopierte Aufnahmepläne bekommen je Kamera neue IDs. Kamera-spezifische ONVIF-Profil-IDs aus der Vorlage werden nicht übertragen. Bestehende Aufnahmedateien, manuelle Aufnahmen und andere Medienpfade werden durch die Konfigurationsübernahme nicht gelöscht.

## 24-Stunden-Aufnahmezeitraum

Geplante und ereignisgesteuerte Pläne bieten im Bereich „Von/Bis“ die Wahl **24 Stunden (ganztägig an den ausgewählten Tagen)**. Dafür werden Start und Ende intern gleich `00:00` gesetzt. Die vorhandene Scheduler-Semantik interpretiert gleiche Zeiten bereits als einen ganzen lokalen Kalendertag. Wochentage, Ausschlusstage und Feiertagsregeln bleiben weiterhin wirksam. Zum Bearbeiten eigener Zeitfenster kann die Option ausgeschaltet werden (Standard `00:00–23:59`).

## Update & Kompatibilität

Direktupgrade ab 2.20.32. Das Update erhält `.env`, `data` und `.git`, die einzelnen Kamera- und Aufnahmeeinstellungen sowie die Aufnahmearchive. Der Wechsel erfolgt nur bei explizitem Speichern. Backend- und Frontend-Regressionstests prüfen den 24-Stunden-Kalender, die globale Übertragung, Rollback und die Bestätigungsoberfläche.
