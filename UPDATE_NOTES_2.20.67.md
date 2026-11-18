# TMP Camera Surveillance Next 2.20.67 – Voscam-ONVIF-Port 888

## Neu
- Automatische und manuelle Netzwerkerkennung pruefen den ONVIF-Port **TCP 888** fuer Voscam und andere Kameras, die ONVIF auf diesem Port anbieten.
- Der Port ist im vollstaendigen Portkatalog, primaeren Portscan und vorgeschalteten Host-Discovery-Pfad enthalten. Auch alte Installationen mit bisherigem DISCOVERY_HOST_DISCOVERY_PORTS in .env erhalten den neuen Port beim Hostscan zur Laufzeit, ohne individuelle .env zu ueberschreiben.
- Erkanntes TCP 888 wird per echtem ONVIF-SOAP-POST auf `/onvif/device_service` validiert. Eine generische Loginseite oder ein nur geoeffneter Port ist kein Kameranachweis.
- Kamera-Hinzufuegen verwendet den zurueckgelieferten ONVIF-XAddr/Port 888 unveraendert. RTSP/RTMP-Portgruppen bleiben getrennt.

## Kompatibilitaet
- Reguläres vollstaendiges Update ueber das vorhandene Update-Center ab Version 2.20.32.
- Keine Datenbank-, Kamera-, Passwort-, Aufnahme-, Motion-, go2rtc-, HLS-Puffer- oder Streamstart-Aenderung ausserhalb der ONVIF-Portsuche.
- Enthaelt die bisherigen Verbesserungen aus 2.20.65 (Compose V2 und go2rtc API) und 2.20.66 (zentrale Hintergrund-Vorschau).
- Backend-Container wird beim Update neu gestartet. Ein Wartungsfenster wird empfohlen, um laufende Aufnahmen nicht unnoetig zu unterbrechen.

## Kontrolle
Nach Installation: Voscam-Netzwerk oder Kamera-IP scannen, in den gefundenen Diensten TCP 888 pruefen und die ONVIF-Funktion mit der konfigurierten Kamera-Anmeldung testen. `onvifPort: 888` und ein bestaetigter ONVIF-Status sollten erscheinen, wenn der Dienst auf dem Endgeraet wirklich ONVIF-SOAP bereitstellt.
