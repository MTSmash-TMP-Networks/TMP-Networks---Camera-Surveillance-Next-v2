# TMP Camera Surveillance Next 2.20.78

## Schnellere Kamera-Kaltstarts

Der gemeinsame Kamera-Verbindungsbegrenzer verwendet jetzt Prioritaeten: Aktive Aufnahmestarts (hoechste Prioritaet), erste Vorschau-/Motion-Verbindungen und erst danach vollstaendige Wiederaufbauversuche. Ein Wiederaufbau, der lange wartet, erhaelt schrittweise mehr Prioritaet, sodass keine Kamera dauerhaft verhungert. Das Limit von maximal vier parallelen Startvorgaengen bleibt unveraendert und kann weiter ueber STREAM_START_CONCURRENCY konfiguriert werden.

Permanente zentrale Vorschauen benoetigen keinen Audiostream. 2.20.78 ueberspringt dafuer die bisherige erste Audio-Variante und spart bei defekten/incompatiblen Audioprofilen einen kompletten Startwartezyklus; Video und Aufnahmen bleiben getrennt.

## Diagnose

CAMERA_START_QUEUED protokolliert jetzt die Prioritaet, ob es sich um einen Wiederaufbau handelt, sowie aktuelle Warteschlangenauslastung. CAMERA_START_TIMING enthaelt weiterhin Wartezeit und tatsaechliche Startdauer. Diese Felder unterscheiden ueberlastete Startplaetze von langsamen ONVIF-/RTSP-/Encoder-Kameraverbindungen.

## Upgrade

Kompatibel mit bestehenden Installationen ab 2.20.32. Keine Aenderung an Kamera-IP, RTSP-Profil, Aufnahmeplan, Bewegungserkennung, Aufnahmedateien oder per-Client-Kiosk-Konfiguration. Die Fehlerbehebung erfordert einen Backend-Neustart im regulaeren Updateprozess.
