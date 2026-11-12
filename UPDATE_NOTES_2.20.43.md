# TMP Camera Surveillance Next 2.20.43 – Reolink ONVIF auf TCP 8000

- **Automatische Kameraerkennung:** Ein offener Port 8000 wird nicht mehr nur als Hersteller-SDK erkannt. Die Suche prueft dort auch gezielt den SOAP-ONVIF-Gerätedienst `/onvif/device_service`.
- **ONVIF-Beweis statt Port-Vermutung:** Nur strukturierte SOAP-/ONVIF-Antworten oder kameratypische HTTP-Authentifizierungsaufforderungen zaehlen. Ein offener Port 8000, ein generischer Login oder ein Hikvision-SDK ohne ONVIF-Antwort reichen nicht.
- **Neue Reolink-Modelle:** Ein bestaetigter Port 8000 wird als ONVIF-Ziel mit der tatsaechlichen XAddr an die Kameraeinrichtung uebergeben. Bei bekannten Reolink-Geräten steht Port 8000 auch dann als authentifizierter ONVIF-Kandidat bereit, wenn alte Scan-Ergebnisse ihn ausgelassen haben.
- **Manuelle Kameraeinrichtung:** Neues optionales Feld fuer den ONVIF-Port (0/leer = automatisch). Damit sind ONVIF 80, 8080 und 8000 direkt nutzbar, ohne die Kameraports am Geraet zu verstellen.
- **Bestehende Hersteller:** Die vorhandene Hikvision/Uniview-SDK-Erkennung auf TCP 8000 bleibt erhalten; eine pauschale Web-Port-Klassifikation wird bewusst vermieden.
- **Datensicherheit und Versionskompatibilitaet:** Vollstaendiges Update ab 2.20.32 (Paketannahme), bewahrte Pfade, `.env`, `.git` und `data/` werden nicht ueberschrieben. Docker-Dienste werden fuer die Aktualisierung neu gestartet, wodurch Livebilder kurz unterbrochen werden koennen.

Die Erkennung wurde in lokalen Regressionstests gegen simulierte ONVIF-Antworten geprueft. Ein realer Test mit den neuen Reolink-Modellen muss nach Installation erfolgen.
