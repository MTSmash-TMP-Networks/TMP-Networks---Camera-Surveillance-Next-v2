# TMP Camera Surveillance Next 2.20.96 – Live-Ton in lokaler Liveansicht und HTTPS-Cloud

## Warum 2.20.95 noch stumm war
- Die lokale Liveansicht nutzte standardmaessig den gemeinsamen, video-only HLS-Vorschauring. Die Lautsprechertaste veraenderte nur `muted` des Players, aber forderte keine andere Medienquelle an.
- Die Statuszeile der lokalen Liveansicht meldete ungeachtet der Kamerafunktionen immer, dass Audio deaktiviert sei.
- Im Backend fehlte die Eigenschaft `audioEnabled` in der veroeffentlichten Stream-Session. Dadurch sah der Cloud-Audio-Endpunkt nur `undefined` und konnte dem privaten Plesk-Player auch bei vorhandener Audiospur nie ein gueltiges Audioergebnis liefern.
- Kameras mit fehlenden ONVIF-Audiometadaten wurden bisher bei der Erzeugung des optionalen Audiopfads uebergangen. Auch ein bereits laufender stummer Broker konnte nicht nachtraeglich um Audio ergaenzt werden.

## Technische Korrektur
1. **Audio nur auf Wunsch:** Eine eigene `live-audio`-Sitzung mit eigenem HLS-Ring, getrennt von den schnellen permanenten Video-Vorschaubildern und Kiosk.
2. **Video-Broker wiederverwenden:** Falls der go2rtc-Raw-/Videobroker bereits laeuft, wird der AAC-Zweig nachtraeglich hinzugefuegt, ohne den Videopfad zu loeschen.
3. **Echten Ton nachweisen:** `ffprobe` ueberprueft die fertigen, kleinen HLS-TS-Segmente auf einen AAC-Audiostream. Nur dann wird `audioEnabled=true` freigegeben.
4. **Cloud:** Der authentifizierte, bereits in 2.20.95 eingefuehrte POST-Endpunkt startet jetzt ausdruecklich `live-audio` und gibt die Medienfreigabe an Plesk PHP 3.1.1 weiter.
5. **Lokal:** Die Lautsprechertaste in der Liveansicht schaltet beim ersten Klick von der zentralen Vorschau auf die dedizierte Audiositzung um. Nach der Vorbereitung kann der Ton per erneutem Klick gestartet werden. Auf iPhone/Safari ist die zweite Benutzeraktion wegen Autoplay-Einschraenkungen besonders wichtig.
6. **Keine Audioquelle:** Der Player meldet den fehlenden AAC-Kanal und bietet eine Rueckkehr zur unveraenderten stummen Vorschau.
7. **Kamerwechsel:** Beginnt erneut mit ausgeschaltetem Ton.

## Installation
- Bestehende Plesk-`/cam/index.php` **Version 3.1.1 beibehalten**. Die private PHP-WebApp ohne Emojis wird nicht nach GitHub gepusht.
- Kamera-System ueber das GitHub-Updatecenter auf **2.20.96** aktualisieren.
- Eine Kamera mit sicher vorhandener Mikrofon-/Audiounterstuetzung oeffnen. In der lokalen Liveansicht die Lautsprechertaste antippen und nach dem Status `Audiokanal bereit` ein zweites Mal starten.
- In der Cloud-WebApp die vergoesserte Kamera oeffnen, dort `Ton einschalten` und bei Bedarf `Ton starten` waehlen.

## Sicherheits- und Qualitaetshinweise
- Die Cloud-Gegenstelle akzeptiert weiterhin ausschliesslich die gezielte, authentifizierte Audioanforderung `POST /api/streams/:id/cloud-audio`, keine allgemeinen Session-/Konfigurations-POSTs.
- Die Audio-Session teilt bei passendem Kameraprofil den bereits vorhandenen go2rtc-Raw-Producer, erzeugt jedoch fuer browsergerechtes AAC einen separaten Pfad auf Kundenwunsch.
- Unveraendert bleiben: MySQL und Kundensitzungen im Plesk-Portal, dauerhafte Kameraserver-IDs und Secrets, Originalaufnahmen/NAS, Kiosk und Standard-Live-Vorschau.
- Der Fix wurde gegen den Live-Code und die regressiven Session-/Audio-Tests geprueft. Ein echter Ende-zu-Ende-Test mit Audio-Kamera, Safari und produktivem Plesk kann nur nach Installation erfolgen.
