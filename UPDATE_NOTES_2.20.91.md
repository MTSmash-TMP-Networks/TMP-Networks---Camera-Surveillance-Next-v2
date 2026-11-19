# 2.20.91 – Cloud-Aufnahmen: Wiedergabe und mobile Archivfilter

## Fehler
Im Cloud-Archiv werden Aufnahmen korrekt aufgelistet, aber beim Wiedergabestart ueberlasten parallele, dynamisch erzeugte HLS-Clip-Anfragen die zwei verfuegbaren Encoder-Slots. Weitere Anfragen erhalten HTTP 503. Bei zu langen FFmpeg-Aufgaben koennen 504/502 auftreten. Die private PHP-WebApp 3.0.7 hatte zudem ein zu breites Datumsfeld auf kleinen iPhones und zeigte HLS-Wiedergabefehler nur unvollstaendig an.

## Kameraserver-Hotfix
- Bis zu zwei Clip-Encoder aktiv; bis zu acht weitere Clip-Auftraege werden maximal neun Sekunden gewartet und nicht direkt abgewiesen.
- Gleiche Clip-Anforderungen werden zusammengefasst, fertige Clips fuer 90 Sekunden im begrenzten Speicher wiederverwendet.
- Nur fuer die Cloud wird Video auf 360p, 12 fps, 580 kbit/s transcodiert. Originalaufnahmen bleiben in voller Qualitaet bestehen.
- Sicherheitsmodell bleibt schreibgeschuetzt. Keine Aufnahmeverwaltung oder Datei-Downloads durch den Cloud-Proxy.

## Private PHP-Portal-Version 3.0.8
Die PHP-Datei wird nicht in GitHub veroeffentlicht. Sie verbessert:
- Datumsauswahl mit festen Grenzen, `min-width: 0` und mobilem Grid: keine ueberstehenden nativen Date-Controls.
- HLS-Wiedergabe: sparsamere Puffer, Wiederverbindungsversuche, Status fuer iPhone-Autoplay und konkrete Fehlermeldung beim Media-Timeout.
- Keine Veraenderung an MySQL, registrierten Server-IDs, Kamera-Accounts oder iOS-Home-Screen-Links.

## Installation
1. Plesk: bestehende `/cam/index.php` durch die privat verteilte Version 3.0.8 ersetzen.
2. Kamera-System: GitHub-Update 2.20.91 ueber das Updatecenter installieren.
3. Einen kurzen Aufnahmeblock im Cloud-Archiv am iPhone testen. Bei Fehlermeldung bitte den sichtbaren HTTP-Code und den Backend-Logeintrag uebermitteln.

## Hinweis
Die Live-Umgebung ist nicht von hier erreichbar. Quellcode, PHP-Syntax, JS-Syntax, responsive Layoutgroessen und lokale FFmpeg-Testsegmente wurden geprueft; erfolgreicher End-to-End-Playback unter Plesk kann erst nach Deployment bestaetigt werden.
