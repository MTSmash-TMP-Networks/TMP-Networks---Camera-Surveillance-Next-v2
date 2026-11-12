# TMP Camera Surveillance Next 2.20.49 – Live-Ampel-Status synchronisiert

- **Ready gewinnt gegen alten Fehlerstatus:** Sobald eine Streamsession tatsächlich `ready` ist, wird ein veralteter Kamera-`stream_error` wieder auf `online` korrigiert.
- **Auch bei wiederverwendeten Sessions:** Der Status wird nicht mehr nur beim ersten Streamstart gesetzt, sondern auch bei erneutem `ensure` und beim Heartbeat einer bereits laufenden Session.
- **Runtime-Zustand in der Kamera-API:** Solange eine gesunde Ready-Session existiert, liefert die Kamera-API `online`, auch wenn die persistierte Datenbankzeile noch einen alten Fehlerstatus enthält.
- **Live-Liste merkt sich Grün:** Wenn der Browser tatsächlich Frames abspielt, wird der Kameraeintrag in Redux sofort auf `online` gesetzt. Beim Wechsel auf eine andere Kamera springt die vorherige Ampel dadurch nicht wieder auf Rot.
- **Leichter Status-Refresh:** Die Live-Kameraliste lädt alle fünf Sekunden den aktuellen Kamerastatus nach.
- **Sauberere Liveness-Prüfung:** `hasReady()` bewertet den tatsächlich lebenden Streamprozess bzw. die verwaltete Session statt nur einen alten Prozessverweis.

Ziel ist, dass die Ampel den echten Kamerazustand zeigt und nicht davon abhängt, welche Kamera gerade ausgewählt ist.
