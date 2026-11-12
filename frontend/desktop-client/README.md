# TMP Camera Desktop – Linux Client

Eine eigenständige Desktop-Anwendung für einen bereits laufenden TMP Camera Surveillance Server; **kein Docker auf dem Arbeitsplatz nötig**.

## Installation (Linux x86_64)

1. Im Kamera-Webinterface unter **Desktop-Client** das ZIP herunterladen und entpacken.
2. In den entpackten Ordner wechseln und `sh ./install-linux.sh` ausführen (ohne `sudo`).
3. Im Anwendungsmenü **TMP Camera Desktop** öffnen, die Serveradresse (`http://SERVER-IP:8080` oder eine gültige HTTPS-Adresse) eingeben und sich anmelden.

**Node.js und npm müssen nicht vorher installiert werden.** Falls beides fehlt oder Node.js zu alt ist, installiert das Skript automatisch Node.js 24 LTS inklusive npm **im eigenen Benutzerverzeichnis** (`~/.local/share/tmp-camera-desktop/runtime/node`). Die Originaldatei wird über HTTPS von nodejs.org bezogen und anhand der veröffentlichten SHA-256-Prüfsumme geprüft. Das installierte Node.js wird nur für TMP Camera Desktop verwendet; die vorhandene Systeminstallation wird nicht verändert.

Das Skript lädt Electron beim ersten Installieren mit npm herunter. Es genehmigt aus Sicherheitsgründen ausschließlich das Installationsskript der festgelegten Version `electron@35.7.5` (`allowScripts` in `package.json`); andere Installationsskripte bleiben gesperrt. Wenn ein früherer npm-Lauf den Electron-Binärdownload ausgelassen hat, wird die Laufzeit gezielt nachinstalliert. Ein fehlendes Electron-Binary führt zu einer klaren Fehlermeldung statt einer fälschlichen Erfolgsmeldung. Internetzugriff für `nodejs.org`, das npm-Registry und den Electron-Binärdownload wird daher benötigt. Ggf. fehlende Systembibliotheken von Electron werden mit `ldd` erkannt und unter Ubuntu/Debian/Linux Mint **nach einer sudo-Passwortabfrage** via `apt-get` installiert. Andere Distributionen müssen solche Bibliotheken ggf. mit ihrer jeweiligen Paketverwaltung installieren. Es werden keine pauschalen System-Paket-Upgrades durchgeführt. Die normale Installation und Ausführung des Clients benötigt keine Root-Rechte.

Voraussetzungen: Linux x64 mit grafischem Desktop, tar, sha256sum und curl oder wget; Internet beim Erststart. Die Linux-Binärpakete benötigen eine aktuelle glibc. Auf Systemen mit deaktivierten unprivilegierten User-Namespaces kann der Electron-Sandbox-Start vom Betriebssystem blockiert werden. Den Sandbox-Schutz nicht ausschalten; die Desktop-Sicherheitskonfiguration anpassen.

## Besonderheiten

- Kein lokaler Docker-Stack und keine Änderung an den Kameraserver-Daten.
- Der Client benutzt die Serveranmeldung. TLS-Zertifikate werden weiterhin geprüft.
- Navigation bleibt auf den gewählten Server begrenzt, Electron-Sandbox und Context-Isolation bleiben eingeschaltet.
- Wechsel des Servers über **TMP Camera → Server wechseln** oder `Strg+Umschalt+S`.
- Falls `npm install` wegen Proxy oder Zertifikatsproblemen scheitert, Netzwerk/CA-Konfiguration des Arbeitsplatzes prüfen; keine unsicheren TLS-Ausnahmen setzen.
- Option `TMP_CAMERA_SKIP_SYSTEM_PACKAGES=1 sh ./install-linux.sh` unterbindet jede automatische Installation von Systembibliotheken.
