# TMP Camera Surveillance Next 2.20.90 – Aufnahme-Archiv per HTTPS-Cloud

## Nutzen
Auf dem privaten Plesk-Portal `https://support.tmp-networks.de/cam` gibt es nach dem normalen Kamera-Login einen separaten Bereich **Aufnahmen**. Hier koennen Kunden Kameras und Kalendertage filtern, gespeicherte Aufnahmen einsehen und einzelne Aufnahmebloecke abspielen. Die iPhone-WebApp bietet dieselbe Ansicht.

## Kamera-Backend
- GET `/api/recordings?limit=100` und optional `?cameraId=<ID>&limit=100`: vorhandene Aufnahmemetadaten (nur authentifiziert).
- GET `/api/recordings/<id>/segments`: veroeffentlichte Aufnahmebloecke (nur authentifiziert).
- GET `/api/recordings/<id>/cloud/<block|file>/clip/<part>.ts`: begrenzter, authentifizierter MPEG-TS-Videoteil (vier Sekunden), H.264/AAC, 540p/15 fps, On-Demand.
- Das bestehende HTTPS-Agentenprotokoll transportiert die maximal 3,5 MB grossen Videoteile mit dem seit 2.20.89 vorhandenen Chunk-Protokoll. Das Originalmaterial bleibt auf dem Kameraserver.
- Alle anderen Aufnahmerouten bleiben im Cloud-Proxy gesperrt: Rohdateien, Downloads, Loeschen, Scheduler, Export und Einstellungen.

## Sicherheit und Betrieb
- Mehrere angemeldete Kunden-/Endgeraete behalten unabhaengige PHP-Sitzungen.
- Der Cloud-Proxy verwendet den Access Token des normalen Kamera-Logins und setzt keine Media-Tokens in Browser-URLs.
- Die ffmpeg-Umsetzung wird auf zwei gleichzeitig erzeugte Medienclips begrenzt und hat einen Prozess-Timeout.
- Bei starker Last koennen Clips verzoegert werden; die Cloud-Player zeigen einen Verbindungsstatus. Es gibt keinen zusaetzlichen oeffentlichen Kamera-Port.
- Die eigentliche Aufnahme-Qualitaet und die Aufnahmespeicher-/NAS-Konfiguration werden nicht veraendert.

## Installation
1. Zuerst Plesk: private `/cam/index.php` auf **3.0.7** aktualisieren. Die PHP-Datei wird separat zur Verfuegung gestellt und gehoert nicht nach GitHub.
2. Danach Kamera-Software auf **2.20.90** aktualisieren (kompatibel ab 2.20.32).
3. Am iPhone in der Cloud-WebApp anmelden, im neuen Menue *Aufnahmen* eine Kamera und einen Aufnahmetag auswaehlen und einen Block abspielen.

## Grenzen
Die Cloud-Archivansicht listet bis zu 100 Eintraege je Abfrage. Groessere Archive brauchen spaeter eine paginierte Serverabfrage. Groessere Blockarchive werden in vier Sekunden lange, einzeln erzeugte Medienclips umgewandelt und koennen bei sehr schwacher Server-CPU etwas laenger starten. Ein echter End-to-End-Test mit mehrstuendigen Aufnahmen auf dem Kundensystem steht aus.
