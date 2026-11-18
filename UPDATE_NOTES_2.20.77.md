# TMP Camera Surveillance Next 2.20.77

## Gemeinsame Kiosk-Raster fuer Browser und Linux-Client

Die gespeicherten Kiosk-Raster und die aktive Rasterauswahl werden jetzt in der Server-Datenbank verwaltet. Browser und Linux-Electron-Client lesen denselben Zustand ueber die authentifizierte API `/api/kiosk/layouts` und aktualisieren ihre Ansicht im Abstand von fuenf Sekunden.

Einmalige Migration: Wenn es noch keine serverseitigen Kiosk-Einstellungen gibt, darf der erste Client seine bestehenden lokalen Raster importieren. Wenn ein anderer Client schneller war, gewinnt dessen bereits gespeicherte Revision; lokale Alt-Daten bleiben als Rueckfallkopie erhalten und werden nicht ungefragt mit dem zentralen Zustand gemischt.

Aenderungen sind nur mit mindestens Operator-Rechten moeglich. Konfliktkontrolle ueber erwartete Revision verhindert, dass alte Browser- oder Electron-Fenster neuere Servereinstellungen stillschweigend ueberschreiben. Raster werden auf maximal 30 Ansichten zu je 36 Kacheln begrenzt und serverseitig geprueft.

## Aufnahmeplaner startet unabhaengig vom Netzwerkspeicher

Nach der Wiederherstellung unterbrochener lokaler Aufnahmejournale starten Bewegungserkennung und Aufnahmeplaner **vor** dem Abgleich mit optionalem SMB-/SFTP-Aufnahmespeicher. Ein langsamer Netzwerkspeicher blockiert somit nicht mehr das Anlaufen der 24/7-Bewegungsaufnahmen. Der Abgleich und die Archivbereinigung erfolgen danach in der bisherigen sicheren Reihenfolge.

Bewegungsaufnahmen bleiben von Kiosk-Rastereinstellungen voellig unabhaengig. Vorhandene Aufnahmen, Kamerakonfiguration, Aufbewahrungsregeln und Streamprofile werden durch diesen Fix nicht veraendert.

## Upgrade

Kompatibel ab 2.20.32. `.env`, `data` und `.git` bleiben beim Update erhalten. Bestehende Electron-Clients erhalten die neue Synchronisierung nach dem Frontend-Update vom Server; der Electron-Client-Binary wird nicht ersetzt.
