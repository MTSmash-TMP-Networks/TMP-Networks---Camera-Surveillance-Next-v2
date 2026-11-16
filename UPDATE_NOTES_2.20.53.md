# TMP Camera Surveillance Next 2.20.53 – Serieller Kamera-Bootstrap ohne Start-Loops

- **Global statt nur pro Kamera serialisiert:** Bisher konnte jede Kamera ihren eigenen Start-Lock erhalten. Dadurch konnten mehrere verschiedene Kameras gleichzeitig RTSP-, go2rtc- und Local-HLS-Pfade öffnen. Jetzt gibt es systemweit nur einen aktiven Kamera-Verbindungsaufbau gleichzeitig.
- **Strikt nacheinander:** Beim Backend-Start wird Kamera 1 vollständig bis ready/failed abgearbeitet, danach folgt die konfigurierte Ruhepause, dann Kamera 2 usw.
- **Kein Timer-Stagger mehr:** `PERMANENT_CAMERA_INGEST_STARTUP_STAGGER_MS` ist jetzt eine Pause nach einem abgeschlossenen Kamera-Start und startet keine parallelen Timer mehr.
- **Automation erst nach Bootstrap:** Motion Detection und Recording Scheduler werden erst gestartet, nachdem alle permanenten Preview-Streams ihren ersten Aufbauversuch beendet haben.
- **Restart-Loops während Bootstrap gesperrt:** Scheitert eine permanente Kamera beim Erststart, wird ihr automatischer Restart bis nach dem kompletten seriellen Bootstrap zurückgestellt.
- **Problemkamera blockiert nicht alle anderen:** Ein fehlgeschlagener Stream wird nach dem ersten Durchlauf normal mit Backoff wieder versucht, kann aber nicht mehr mitten im Erstaufbau weitere Kamera-Starts überlagern.
- **Upgrade-Basis bleibt 2.20.32.**

Der Fix adressiert Logs, in denen mehrere Kameras nahezu zeitgleich `CAMERA_START_LOCK_ACQUIRED`, `PERMANENT_INGEST_CREATED`, Local-HLS-Starts und FFmpeg-Exits erzeugten, obwohl der Aufbau eigentlich nacheinander erfolgen sollte.
