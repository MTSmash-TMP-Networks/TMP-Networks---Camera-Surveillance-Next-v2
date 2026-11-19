# Version 2.20.85 – Automatische sichere Cloud-Anmeldung (ohne Kopplungscode)

Die Kamera-Installation erzeugt bereits beim ersten Backend-Start eine permanente UUID und einen zufaelligen, lokal verschluesselten Geraeteschluessel. Der neue HTTPS-Agent registriert sich bei `https://support.tmp-networks.de/cam/index.php?agent=register` selbststaendig (Protokoll 2). Eine manuelle Kopplung oder ein Portal-Einmalcode sind **nicht** mehr erforderlich.

## Benutzerablauf
1. Kameraserver installieren oder auf 2.20.85 aktualisieren. Automatische Registrierung startet selbststaendig, wenn das Backend seine Datenbank initialisiert hat.
2. Die eindeutige Server-ID bei Bedarf im lokalen Kamera-Systemstatus ablesen.
3. `https://support.tmp-networks.de/cam/` im Browser oeffnen.
4. **Server-ID, Benutzername und Passwort des jeweiligen Kameraservers** eingeben. Keine Serverliste, kein Portal-Passwort, kein Pairing-Code fuer Endnutzer.
5. Die bestehenden Kamera-Rollen und Tokens werden ausschliesslich vom jeweiligen Kameraserver validiert; das Portal leitet nur streng zugelassene Aufrufe weiter.

## Sicherheit und Admin
- Jedes Geraet registriert einen eigenen geheimen 256-Bit-Schluessel ueber HTTPS; in der privaten Plesk-MySQL-Datenbank wird nur SHA-256 des Schluessels zu einer UUID gespeichert.
- Vorhandene UUID + fremder Schluessel wird verweigert (409). Ein im Portal gesperrter Server kann sich nicht selbst freischalten (403).
- Der PHP-Portal-Admin kann eine Installation anzeigen und **vollstaendig sperren**, nicht aber Kopplungscodes vergeben. Die portalinterne Adminanmeldung bleibt getrennt.
- Ohne vertrauenswuerdige Erstanmeldung ist die Registrierung ein First-Claim-Modell: Die zufaellige UUID muss geheim bleiben bis zur initialen Registrierung, um gezielte Vorabbeanspruchung auszuschliessen. Bei hoeheren Anforderungen waere Geraeteattestierung oder administrative Freigabe erforderlich.
- Die lokale Software kann die ausgehende Verbindung weiterhin deaktivieren, falls gewuenscht.
- Kamera-WAN-Ports muessen nicht geoefnet werden; HTTP zum Frontend sollte nicht oeffentlich erreichbar sein.
- Private PHP/MySQL-Portaldateien und Geraeteschluessel werden **nicht** ins GitHub-Repository eingebracht.

## Betrieb
Die passende private PHP-Ein-Datei-Version 3.0 ist separat auf dem Plesk-Server zu installieren (bestehende config.php und tcc_* Tabellen bleiben erhalten). Erst dann funktioniert das automatische Registrierungsprotokoll. Alte Portale mit ausschließlich Einmalcode verweigern die Registrierung neuer Kameraserver.

Alle Media-/Encoder-/Kiosk-/Aufnahmefunktionen bleiben unveraendert. Kompatibles Upgrade ab 2.20.32.
