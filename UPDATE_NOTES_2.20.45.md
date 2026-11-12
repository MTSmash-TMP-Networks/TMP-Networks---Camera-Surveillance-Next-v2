# TMP Camera Surveillance Next 2.20.45 – Stabiler Kiosk-Stream

- **Kein Neuverbinden bei Layout-Resize:** Der Kiosk-Player reagiert nicht mehr mit Release/Acquire auf harmlose Größenänderungen seiner Kachel.
- **Stabile Streamauswahl:** Bei festen Qualitätsstufen wird eine feste Verbindungsbreite verwendet. Nur ein echter Qualitätswechsel kann einen anderen Streampfad anfordern.
- **Soft-Stalls bleiben unsichtbar:** Nicht-fatale hls.js-Pufferlöcher werden nicht mehr als sichtbare Recovery markiert und schieben den Playhead nicht mehr zur Live-Kante.
- **Puffer zuerst, Reconnect später:** Bereits gepufferte Videodaten laufen weiter. Erst fatale Netzwerk-/Medienfehler oder der langfristige Browser-Frame-Watchdog dürfen einen vollständigen Neuaufbau auslösen.
- **30-Sekunden-HLS-Ring bleibt aktiv:** Die Puffererweiterung aus 2.20.44 wird beibehalten.
- **Regressionstests aktualisiert:** Veraltete Annahmen zu WebRTC/LL-HLS und Browser-Prewarm wurden auf den aktuellen Local-HLS-Pfad angepasst.

Das Ziel des Updates ist, dass eine Kamera im Kioskmodus nach erfolgreichem Aufbau einfach weiterläuft und nicht wiederholt in „HLS-Puffer wird angepasst/repariert“ springt, solange tatsächlich noch Frames oder Puffer vorhanden sind.
