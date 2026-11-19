# TMP Camera Surveillance Next 2.20.87 – iPhone-WebApp-Link pro Installation

## Funktion im Kamera-Server
Unter Systemstatus → Sicherer HTTPS-Fernzugriff erscheint bei vorhandener Installations-ID ein individueller HTTPS-Link:
`https://support.tmp-networks.de/cam/index.php?server=<UUID>`

Der Benutzer kann ihn kopieren, direkt öffnen oder auf ein iPhone übertragen. Die ID wird geprüft. Im Link stehen keine Passwörter, Zugangstokens oder Gerätegeheimnisse.

## iPhone-WebApp
Die separat bereitzustellende private Plesk-PHP-Portaldatei 3.0.3 bindet ein dynamisches Manifest sowie Apple-WebApp-Metadaten ein. Die Server-ID bleibt in der Startadresse erhalten, auch nach Abmeldung und fehlgeschlagenem Login. Bei einem neuen Aufruf für eine andere Server-ID wird eine vorherige Kamera-Sitzung getrennt, damit keine falsche Kamera angezeigt wird.

Safari auf dem iPhone: Link öffnen → Teilen → Zum Home-Bildschirm → Als Web-App öffnen (falls angeboten) → Hinzufügen. Nach dem Öffnen die normalen Zugangsdaten des jeweiligen Kamera-Servers eingeben. Ein fehlender Portal-Login bleibt weiterhin geschützt.

## Deployment
Das 2.20.87 Kamera-Update kann ab 2.20.32 installiert werden. Frontend- und Backend-Images sollten konsistent neu erstellt werden. Das private PHP-Portal bleibt außerhalb des GitHub-Repositories und muss gesondert als `/cam/index.php` auf Plesk ersetzt werden.

## Datenschutz und Sicherheit
Die UUID im Link ist eine sichtbare Installationsreferenz und kein Berechtigungsnachweis. Der Kameraserver validiert jeden Login weiterhin selbst. HTTPS ist erforderlich. Externe PHP-Portale oder bestehende Installationen werden nicht ohne separates Plesk-Deployment aktualisiert. Aufnahmen, Kameradaten, Administratoren und Cloud-Geräteschlüssel bleiben erhalten.
