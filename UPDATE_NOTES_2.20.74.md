# TMP Camera Surveillance Next 2.20.74 – Autonomer Linux-Kiosk

## Fehlerursache
Der bisherige Electron-Client bettete die normale Webanmeldung ein. Das JWT mit einer Laufzeit von 8 Stunden wurde nicht im Hintergrund erneuert und beim Clientneustart ging die sessionStorage-Sitzung verloren. Folge: Wiederholte Abmeldung bei 24/7-Kioskmonitoren.

## Neu: Widerrufbare Gerätesitzung
- Im Linux-Client können Benutzer beim ersten Login ausdrücklich „Auf diesem Linux-Kiosk dauerhaft angemeldet bleiben“ aktivieren. Ohne diese Option bleibt die normale Web-Loginlogik gültig.
- Mit dieser Option legt das Backend nach erfolgreichem Benutzername/Passwort-Login eine dedizierte `desktop_sessions`-Zeile mit einem zufälligen 256-Bit-Geheimnis an; in der Datenbank wird nur dessen SHA-256-Hash gespeichert. Der Client erhält das Geheimnis als `HttpOnly`, `SameSite=Strict`-Cookie mit eng begrenztem Pfad `/api/auth/desktop`, Secure bei HTTPS.
- Der Cookie darf **nur** die drei Desktop-Session-Endpunkte autorisieren, niemals allgemeine Kamera-, Aufnahme-, PTZ- oder Admin-Aufrufe. Dort bleiben normale kurzlebige JWTs Pflicht. Das Gerät erneuert sein JWT alle 15 Minuten und nach Wiederkehr der Netzwerkverbindung; bei einem 401 wird höchstens einmal erneut mit dem frisch ausgestellten JWT versucht.
- Der Geräte-Grant läuft bei 90 Tagen Inaktivität ab, wird bei aktivem Kiosk jedoch sicher verlängert. Er ist auf 12 Geräte pro Benutzer begrenzt und durch explizite Abmeldung, Nutzerdeaktivierung oder Passwort-/Rollenänderungen widerrufbar.
- Die Authentifizierung der normalen Webanwendung bleibt unverändert. Der Desktop-Login erfordert aktives Einverständnis und ein gültiges Passwort; es gibt keinen hartkodierten Schlüssel und keine Passwortspeicherung im Electron-Konfigurationsverzeichnis.
- Bei echter Netzwerkstörung bleibt die Anmeldung erhalten. Bei echter serverseitiger 401-Widerrufsmeldung erscheint erneut das Login.

## Autonomer Linux-Client
- Electron erhält seine dauerhaft gespeicherte, durch Sandbox und Context-Isolation geschützte Chromium-Partition; Navigation nur innerhalb der festgelegten Server-Origin.
- Beim Start wird direkt die Kioskroute aufgerufen, mit `--kiosk` im Vollbild und Single-Instance-Lock.
- Bei Browser-/Netzwerk-/Server-Ausfällen versucht Electron die bestehende Serveradresse mit exponentieller Wartezeit bis maximal 30 Sekunden erneut, ohne den Login-Status lokal zu löschen.
- `install-linux.sh` richtet beim Linux-Desktop-Login den Autostart `~/.config/autostart/tmp-camera-kiosk.desktop` ein. `TMP_CAMERA_AUTOSTART=0 sh ./install-linux.sh` deaktiviert ihn.
- **Wichtig:** Ein Linux-System benötigt nach einem Reboot weiterhin ein angemeldetes grafisches Benutzerkonto. Für Geräte ohne Bediener kann der Administrator auf einem physisch gesicherten Gerät den Linux-Desktop-Autologin konfigurieren. Der Installer nimmt keine Änderung an System-Login, sudo, Display-Manager oder Electron-Sandbox vor.
- Das ZIP im Webinterface wurde mit dem aktuellen Client, Installationsskript und README neu erstellt.

## Tests und Kompatibilität
- Backend-Integrationstest: normale Anmeldung ohne Desktop-Cookie, Opt-in erforderlich, Same-Origin-POST, HttpOnly/SameSite, Token-Erneuerung, gespeicherte Hashes, Revoke, Passwortänderung, Cookie wird nicht als allgemeiner Bearer-Token akzeptiert.
- Nativer Frontend-Test: Electron-Sandbox, Origin-Beschränkung, nur eine Instanz, Kiosk-Autostart, Wiederverbindung, Gerätesitzung, expliziter Logout.
- Alle bisherigen 2.20.73-Kamera-, go2rtc-, Aufnahme-, Bewegungs- und Kiosk-Raster-Funktionen bleiben unverändert. Normales Update-Center, kompatibel ab 2.20.32; Datenbankmigration fügt nur die neue Desktop-Gerätetabelle hinzu.

## Nachinstallation
Im Kamera-Webinterface die aktualisierte Linux-ZIP herunterladen, auf dem Kiosk-PC entpacken und `sh ./install-linux.sh` ohne sudo ausführen. Die bisherige Serveradresse wird nicht gelöscht. Beim ersten neuen Login einmalig den neuen Gerätesession-Haken aktiv lassen. Linux kann bei Bedarf im grafischen Benutzerprofil auf automatisches Login gestellt werden. Nach einem Probelauf den Kiosk über mindestens 8 Stunden laufen lassen und kontrollieren, dass die Livebilder ohne erneute Anmeldung erhalten bleiben.
