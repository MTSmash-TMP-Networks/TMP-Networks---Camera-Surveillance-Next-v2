# TMP Camera Surveillance Next 2.20.79

## Ressourcengesteuerter Kamera-Kaltstart

Der bisherige feste Begrenzer mit vier gleichzeitig laufenden Kamerastarts wird um eine konservative Kapazitaetssteuerung erweitert. Alle fuenf Sekunden werden die CPU-Last (Linux-Load geteilt durch CPU-Kerne) und der noch verfuegbare Arbeitsspeicher geprueft. Die Speicherpruefung begrenzt sich auf den **kleineren** freien Wert aus dem Host und dem Docker-Cgroup-Limit des Backend-Containers. Nur wenn CPU-Last und RAM ausreichend Reserven zeigen und weitere Kameras warten, waechst die gleichzeitige Startzahl schrittweise. Bei Last oder Speicherknappheit faellt sie auf den konfigurierten Grundwert zurueck.

Standardwerte: `STREAM_START_CONCURRENCY=4`, `STREAM_START_ADAPTIVE_ENABLED=true`, `STREAM_START_ADAPTIVE_MAX=8`. Bei vier verfuegbaren CPU-Kernen begrenzt das System die adaptive Kapazitaet zusaetzlich auf sechs. Das vorhandene Prioritaeten-, Fairness- und Aufnahmestartsystem bleibt aktiv. Bereits gestartete Kamera-Verbindungen werden beim Zurueckregeln nicht unterbrochen.

## Merken des letzten funktionierenden Kameraprofils

Nach `STREAM_READY` wird je Kamera ausschliesslich der bereits erfolgreich gepruefte ONVIF-Profil-Token und der Transporttyp in `system_settings` gespeichert. Keine RTSP-URL, keine Zugangsdaten. Beim folgenden Kaltstart wird dieses Profil (sofern es noch vorhanden ist) zuerst versucht, bevor andere Profile und die vollstaendige Fallback-Logik greifen. Dadurch entfallen gerade nach einem erfolgreichen manuellen/automatischen Fallback viele wiederholte unbrauchbare Erstversuche bei Backend-Neustarts.

## Fehlversuche und Ressourcen

Die gemeldeten 103 Fehlversuche zu 6 `STREAM_READY`-Ereignissen innerhalb von 30 Minuten werden **nicht** automatisch durch mehr Parallelitaet beseitigt. Die neue Startzahl kann die Wartezeit freier Kameras verbessern. Wenn go2rtc oder FFmpeg keine normalisierten Medienframes liefern, bleiben weitere Profile und Diagnosen notwendig; hier wird absichtlich keine fehlerhafte Quelle blind als bereit markiert.

## Upgrade

Kompatibles Upgrade ab 2.20.32. Vorhandene Aufnahmen, Kameraeinstellungen, Verschluesselung, Netzwerkkonfiguration und Kiosk-Raster bleiben erhalten. Der Updatevorgang laeuft wie bisher ueber das GUI. Die Einstellung `BACKEND_MEMORY_LIMIT` des Compose-Containers wird nicht automatisch angehoben; bei knappen 1,5 GiB bleiben zu Recht weniger parallele Starts zulaessig.
