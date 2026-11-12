# TMP Camera Surveillance Next 2.20.40 - Intel N97 CPU-Last optimieren

- **H.264 Copy-first:** Korrekt kodierte H.264-Quellen werden ohne erneute Videokodierung an den zentralen go2rtc-HLS-Pfad weitergegeben (`#video=copy`).
- **Codec-Sicherheitscheck:** Die erste erzeugte HLS-MPEG-TS-Datei wird per ffprobe kontrolliert. Stimmt der Codec nicht, wird das Profil ueber VAAPI bzw. Software kodiert.
- **Profilgebundener Fallback:** Der Ausfall einer Kamera oder VAAPI-Sitzung schaltet nicht mehr alle Kameras auf CPU-Encoding zurueck. Fallbacks werden nur fuer die betreffende Kamera, Profil und Quelle gemerkt.
- **Kein Streaming-Hardreset als Voraussetzung:** Die bestehenden Aufzeichnungen und Konten bleiben erhalten. Bei der normalen Installation werden die Anwendungscontainer kurz nacheinander aktualisiert.
- **Rueckschalter:** Falls eine Kamera danach Probleme macht, `GO2RTC_H264_COPY_FIRST=false` in `.env` setzen und nur das Backend neu erstellen. VAAPI bleibt weiterhin verfuegbar.
- **Voraussetzung:** Installierte Version 2.20.39.

Teststatus: Automatisierte Unit-/Regressionspruefungen, ZIP-Pruefsummen, Node-Syntax. Der echte Intel-N97-Livetest kann nur auf deinem Server erfolgen.
