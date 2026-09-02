# Kompatibilität

## Hostplattformen

| Plattform | Architektur | Betriebsart | Hinweise |
|---|---|---|---|
| Linux | x86_64, ARM64 | Docker Engine + Compose v2 | bevorzugte Serverplattform |
| macOS | Intel, Apple Silicon | Docker Desktop | Hostmetriken beziehen sich teilweise auf die Linux-VM; keine NVIDIA-Compose-Datei |
| Windows | x86_64 | Docker Desktop/WSL2 | lokale NTFS-Pfade bevorzugen |

Der Update-Preflight von 2.14.4 verwendet eine Compose-Syntax, die auch vor Version 2.24 unterstützt wird. Für neue Installationen wird dennoch eine aktuelle Docker-Desktop-Version empfohlen.


## Kamera- und Stream-Eingang

ONVIF-Kameras können wie bisher über Discovery oder direkte IP-Eingabe hinzugefügt werden. Zusätzlich können direkte Netzwerkstreams ohne ONVIF-Gerät als eigenständige Videoquelle angelegt werden. Der Backend-Container muss die jeweilige Kamera- oder Stream-Adresse erreichen können.

Direkt anlegbare Netzwerkstreams:

- RTSP/RTSPS
- HLS über HTTP/HTTPS
- MJPEG und allgemeine HTTP-/HTTPS-Videoströme
- RTMP/RTMPS
- SRT

Direkte Streams werden serverseitig mit FFprobe auf eine echte Videospur geprüft und anschließend über denselben go2rtc/FFmpeg-Ingest wie Kamerastreams verarbeitet. ONVIF-spezifische Geräteinformationen und PTZ stehen bei einer reinen Streamquelle naturgemäß nicht zur Verfügung.

Typische Eingänge:

- H.264: wird bei kompatibler GOP-/Pixelformat-Struktur ohne erneute Videokodierung durchgereicht
- H.265/HEVC: wird für breite Browserkompatibilität in H.264 normalisiert
- MJPEG: wird in H.264 normalisiert
- AAC, G.711, G.726 und weitere von FFmpeg lesbare Audiocodecs: werden in Opus und AAC normalisiert
- Profil ohne Audio: Video läuft weiter; die Audio-Schaltfläche hat dann keine Tonspur
- FFmpeg-Versionen: keine Abhängigkeit von optionalen `rw_timeout`-/`stimeout`-CLI-Optionen; Prozesszeitlimits werden extern überwacht

## Browserausgabe

| Browserweg | Video | Audio | Einsatz |
|---|---|---|---|
| WHEP/WebRTC | H.264 | Opus | Primärweg, niedrige Latenz |
| Low-Latency-HLS | H.264 | AAC-LC | automatischer Ersatzweg |
| ONVIF-Snapshot | JPEG/Herstellerformat | – | nur Start-/Fehlerreserve |

Getestet werden sollten die tatsächlich eingesetzten Versionen von Firefox, Chromium/Chrome, Edge und Safari. Browser-Autoplay-Regeln erzwingen einen stummen Start; Audio wird nach einem Nutzerklick aktiviert.

## Netzwerk

- Kamera → Backend: ONVIF sowie die von `GetStreamUri` zurückgelieferte Medienverbindung
- Direkter Stream → Backend: konfigurierte RTSP/RTSPS/HLS/MJPEG/HTTP(S)/RTMP/RTMPS/SRT-Adresse
- Browser → Nginx/Caddy: HTTP oder HTTPS
- Browser → go2rtc ICE: bevorzugt UDP 8189, ersatzweise TCP 8189
- bei NAT oder restriktiven Netzen: TURN/TURNS in `mediamtx/go2rtc.yaml` unter `webrtcICEServers2` konfigurieren


## SMTP-Benachrichtigungen

Für E-Mail-Benachrichtigungen benötigt der Backend-Container ausgehenden TCP-Zugriff zum konfigurierten SMTP-Server. Unterstützt werden unverschlüsseltes SMTP für vertrauenswürdige lokale Relays, STARTTLS und implizites TLS/SMTPS. Authentifizierung per Benutzername/Passwort bzw. App-Passwort wird unterstützt; OAuth2 ist nicht Bestandteil dieser Version. Zertifikatsprüfung ist standardmäßig aktiv.

## Abnahmematrix je Kameramodell

1. Discovery und manuelle Anmeldung
2. Geräteinformationen
3. Mainstream und Secondstream
4. H.264/H.265/MJPEG-Verhalten
5. Audio vorhanden/nicht vorhanden
6. WebRTC und LL-HLS
7. Profilwechsel ohne leere Fläche
8. 60 Sekunden Netzunterbrechung und automatische Wiederherstellung
9. PTZ, Home und Presets
10. Mehrere gleichzeitige Browser

## Unterstützte Kameraeingänge

- RTSP/RTSPS: TCP, HTTP-Tunneling und UDP
- HLS über HTTP/HTTPS
- MJPEG und allgemeine HTTP-/HTTPS-Videoströme
- RTMP/RTMPS
- SRT
- JPEG-Snapshot als Livebild-Fallback

Ob ein konkreter Herstellerpfad funktioniert, hängt von der Kamera und deren aktivierten Diensten ab. Proprietäre App-/P2P-Protokolle ohne direkt zugängliche Medienadresse werden nicht unterstützt.

## Kompatibilität von Version 2.9.0

- Datenbankmigrationen sind additiv und werden beim Start automatisch ausgeführt.
- Bestehende Kameras ohne MAC, UID oder Seriennummer bleiben gültig; die Deduplizierung fällt kontrolliert auf die IP-Adresse zurück.
- Bestehende manuelle Aufnahmen bleiben lesbar. Neue Aufnahmen können zusätzlich `ready_with_gaps` und Segmentmetadaten besitzen.
- Ohne gespeicherte Aufnahmepläne verhält sich eine Kamera wie bisher: Es werden nur manuelle Aufnahmen erstellt.
- `HOST_SCAN_RANGES` wird ab 2.9.0 nicht mehr automatisch überschrieben. Erkannte Hostrouten stehen in `AUTO_HOST_SCAN_RANGES`.
- Der Updater bleibt unter den Aliasen `updater` und `tmp-camera-updater` erreichbar. Abweichende Orchestratoren können weiterhin `UPDATER_URLS` oder `UPDATER_SERVICE_*` verwenden.
- Das Updatepaket bewahrt `.env`, `data/` und `.git` gemäß `UPDATE_PACKAGE.json`.

## Hardware-Telemetrie

CPU-, RAM- und Datenträgerwerte benötigen einen Linux-Docker-Host oder die Linux-VM von Docker Desktop. Auf Docker Desktop beziehen sich Hostwerte auf die Docker-VM. AMD- und Intel-GPU-Werte hängen von den vom Kernel bereitgestellten DRM-Sysfs-Dateien ab. Vollständige NVIDIA-Auslastung setzt NVIDIA Container Toolkit und die optionale Compose-Datei voraus. Ohne GPU-Unterstützung bleibt der Systemstatus vollständig nutzbar und markiert lediglich die GPU-Karte als nicht verfügbar.
