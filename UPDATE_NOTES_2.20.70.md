# TMP Camera Surveillance Next 2.20.70 – Reolink-Falschmeldungen vermeiden

## Ursache
Ein beliebiger Netzwerkhost mit offenen TCP-Ports 8443 (HTTPS) und 9000 wurde bisher aufgrund der Portkombination als angebliche Reolink-Netzwerkkamera markiert. Der tatsächliche ONVIF-/RTSP-Videodienst wurde dabei nicht nachgewiesen.

## Behebung
- Der bekannte Reolink-Port 9000 in Verbindung mit einem gewöhnlichen HTTPS- oder HTTP-Port allein wird nicht mehr als starke Kamerasignatur gewertet.
- Eine starke Reolink-Portsignatur mit TCP 9000 erfordert zusätzlich einen RTSP- oder RTMP-Port. Ein tatsächlich bestätigter ONVIF-/Hersteller-API-Endpunkt bleibt als unabhängiger Kameranachweis weiterhin gültig.
- Die abschließende Filterregel berechnet starke Portsignaturen stets anhand aktuell geöffneter Ports neu, sodass alte Suchergebnisse mit fälschlich hohem Erkennungswert nicht unbemerkt als Kamera weitergeführt werden.
- Die manuelle Suche leert ihre Ergebnisliste bei einem neuen Auftrag. Dadurch bleiben zuvor angezeigte Falschmeldungen nicht durch das Zusammenführen verschiedener Suchläufe bestehen.
- Regressionstests decken 8443+9000 ohne Videosignatur, echte RTSP-/RTMP-Kameras und bestätigte ONVIF-Dienste ab.

## Installation und Kompatibilität
Normales Update-Center ab Version 2.20.32, empfohlen im Wartungsfenster wegen regulärem Backend-/Frontend-Neustart. Keine Änderungen an .env, Datenbank, Kameraeinstellungen, Aufnahmen, Bewegungserkennung oder go2rtc. Alle Funktionen aus Version 2.20.69 bleiben erhalten.

## Kontrolle
Nach dem Update erneut die automatische Kamerasuche starten. Ein Host wie 192.168.0.180 mit ausschließlich TCP 8443 und 9000 ohne bestätigten ONVIF-/Hersteller-API-Dienst muss aus der Kameraliste verschwinden. Reale Reolink-Geräte mit bestätigten Mediendiensten oder ONVIF werden weiter angezeigt.
