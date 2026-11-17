# TMP Camera Surveillance Next 2.20.62 – Kiosk-HLS-Recovery ohne Flackern

- Der Status "HLS-Puffer wird automatisch repariert …" erscheint nicht mehr unmittelbar bei einem voruebergehenden HLS/HTTP-Fehler, solange ein sichtbarer Kiosk-Player weiter Medienframes liefert.
- Die interne Reparatur darf zunaechst 6,5 Sekunden arbeiten. Erst wenn auch der Browser-Fortschritt fehlt und der Puffer unbrauchbar wird, erscheint die Meldung.
- Ein einzelner laufender Wiederherstellungs-Timer verhindert weitere Watchdog-Anforderungen alle 2,5 Sekunden. Der aeussere Eskalations-Timer ist mit 30 Sekunden laenger als der hls.js-Watchdog (25 Sekunden).
- Ein echter Bildstillstand kann weiterhin nach 15 Sekunden zusaetzlicher Reparaturdauer eine Player-Neuverbindung ausloesen. Verborgene/pausierte Player werden nicht neu gestartet, bloss weil ein Retry-Timer ablaeuft.
- Nichtfatale HLS-Buffer-Hole-Warnungen starten den Media-Loader nur bei fehlendem nutzbarem Puffer und hoechstens alle 12 Sekunden. Bereits gepufferte Segmente bleiben erhalten.
- Bei Media-Decoder-Recovery wird nicht mehr ohne Not zur Live-Kante gesprungen.
- Wiedergabe und Aufnahme nutzen weiterhin denselben zentralen Kamera-Publisher; Kiosk-Liveziel 8 Sekunden und Live-PTZ-Liveziel 3 Sekunden bleiben unveraendert.
- Regressionstests fuer Puffergrenzen, Stalls, versteckte Player und die Wiederherstellungs-Prioritaet wurden hinzugefuegt.
- Updatekompatibilitaet ab 2.20.32; keine Datenbankmigration, .env und Datenverzeichnisse bleiben erhalten.

Reale WLAN- und Kiosk-Dauertests bleiben vor abschliessender Stabilitaetsfreigabe notwendig.
