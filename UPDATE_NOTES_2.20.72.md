# TMP Camera Surveillance Next v2.20.72 – keine wiederholten eingefrorenen Livebilder

## Fehlerbild
Bei unterbrochenen Kameraquellen kann ein Browser weiterhin alte HLS-Segmente abspielen und dabei 'playing', 'timeupdate' und neue dekodierte Frames melden. Diese Signale belegen ausschliesslich die Wiedergabe des Puffers, nicht frische Bilder von der Kamera. Im Snapshot-Notfallmodus konnte die letzte gueltige JPEG-Aufnahme ausserdem unbegrenzt zu angeblich frischen Videosegmenten neu kodiert werden.

## Korrektur
- hls.js beobachtet die wachsende Segmentnummer der aktiven Live-Playlist. Ein unveraenderter endSN ueber 30 Sekunden wird als veraltete Quelle gemeldet, auch wenn der Browser noch alte Bilder abspielt.
- Bei einem veralteten HLS-Ring kann weder 'playing' noch 'timeupdate' die Wiedergabe als wiederhergestellt deklarieren.
- Nur der aktive Browser-Player der betroffenen Kamera wird einmal pro 45 Sekunden kontrolliert neu verbunden. Andere Live- und Kiosk-Kameras sowie der zentrale Medienbroker bleiben unberuehrt.
- Snapshot-HLS kodiert ein letztes erfolgreich geladenes JPEG nur bis 15 Sekunden nach dem letzten tatsaechlichen Kameraabruf weiter. Danach wird kein falscher Medienfortschritt mehr erzeugt, sodass der vorhandene lokale HLS-Watchdog den stale Publisher nach der normalen Frist wiederherstellen kann.
- Statische Szenen ohne Bewegung bleiben gueltig, solange die Kamera tatsaechlich neue Videosegmente liefert. Nicht aktive/ausgeblendete Browser-Tiles werden nicht aggressiv neu gestartet.
- Native HLS-Sequenz-Regressionspruefungen und Snapshot-Expiry-Test.

## Betrieb
Keine Datenbank- oder .env-Aenderung. Der gepatchte go2rtc-Broker, zentrale Preview, Aufnahme, Motion, PTZ und Vier-Slot-Kaltstart aus v2.20.71 bleiben erhalten. Ein Neustart beim Update unterbricht Liveansicht und aktive Streams kurzfristig. Fuer den Nachtest im Frontend auf 'HLS_SOURCE_SEQUENCE_STALLED' und im Backend auf 'STREAM_STALLED' achten.
