# TMP Camera Surveillance Next 2.20.89 – Zuverlaessiger Cloud-Medienrelay

## Fehlerbild
Eine Kamera-Installation registriert sich zwar automatisch beim HTTPS-Portal, doch bei vielen Kameras erscheinen keine Thumbnails oder Livevideos. Der Agent kann `The operation was aborted due to timeout` melden. Das bisherige PHP-Portal hielt fuer jede Kamera-Vorschau einen PHP-FPM-Worker fuer bis zu 16 Sekunden besetzt. Der Agent hatte gleichzeitig nur 12 Sekunden Poll-Timeout und versuchte bis zu 2,5-MB-Antworten als eine einzige Base64-POST-Anfrage zu senden.

## Kamera-Update 2.20.89
- Laengere Portal-Timeouts (25 Sekunden fuer Poll/Registrierung und bis 28 Sekunden fuer die Medienantwort).
- Bis zu 4 MiB Medien pro Job; ab 360 KB Base64 groessenbegrenzte, in der richtigen Reihenfolge ankommende `result-chunk`-Nachrichten (maximal 480 KB Base64 pro POST).
- Transiente Fehler mit kurzem Backoff erneut versuchen; Diagnose unterscheidet `POLL_` und `RESULT_`.
- Dauerhafte Installations-ID, Schluessel, Kameraliste, Aufnahmen und Konten bleiben erhalten.

## Zwingende Portal-Gegenstelle
Die private Plesk-PHP-Datei **3.0.5** gehoert nicht in das oeffentliche GitHub-Repository. Sie muss vor dem Kamera-Update unter `/cam/index.php` eingespielt werden. Sie liefert das `agent=result-chunk`-Protokoll und liest Vorschaubilder mit maximal zwei parallelen AJAX-Auftraegen, damit PHP-FPM nicht von vielen lang laufenden Vorschaubild-Abrufen blockiert wird.

## Installation
1. Plesk: bestehende PHP `/cam/index.php` durch die privat bereitgestellte Version 3.0.5 ersetzen. MySQL-Konfiguration und Registrierungen nicht loeschen.
2. Kamera-Server: Update 2.20.89 ueber das Systemstatus-Updatecenter herunterladen und installieren.
3. Cloud-Portal testen: Login, Kameraliste, Vorschaubilder; danach ein HLS-Livebild starten. Bei erneutem Fehler `docker compose logs --tail=120 backend` und Plesk PHP-FPM-Log pruefen.

## Grenzen
Eine einzelne HLS-Medienantwort groesser als 4 MiB wird weiterhin bewusst abgelehnt, damit PHP-FPM und MySQL nicht durch grosse unkontrollierte Uploads ueberlastet werden. Dieser Fix ist kein Ersatz fuer einen echten Streaming-Relay bei sehr vielen zeitgleichen Videozuschauern. Produktiver End-to-End-Test auf Plesk und dem Kamera-Host ist erforderlich.
