# TMP Camera Surveillance Next 2.20.93 – Neues gecachtes HLS-Aufnahme-Archiv

## Ursache des bisherigen Fehlers
Das Live-HLS spielte schon vorhandene kleine HLS-Segmente ab. Das alte Aufnahme-Portal forderte dagegen fuer jedes 4- oder 15-Sekunden-Stueck eine neue FFmpeg-Konvertierung an. Das blockierte Kamera-Agenten, PHP-FPM und die MySQL-Relay-Warteschlange.

## Neue Funktionsweise
- Aufnahmeliste und Datumsfilter im **privaten** PHP-Portal 3.1.0.
- Ein Klick auf **Abspielen** oeffnet auf iPhone und Desktop sofort die Player-Ansicht.
- Der Kamera-Agent fordert eine HLS-Playlist fuer ein 30-Sekunden-Fenster der Aufnahme an.
- Ist das Fenster noch nicht vorhanden, gibt der Kameraserver sofort HTTP 202 zurueck und bereitet das Fenster im Hintergrund vor. Die PHP-WebApp prueft den Status mit kleinen, getrennten Anfragen.
- Nach Fertigstellung werden die vorbereiteten HLS-Segmente von etwa zwei Sekunden ohne weitere FFmpeg-Verarbeitung aus einem lokalen Cache geholt.
- Die WebApp spielt das Fenster ab und laedt das naechste Fenster nach seinem Ende, ohne den Originalfilm oder das Videoarchiv zu veraendern.

## Aufnahmeschutz
- Die API erfordert die normale Kamera-Benutzeranmeldung. Alle URLs und Dateinamen werden fest validiert, keine Authentifizierungstokens im Browser-URL.
- Nur Aufnahmeliste und geschuetzte VOD-Fenster werden ueber den Cloud-Proxy erlaubt. Loeschen, Einstellungen, lange Rohdatei-Downloads und Serveradministration bleiben gesperrt.
- Es werden keine Kamera-RTSP-Ports freigegeben. Vorhandene Livekameras verwenden weiterhin ihre unveraenderte HLS-Strecke.
- HLS-Cache unter dem vorhandenen Kamera-Datenvolume `/data/cloud-archive-hls-cache/`: max. 384 MiB, ca. 90 Minuten Aufbewahrung.
- Maximal zwei gleichzeitige Vorbereitungen, maximal acht wartende. Bei kompatiblen H.264-Dateien wird zuerst ohne Videoneucodierung remuxt; bei inkompatiblen Quellen findet eine begrenzte H.264/AAC-Aufbereitung statt.

## Private Plesk-PHP-WebApp 3.1.0
- Keine Emojis oder dekorativen Sonderzeichen in der Navigation oder im Aufnahmebereich.
- Kompakte, iPhone-gerechte Datumsauswahl, Kamera-Auswahl und Archiv-Player.
- Ein sichtbarer Vorbereitungsstatus statt scheinbar wirkungsloser Schaltflaechen.
- Der alte, fehlerhafte MP4-Download und der vorherige pro-Segment-Archiv-HLS-Zugriff sind deaktiviert.
- MySQL-Konfiguration, bestehende Benutzer, die permanente Server-ID und Registrierungen bleiben erhalten.

## Installation
1. Das separat bereitgestellte **private** Plesk-PHP-Portal 3.1.0 als `/cam/index.php` hochladen, bestehende `config.php` nicht ersetzen. Die PHP-Datei wird nicht in das oeffentliche GitHub geladen.
2. Kamera-Server ueber den vorhandenen Updater auf **2.20.93** aktualisieren.
3. Am iPhone das Archiv oeffnen und zuerst eine kurze, bereits abgeschlossene Aufnahme abspielen.

## QA und noch offene Risiken
Geprueft: PHP-Syntax; Archiv-JavaScript-Syntax; Browsersimulation bei 320/375/393/768/1280px mit Auftrag 202 -> fertig -> Player; lokaler FFmpeg-HLS-Medientest und erneuter Cache-Abruf; Codepruefung der Allowlist. Der echte End-to-End-Betrieb auf Plesk mit NAS-Aufnahmen und Safari muss noch durchgetestet werden. Bei sehr alten Aufnahmen ohne gueltige Wiedergabedauer oder fehlerhaftem H.264 kann die Erstellung scheitern; der Fehler wird dann statt eines unbegrenzt laufenden Ladebildschirms angezeigt.
