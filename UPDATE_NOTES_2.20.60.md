# TMP Camera Surveillance Next 2.20.60 – Aufnahmen / Kiosk-Stabilitaet

- Der Blockscanner behandelt ENOENT beim parallelen Umbenennen einer FFmpeg-Teilaufnahme nach .ts als normalen Race statt als Fatalfehler.
- Der Aufnahme-Watchdog faengt Scan-/Dateisystemfehler ab, protokolliert wiederholte Fehler gedrosselt und laesst die bestehenden Recording-Stall-/Recovery-Regeln intakt.
- Watchdog-Finalisierungspruefungen werden bei einem laufenden Commit nicht staendig erneut in die Queue gestellt.
- Der Kiosk-Heartbeat liest die aktiven Aufnahmeinformationen direkt aus den bereits vorhandenen In-Memory-Aufnahmestatusdaten statt alle Segmente ueber SQL auszuwerten. Die vollstaendige Aufnahme-API bleibt unveraendert.
- Bei einzelnen fehlgeschlagenen Kiosk-Statusabfragen bleibt der zuletzt gueltige Status sichtbar; erst drei aufeinanderfolgende Fehler zeigen die Meldung. Der Abfrageabstand steigt geringfuegig von 2.5 auf 3.5 Sekunden, mit einer 5-Sekunden-Grenze pro Request.
- Regressionstests fuer atomare Dateiumbenennung und kurze API-Aussetzer.
- Kein Eingriff in die zentrale RTSP-/HLS-/Audio-Pipeline, den PTZ-Sicherheits-Stopp, Kameraeinstellungen, Datenbankmigrationen oder bestehende Aufnahme-Dateien.
- Upgradevertrag bleibt ab 2.20.32, .env und Datenverzeichnisse bleiben erhalten.

Wichtig: Dies behebt nachgewiesene Fehlergefahren im Code; ob ein konkreter Absturz durch OOM, Filesystem-I/O oder diese Race-Condition ausgeloest wurde, kann nur das Server-Journal zeigen.
