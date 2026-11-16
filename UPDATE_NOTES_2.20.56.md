# TMP Camera Surveillance Next 2.20.56 – Central Preview Read-Only

- **Eine Kamera = ein zentraler Backend-Publisher:** Der permanente Preview-/Substream wird ausschließlich vom Backend aufgebaut und verwaltet.
- **Kiosk und Live-Auto sind reine Leser:** Beide verwenden den read-only Endpunkt `GET /streams/:id/preview` und können keinen Kamera-Start oder Restart mehr auslösen.
- **Kein Browser-Prewarm mehr:** Kamera-Anlegen und AppShell starten keine versteckten Browserstreams mehr.
- **Ein Browser-Key pro Kamera:** Kiosk nutzt unabhängig von Tile-Größe und UI-Qualität denselben zentralen Preview-Key.
- **Kiosk-Qualität backend-owned:** Der bisherige Qualitätswahlschalter wurde entfernt; Kiosk greift immer auf den zentralen Preview zu.
- **Kein sichtbares Flattern bei Backend-Recovery:** Der Browserplayer bleibt bestehen und wartet auf den serverseitigen Publisher, statt wegen Backendstatus aggressiv neu verbunden zu werden.
- **Backend repariert fehlende Publisher selbst:** Der Wartungszyklus stellt fehlende permanente Publisher serverseitig wieder her und nutzt dabei die globale Kamera-Warteschlange.
- **Ampel entspricht dem zentralen Stream:** Grün bedeutet jetzt, dass der zentrale Preview-Publisher inklusive Local-HLS wirklich ready ist.
- **Upgrade-Basis bleibt 2.20.32.**

Damit ist der Kamera-Lifecycle vom Frontend getrennt: Start, Profilwahl, Encoder-Fallback, Restart und Recovery gehören dem Backend; Kiosk/Live-Auto lesen nur noch den bereits bereitgestellten Stream.
