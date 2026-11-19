# TMP Camera Surveillance Next 2.20.83

## Smartphone-optimierte Online-Oberfläche
Smartphones erhalten nach der normalen Anmeldung automatisch die eigenständige, geschützte Route `/mobile` mit eigener Navigation und responsivem Layout. Die Geräteerkennung beruht auf Smartphone-/Tablet-Merkmalen; ein lediglich schmales Desktop-Browserfenster wird nicht umgeschaltet. Der Linux-Kiosk mit dauerhaftem Desktop-Grant wird niemals umgeleitet. Die Entscheidung betrifft ausschließlich das Webfrontend; es werden keine Backendrollen oder Rechte verändert.

### Mobile Routen
- `/mobile`: Touch-optimierte Kameraübersicht, Gerätesuche, Online-/Offline-Status und zentrale servergespeicherte JPEG-Vorschaubilder (60-Sekunden-Aktualisierung). **Keine 26 parallel laufenden mobilen Videoplayer.**
- `/mobile/cameras/:id`: Eine Kamera als HLS-Livevideo in reduzierter Vorschauqualität (ein einzelner zentraler gepoolter Player, keine direkte Kamera-RTSP-Verbindung). Schnappschussfunktion und Kameradaten.
- `/mobile/recordings`: Bestehende Aufnahmen mit Kamerafilter und geschützter HLS-/Datei-Wiedergabe über die aktuellen Aufnahme-Endpunkte. Keine mobile Änderung der Aufnahmeplanung.
- `/mobile/more`: Kontoübersicht, Abmeldung und Wechsel zur vollständigen Desktopansicht.

Die permanente Navigation am unteren Bildschirmrand berücksichtigt iOS-/Android-Safe-Areas und ausreichend große Touch-Ziele. Das mobile Login blendet die breite Desktop-Grafik aus und ist für die Tastatureingabe auf kleinen Displays optimiert.

### Schutz bestehender Systeme
- Die Desktop-Routen `/`, `/live`, `/recordings` und `/kiosk` bleiben erhalten.
- Bestehende Benutzer-/JWT-Sitzungsprüfung, Berechtigungen und APIs werden unverändert verwendet.
- Mobile Vorschaubilder stammen aus dem zentralen Kamera-Thumbnail-Cache. Nur die gezielt geöffnete Kamera aktiviert einen Frontend-Videoplayer, der den stabilisierten zentralen HLS-Ring verwendet.
- Keine Änderungen am Backend, go2rtc, FFmpeg, Aufnahmearchiv, Aufnahmeplänen oder an den gespeicherten Kiosk-Rastern. Die stabilen Streamoptimierungen von 2.20.81 bleiben intakt.
- Die manuell gewählte Desktopansicht wird für den aktuellen Browser-Tab gespeichert. Der Nutzer kann über die mobile Route jederzeit wieder umschalten.

## Upgrade und Tests
Kompatibler Updateweg ab 2.20.32. Neue Regressionstests überprüfen Geräteerkennung, Anmeldungsweiterleitung, geschützte mobile Routen, zentrale Thumbnails und den ausschließlich bedarfsorientierten Live-Player.
