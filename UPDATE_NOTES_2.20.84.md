# TMP Camera Surveillance Next 2.20.84 — optionaler HTTPS-Proxy

## Konfiguration
Der Kamera-Administrator findet unter **Systemstatus → Sicherer HTTPS-Fernzugriff** eine dauerhaft in der vorhandenen SQLite-Datenbank gespeicherte **Installations-ID**. Jede Installation verwendet ihren eigenen, zufälligen Agentenschlüssel. Der optionale Relay-Agent bleibt bis zur manuellen Aktivierung ausgeschaltet.

Die Gegenstelle lautet `https://support.tmp-networks.de/cam/`. Die **private PHP-Portaldatei ist NICHT Teil dieses GitHub-Repositories oder des Kamera-Updatepakets**. Portalbetreiber stellen sie separat auf dem Webserver bereit und schützen Datenbank, PHP-Sitzungen und Administratorgeheimnisse außerhalb des Webroots.

### Kopplung
1. Portal-Administrator erzeugt einen auf zehn Minuten begrenzten Einmalcode.
2. Kamera-Administrator fügt den Code unter Systemstatus ein und aktiviert den HTTPS-Proxy.
3. Die Kamera-Installation registriert sich mit ID und individuell zufällig erzeugtem 256-Bit-Schlüssel. Der Schlüssel wird lokal im bestehenden AES-GCM-Credential-Vault verschlüsselt und liegt im Portal nur als SHA-256-Prüfwert vor.
4. Der Agent ruft über **ausgehendes HTTPS** ausschließlich freigegebene, begrenzte Leseanfragen und Logins ab. Keine Portweiterleitung zu Kamera oder Webfrontend nötig.
5. Portalnutzer authentifizieren sich mit ihrem jeweiligen Kamera-Server-Account; der Kameraserver bleibt maßgeblich für die Zugriffsrechte.

### Zugriffslimits und Sicherheit
- Kein Proxy auf beliebige Ziele (SSRF-geschützte Whitelist).
- Freigegeben: Login, Kameraliste, zentrale gespeicherte Thumbnails, zentraler HLS-Preview und seine Segmente. Nicht freigegeben: PTZ, Aufnahmesteuerung, Systemverwaltung, Update-Endpunkte, beliebige Aufnahmen oder HTML-Tunnel.
- HTTPS-Zertifikat muss gültig sein. Bei Proxy-Ausfall bleiben lokale Überwachung und Aufnahme aktiv.
- Optional: `HTTP_BIND_ADDRESS=127.0.0.1` in .env bindet das HTTP-Frontend an Loopback; danach ist es von anderen LAN-Geräten nicht mehr direkt erreichbar.
- Änderungen an URL, Port-Bindung oder Containerneuerstellung nur im Wartungsfenster anwenden.

### Hinweis zur Reife
Der private PHP-Relay-V1 ist ein einfacher HTTPS-Polling-Ansatz mit begrenzter Parallelität; **kein** produktionslastgetestetes Hochdurchsatz-Videorelay. Für viele gleichzeitige HLS-Viewer, WebSockets, WebRTC und große Archivdateien ist ein dedizierter asynchroner Relay-Dienst nötig.

Kompatibles Update ab 2.20.32. Vorhandene Kamerastreams, Aufnahmen, Aufnahmepläne, Kiosk-Raster und mobile lokale Routen bleiben unverändert.
