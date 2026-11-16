# TMP Camera Surveillance Next 2.20.61 - CPU-Last bei Motion und Aufnahmen

- Motion-Frames werden bevorzugt aus dem jeweils neuesten vollstaendig geschriebenen lokalen HLS-Segment des bereits laufenden Backend-Preview-Streams gelesen. Das verhindert eine neue go2rtc-/RTSP-Reader-Verbindung fuer jedes Vergleichsbild.
- Nur regulaere, frische, ausreichend grosse MPEG-TS-Segmente aus der index.m3u8-Playlist sind zulaessig; fehlende/rotierte/alte Segmente fuehren automatisch zum bestehenden Live-RTSP/HLS-Pfad. Der explizite RTSP-only-Diagnosemodus bleibt unangetastet.
- Decoder fuer einzelne Motion-Bilder laufen mit je einem FFmpeg-/Filterthread, um Lastspitzen der Bildauswertung zu reduzieren. Motion-Intervall, Vergleichsalgorithmus, Zonen und PTZ-Unterdrueckung bleiben erhalten.
- Die bislang ungenutzte Konfigurationsoption RECORDING_COMPRESSION_PAUSE_WHILE_RECORDING ist jetzt im Komprimierungsworker verdrahtet; als neuer Standard gilt true. Ein bereits konvertierender Offline-FFmpeg wird bei laufender Aufnahme oder hoher Systemlast kontrolliert angehalten und spaeter fortgesetzt.
- Bestehende .env-Dateien mit ausdruecklich RECORDING_COMPRESSION_PAUSE_WHILE_RECORDING=false behalten aus Kompatibilitaetsgruenden diesen Wert: dort bitte fuer Live-Priorisierung auf true setzen.
- MOTION_PREFER_LOCAL_HLS=true ist neuer Standard und kann bei Problemen explizit auf false gesetzt werden.
- Die eigentliche Aufnahme bleibt ohne H.264-Neukodierung (-c:v copy) und mit Audio-Kopie; Aufnahmequalitaet, Kamera-Profile, Snapshot-Notfallweg und Kiosk-Puffer bleiben unveraendert.
- Abwaertskompatibilitaet ab 2.20.32, keine Datenbankmigration, keine Aenderung an gespeicherten Aufnahme-Dateien.

Reale CPU-, WLAN- und Bewegungs-/Aufnahmetests sind vor endgueltiger Produktionsfreigabe erforderlich.

## Hotfix: Kiosk + Bewegung/Aufnahmen / VM-Speicherschutz

- Backend und go2rtc erhalten konfigurierbare Docker-cgroup-Speichergrenzen (standardmaessig 1024m und 768m). Ein ueberlaufender Medienprozess kann dadurch den einzelnen Container neu starten, statt den Arbeitsspeicher der gesamten VM aufzubrauchen. Bei groesseren Installationen Werte in .env bewusst anpassen.
- Der optionale AAC-Audiopfad kopiert bei H.264-Kameras das Video, statt eine zweite libx264-Pipeline zu starten. Ton bleibt erhalten; andere Codecs behalten ihren bisherigen Fallback.
- Beim Start bereinigt das Backend verwaiste, ausschliesslich von der App verwaltete go2rtc-Kamerastreams nach unerwarteten Neustarts, bevor neue Publisher angelegt werden.
- Motion uebernimmt die vorhandene zentrale Low-Publisher-Sitzung, sobald sie bereit ist, statt einen frueher gestarteten eigenen motion_low-Publisher dauerhaft festzuhalten.
- Freigegebene Motion-/Prebuffer-Publisher erhalten eine kurze Ablaufzeit, Broker-Raw-Quellen werden erst geloescht, wenn wirklich keine weiteren Encoder-Varianten sie nutzen.
- Wartungszyklen duerfen bei stockenden Netzwerkanfragen nicht ueberlappen.
