# TMP Camera Desktop – Linux Client

Ein eigenständiges Desktop-Fenster für vorhandene TMP Camera Surveillance Server. Kein zusätzlicher Docker-Stack auf dem Arbeitsplatz.

## Installation (Linux x86_64)

1. ZIP aus der Weboberfläche unter **Desktop-Client** herunterladen und entpacken.
2. Auf dem Linux-Arbeitsplatz **Node.js 20+** und **npm** installieren.
3. `sh ./install-linux.sh` ausführen. Für die erste Installation ist Internetzugriff erforderlich, um Electron herunterzuladen.
4. Im Anwendungsmenü **TMP Camera Desktop** starten und die Serveradresse wie `http://SERVER-IP:8080` eintragen.
5. Mit den vorhandenen Benutzerkonten anmelden.

Das Installationsskript arbeitet ausschließlich im Benutzerverzeichnis. Es benötigt keine Root-Rechte und verändert nicht die Docker-Installation des Servers. Bei Self-Signed-HTTPS-Zertifikaten muss das Zertifikat regulär im System als vertrauenswürdig hinterlegt sein; der Client umgeht TLS-Prüfungen nicht.

## Besonderheiten

- Navigation bleibt auf die konfigurierte Server-Origin beschränkt.
- Kein Node.js-Zugriff aus der Kamera-Weboberfläche; Electron-Sandbox, Context-Isolation und gesperrte Browser-Berechtigungen.
- Kein direkter Zugriff des Clients auf Kamera-Credentials; Anmeldung erfolgt über den Server.
- Server wechseln über das Anwendungsmenü **TMP Camera → Server wechseln** oder `Strg+Umschalt+S`.
- Livevideo nutzt weiterhin den Serverstream. Auf Plattformen mit eingeschränkten Videocodecs kann HLS-Wiedergabe von der lokalen Electron-Distribution abhängen.
