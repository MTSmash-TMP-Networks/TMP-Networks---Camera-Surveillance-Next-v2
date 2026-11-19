# TMP Camera Surveillance Next 2.20.82

## Großansicht einer Kamera im Kioskmodus

Ein Klick auf eine beliebige belegte Kamerakachel öffnet ihr Livebild in einer großen Fokusansicht über dem unveränderten Kiosk-Raster. Auch Enter und Leertaste auf einer fokussierten Kachel öffnen die Ansicht. Mit Escape, dem großen Schließen-Button oben rechts oder einem Klick neben das vergrößerte Bild kehrt man zum Raster zurück. Das funktioniert sowohl im Browser als auch im Linux-/Electron-Kiosk sowie im Browser-Vollbildmodus.

Technisch bleibt die **bereits gemountete Kachel** bestehen und wird lediglich per CSS an die Vorderseite gelegt. Der gleiche `SeamlessLivePlayer` bleibt aktiv und verwendet den zentralen `liveStreamPool`. Dadurch gibt es **keinen zusätzlichen RTSP-/ONVIF-/FFmpeg-/go2rtc-Start**, keinen zweiten Player für dieselbe Kamera, keinen Kamera-Reconnect und keinen Wechsel der Kameraqualität. Die 2.20.81-Streamreparaturen bleiben unverändert.

Im vergrößerten Fenster wird das vollständige Kamerabild mit `object-fit:contain` sichtbar, statt Bildausschnitte zu beschneiden. Die vorhandenen Statussymbole für Bewegung und Aufzeichnung bleiben erhalten. Das Rasterlayout und seine serverweite Synchronisierung werden durch Öffnen oder Schließen nicht verändert.

## Upgrade

GUI-Upgrade ab 2.20.32 mit dem bestehenden Updatezentrum. Alle Kamera- und Aufnahmepläne, servergespeicherten Kiosk-Raster, Aufnahmen und Streamprofile bleiben erhalten. Es wurde ausschließlich Frontend-Darstellung und Bedienung ergänzt; Backend-Medienpfade sind nicht geändert.
