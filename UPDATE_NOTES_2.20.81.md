# TMP Camera Surveillance Next 2.20.81

## Gezielt nachgewiesene H.264-Mediendefekte behandeln

Die Diagnosen aus Version 2.20.80 zeigen bei einem Teil der Kameras fehlende H.264-PPS-Daten (non-existing PPS 0 referenced), bei anderen HLS-TS-Pakete mit Dauer 0. Das bisherige generelle Verbot von Encoder-Retries bei PROFILE_MEDIA_TIMEOUT verhinderte selbst dann eine Reparatur, wenn die Kamera Daten sendete, der H.264-Copy-Pfad aber kaputte Paketinformationen weiterreichte.

Der Kopiermodus darf jetzt **nur bei nachgewiesenen Bitstream-/Zeitstempelfehlern** in den vorhandenen VAAPI- oder Software-Fallback wechseln. Ein allgemeiner Timeout, End of file, ein leerer go2rtc-Producer oder fehlender Fortschritt genügt nicht. Damit vermeiden wir die zusätzlichen Encoderstarts, die zuvor zum minutenlangen Bootstrap beigetragen haben. Beim schnellen ersten Bootstrap bleibt wie bisher der aufwändige Mehrfach-Fallback deaktiviert; er wird nur in der zweiten Wiederaufbauphase geprüft.

## Diagnoselog repariert

FFMPEG_EXIT wird nun im Docker-Log als echter Ereigniscode ausgegeben und nicht versehentlich vom numerischen Exitcode überschrieben. Der Prozess-Exitcode steht separat als exitCode bereit. Die Kamera-Ereignisprotokolle bleiben konsistent.

## Sicherheit und Upgrade

Keine Änderung an Netzwerk-URLs, Zugangsdaten, Kameraaufnahmeplänen, Medienarchiven oder der Anzahl gleichzeitig gestarteter Kameras. Keine globale Erhöhung von Timeouts. Kompatibles Upgrade ab 2.20.32. Der Fix behebt nur die genannten Fehlerklassen; ausgefallene Kameras, fehlende Frames und allgemeines EOF erfordern weiterhin eigene Diagnose.
