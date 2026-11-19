# TMP Camera Surveillance Next 2.20.95 – Optionaler Live-Ton in der privaten Cloud

## Warum bisher kein Ton kam
Der dauerhaft vorbereitete zentrale HLS-Livevorschaupfad war absichtlich video-only, damit die Kacheln schnell starten und Kameras mit kaputten oder fehlenden Audiokanälen den Videostart nicht verzögern. Das bloße Entfernen des `muted`-Attributs am iPhone-Player kann daher keinen fehlenden Audiokanal ersetzen.

## Neue Funktionsweise
- Normale Live-Kameraübersicht, Vorschaubilder, Kiosk und das Livevideo ohne ausdrückliche Audio-Aktion bleiben unverändert schnell und stumm.
- Nach einem Tippen auf **Ton einschalten** fordert die PHP-WebApp beim Kameraserver eine separat gestartete Live-Sitzung mit hoher Qualitätsquelle und optionalem AAC-Audiokanal an.
- Der Kameraserver verwendet die bereits vorhandene Audio-Broker-Pipeline und liefert den geschützten HLS-Pfad. Audio und Video kommen synchron aus derselben HLS-Quelle, nicht aus zwei unverbundenen Playern.
- PHP speichert das zusätzliche, an die Kamera gebundene Medien-Token nur in der bestehenden geschützten PHP-Sitzung. Im Browser wird der Medienpfad ohne Token in der URL bereitgestellt.
- Safari kann die Wiedergabe mit Ton erst nach einer erneuten Benutzeraktion erlauben. Dafür steht im selben Schalter **Ton starten** bereit.
- Nach dem Ausschalten wird nur die Audiowiedergabe stummgeschaltet; die Videoübertragung bleibt erhalten. Beim Kamerwechsel oder Schließen ist die nächste Ansicht wieder stumm.
- Bei fehlender oder nicht funktionierender Audiospur zeigt PHP eine Textmeldung und behält die bestehende Videovorschau bei. Die verfügbare Audioquelle hängt vom Kameramodell und der ausgewählten ONVIF/RTSP-Quelle ab.

## Sicherheit
- Kameraserver-Update 2.20.95 erlaubt genau einen zusätzlichen schreibenden Proxy-Aufruf: `POST /api/streams/:id/cloud-audio`.
- Das ist nur ein authentifizierter Sitzungsstart für den aktuell angemeldeten Kamerabenutzer, keine Kamera- oder Systemkonfiguration.
- Der Portal-Aufruf verlangt zusätzlich ein CSRF-Token und verwendet die bisherigen Kameraserver-Zugangsdaten.
- HTTPS-Agent bleibt ausgehend, ohne zusätzliche Kamera-Ports.
- Keine Änderungen an NAS, bestehenden Aufnahmen, Cloud-Registrierungen, Kundenkonten oder bestehendem Plesk-MySQL-Schema.

## Installation
1. Privates Plesk-PHP-Paket 3.1.1 installieren, indem `/cam/index.php` ersetzt wird. Die PHP-Datei NICHT ins öffentliche GitHub hochladen. Externe `config.php` und MySQL-Datenbank bleiben bestehen.
2. Kameraserver auf 2.20.95 aktualisieren.
3. Cloud-WebApp am iPhone öffnen, Kamera vergrößern und **Ton einschalten** drücken.
4. Wenn Safari nach Aufbau stumm bleibt, auf **Ton starten** drücken. Bei Mikrofonlosigkeit wird eine entsprechende Meldung angezeigt.

## Prüfung
- PHP-Lint und Syntaxprüfung sämtlicher eingebetteter JavaScript-Module.
- Chromium-Oberflächentest bei 320, 375, 393, 768 und 1280 Pixeln (nur simulierte Backend-Antworten).
- Cloud-Proxy- und Backend-Routentest als CI-Regression ergänzt.
- Ein realer produktiver HLS-Audio-End-to-End-Test ist erst nach Installation auf dem Kundensystem möglich.
