# TMP Camera Surveillance Next 2.20.59 – PTZ-Reaktionszeit

- Beim Oeffnen der PTZ-Steuerung werden ONVIF-Move- und Stop-Verbindungen im Hintergrund nacheinander vorgewaermt. Die Bedienoberflaeche wartet nicht auf diese Verbindungen; bei Warmup-Fehlern bleiben normale PTZ-Verbindungsversuche moeglich. Ueber PTZ_PREWARM_ENABLED=false abschaltbar.
- Gehaltene ContinuousMove-Befehle werden nur noch alle 700 statt 450 ms erneuert; der 1200-ms-Kamera-Timeout bleibt unveraendert. Stop besitzt weiterhin einen eigenen priorisierten ONVIF-Kanal, Interaktions-Fence und Recovery-Stop.
- Nur der interaktive Live-HLS-Player hat eine geringere Zielverzoegerung von 3 Sekunden. Beim PTZ-Bewegen wird ein deutlich zurueckliegender Live-Player vorsichtig zur Wiedergabekante gefuehrt, ohne HLS oder Kamera-Publisher neu aufzubauen.
- Kiosk-HLS behaelt seinen robusten 8-Sekunden-Abstand, den groesseren Puffer und die bisherige Recovery-Logik.
- Veraltete asynchrone Bewegungsantworten aendern nicht mehr den UI-Status nach einem erfolgreichen Stop.
- Kein Eingriff in RTSP/Video-Audio-Pipeline, Kameraprofile, Aufnahmen oder bestehende Kamera-Konfigurationen.
- Bestehende Updates bleiben ab 2.20.32 kompatibel; keine Migrationen, neue optionale Umgebungsvariable mit sicherem Standard.

Vor dem produktiven Dauereinsatz: PTZ-Bewegung/Stop bei gutem und schwachem WLAN, gleichzeitige Aufnahme und Kioskbild pruefen.
