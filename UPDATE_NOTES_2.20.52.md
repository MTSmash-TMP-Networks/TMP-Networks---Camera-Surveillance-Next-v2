# TMP Camera Surveillance Next 2.20.52 – Linux-Desktop-Installer robuster gemacht

- **Electron-Fallback ergänzt:** Wenn npm bzw. `npm rebuild electron` Erfolg meldet, aber `dist/electron` oder `path.txt` trotzdem fehlen, bricht die Installation nicht mehr sofort ab.
- **Offizieller Direktdownload:** Der Installer lädt in diesem Fall Electron 35.7.5 direkt aus dem offiziellen Electron-Release.
- **SHA-256-Prüfung:** Vor dem Entpacken wird die veröffentlichte `SHASUMS256.txt` geladen und das Electron-ZIP geprüft.
- **Unabhängiges Entpacken:** Das geprüfte Archiv wird mit `unzip` oder alternativ `python3` entpackt und umgeht damit fehlerhafte npm-/Node-Postinstall-Extraktionen.
- **path.txt kontrolliert erzeugt:** Erst nach erfolgreicher Extraktion wird der Electron-Pfadmarker geschrieben und die Binary erneut geprüft.
- **Download-Paket aktualisiert:** Die im Webinterface angebotene Linux-Desktop-ZIP enthält den neuen Installer und Desktop-Client 2.20.52.
- **CI erweitert:** Der Desktop-Client-Distributions- und Installer-Test läuft jetzt im Cross-Version-Workflow mit.
- **Upgrade-Basis bleibt 2.20.32.**

Der Fix zielt genau auf Installationen, bei denen npm einen erfolgreichen Rebuild meldet, Electron danach aber trotzdem nicht startbereit ist.
