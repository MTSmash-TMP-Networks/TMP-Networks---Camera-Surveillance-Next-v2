## 2.20.68 – TMP Hardened Media Broker: go2rtc-Absturz beheben

- Eigener, reproduzierbarer go2rtc v1.9.14-Build auf unveraenderter Original-Runtime (FFmpeg und Intel-VAAPI), fest auf Upstream-SHA b5948cfb25404cc5cb37b166ecaa2dca20b11d4b gepinnt.
- Kritischer Absturz `fatal error: concurrent map writes` im DELETE-/Inventar-Endpunkt des go2rtc-Streams-API durch synchronisierte Map-Zugriffe behoben, zusaetzliche /api-Map-Abfrage race-safe.
- Docker-Build fuehrt Go-Race-Detector-Belastungstest fuer 40 Streams mit 8 parallelen Lesern und 8 Schreibern aus; GitHub CI prueft ffmpeg und den gestarteten API-Endpunkt.
- Host-Installer und In-App-Updater bauen den Medienbroker VOR dem Ersetzen laufender Kamera-Dienste und brechen bei Broker-Buildfehlern ab.
- Bestehende Kamera-, ONVIF-, Recording-, Motion-, VAAPI-, HLS- und Konfigurationswege bleiben erhalten. Keine Datenbankmigration.

## 2.20.67 – Voscam ONVIF-Port 888 erkennen

- Kamera-Portkatalog, vollstaendiger IP-Scan und primärer Hostscan erkennen TCP 888 als moeglichen Voscam-ONVIF-Dienst.
- Die anschliessende ONVIF-SOAP-Pruefung bestaetigt den Dienst anhand echter Antworten; ein beliebiger Webserver oder offener TCP-Port wird nicht ungeprueft zur Kamera erklaert.
- Kameraeinrichtung und ONVIF-Verbindungsparameter koennen Port 888 und einen vorhandenen XAddr verwenden.
- Auch auf Installationen mit einer noch alten, aus .env erhaltenen Host-Portliste wird 888 beim Host-Scan ergaenzt, damit Kameras nicht vor der ONVIF-Pruefung aussortiert werden.
- Keine Aenderung an laufenden Kamera-Publishern, Bewegungserkennung, Aufnahme- oder HLS-Logik; erhaelt v2.20.66 Hintergrund-Bootstrap und v2.20.65 Compose-V2-Updater.

## 2.20.66 – Zentrale Kameras bereits beim Backendstart vorwaermen

- Zentrale Publisher der aktivierten Kameras werden sofort nach Backendstart aufgebaut, noch vor langwieriger Aufnahme- und Netzwerkspeicher-Wiederherstellung und ohne Frontendbesuch.
- Der erste passende ONVIF-Substream wird sofort ausprobiert; weitere ONVIF-Profile werden erst nach einem Fehlschlag aufgeloest. Manuelle Quellen bleiben als Fallback vorhanden.
- Permanente Kiosk-Videostreams umgehen die optionale Audiopfad-Pruefung; Mainstream-/Aufnahmesitzungen behalten ihre Audiooptionen.
- Der neue Standardwert BACKGROUND_CAMERA_BOOTSTRAP_STAGGER_MS=250 verhindert, dass alte 1500-ms-Werte aus einer erhaltenen .env den Backendstart erneut bremsen.
- Begrenzung der parallelen Kamerastarts, lokale HLS-Pruefung, Kamera- und Aufnahme-Zustand sowie Restart-Backoff bleiben erhalten.

## 2.20.65 – Updater mit Docker Compose V2 und go2rtc-API-Fallback

- Behebt den Installations-/Rollbackfehler `KeyError: 'ContainerConfig'` durch ein eigenstaendiges Docker-Compose-V2-Plugin im Updater-Image.
- Separates Host-Reparaturskript fuer bereits laufende V1-Updater: prueft die Projektidentitaet, baut ein neues Image und ersetzt nur den Updater mit Image-Backup und Healthcheck.
- go2rtc-Control-API nutzt bei 404 des konfigurierten Base-Path automatisch die funktionierende Standard-API und uebernimmt den erfolgreichen Pfad fuer MPEG-TS.
- Version 2.20.64 mit schnellerem, auf vier parallele Starts begrenztem Kamerahochlauf bleibt enthalten; Update-Kompatibilitaet ab 2.20.32.

## 2.20.64 – Schnellere und weiterhin begrenzte Kamerastarts

- Maximal vier parallele Kamerastarts statt zwei; das Backend verhindert weiterhin mehrfache Starts derselben Kamera.
- Permanente Preview-Starts werden alle 250 ms statt alle 1500 ms eingereiht. Fehlerhafte Kameras blockieren andere Starts nicht dauerhaft; vorhandene Recovery-Schutzmechanismen bleiben erhalten.
- Bereits erzeugte .env-Dateien mit den bisherigen Standardwerten 1500 und 2 werden beim normalen Start auf 250 und 4 migriert. Individuelle abweichende Werte bleiben unveraendert.
- Kiosk-Kacheln verbinden sich mit 120 ms Abstand und maximal 3000 ms statt 900 ms und 4500 ms. Browser-Kacheln bleiben reine Leser des zentralen Preview-Streams.
- Keine Aenderungen an Kamerakonfiguration, Datenbank, RTSP-Profilwahl, Bewegungserkennung, Aufnahmeformat oder HLS-Puffer. Upgrade kompatibel ab v2.20.32.

## 2.20.63 – Originalstreams aus Snapshot-Notfallmodus automatisch wiederherstellen

- Erfolgreiche Snapshot-HLS-Notversorgung blockiert die native RTSP-/ONVIF-Wiederherstellung nicht mehr.
- Realer Videostream wird periodisch und nur fuer eine Kamera gleichzeitig geprueft. Snapshot bleibt bei fehlgeschlagener Pruefung aktiv.
- Nach Rueckkehr des Originalstreams synchronisiert der Kiosk seinen Decoder mit dem neuen Backend-Modus.
- Standardmaessig 1536 MB Containerlimits fuer Backend und go2rtc mit FFmpeg-Kindern; vorhandene .env-Werte bleiben erhalten.
- Unveraenderte Audio-/Aufnahme-/PTZ-Logik und Updatevertrag ab 2.20.32.

## 2.20.62 – HLS-Puffer im Kiosk stabilisiert

- HLS-Netzwerkfehler werden im Hintergrund repariert, solange der Browser noch Frames abspielt.
- Reparaturstatus erst nach nachweislichem anhaltendem Bildstillstand; ein einziger Recovery-Timer pro Player.
- HLS-Reconnect eskaliert erst nach interner Retry-Frist und nur ohne aktuellen Videofortschritt.
- Soft-Stall-Nachladen wird gedrosselt, um keine wiederholten Loader-Resets auszulösen.
- Kein Eingriff in Kamerastreams, Audio, Aufnahme, PTZ, Kiosk-Puffergröße oder Datenbank; kompatibel ab 2.20.32.

## 2.20.61 - CPU-Last durch Motion und Aufnahmen senken

- Bewegungserkennung liest fertige frische HLS-Segmente des zentralen Publishers, bevor eine zusaetzliche RTSP-/HLS-Verbindung gestartet wird.
- Begrenzte FFmpeg-Decoderthreads fuer Motion-Frames.
- Nachkomprimierung wartet bei laufenden Aufnahmen oder hoher Systemlast; Video-/Audio-Copy und Aufnahmequalitaet bleiben erhalten.
- Neue optionale Variable MOTION_PREFER_LOCAL_HLS. Upgrade kompatibel ab 2.20.32.

## 2.20.60 – Aufnahme-Watchdog und Kioskstatus stabilisiert

- Atomare Blockumbenennungen loesen im laufenden Aufnahmescanner keinen unbehandelten ENOENT-Fehler mehr aus.
- Leichtgewichtige Kiosk-Aufnahmestatusabfrage vermeidet teure SQL-/Segmentabfragen alle paar Sekunden.
- Kiosk meldet kurzzeitige API-Fehler nicht sofort als Verbindungsverlust; Stream-/Audio-/PTZ-Konfiguration bleiben unangetastet.
- Kompatibel ab 2.20.32, keine Migration.

## 2.20.59 – PTZ-Steuerung reagiert schneller

- Vorwaermen separater ONVIF-Verbindungen fuer Move und Stop, ohne die Bedienung zu blockieren.
- Reduzierte Wiederholungsbefehle bei gehaltenen PTZ-Tasten, Sicherheits-Stop bleibt priorisiert.
- Nur interaktive Live-Vorschau naeher an der HLS-Kante (3 s statt 8 s); Kiosk-Puffer unveraendert.
- Keine Aenderung der zentralen Video-/Audio- und Aufnahme-Pipeline; Update ab 2.20.32.

## 2.20.58 – WLAN-RTSP und Ton im zentralen Live-Preview

- Der permanente zentrale Live-Preview-Publisher behaelt Audio (G.711 nach AAC fuer HLS), statt den Audiopfad pauschal abzuschalten.
- Bei tatsaechlichem FFmpeg-Medienfortschritt erhalten lange WLAN-/GOP-Anlaeufe bis zu 60 Sekunden fuer den ersten HLS-Ring; tote Quellen bleiben durch die Standardfrist begrenzt.
- MPEG-TS wird ohne erzwungene Wallclock-Zeitstempel nach HLS umgepackt.
- Snapshot-H.264 bleibt Notversorgung, Audio-freie Kiosk-Autoplay-Kacheln bleiben initial stumm, direkte Live-Ansicht kann Ton aktivieren.
- Update-Basis bleibt 2.20.32, bestehende Konfiguration und Daten bleiben unangetastet.

## 2.20.56 – Zentraler Preview-Publisher strikt vom Frontend getrennt

- Kiosk und Live-Auto lesen ausschließlich den serverseitig gehaltenen zentralen Preview-Publisher über einen read-only Preview-Endpunkt.
- Der Browser darf diesen Publisher nicht mehr starten, stoppen, restarten, umprofilieren oder über Heartbeats neu anlegen.
- Browser-Prewarm beim Kamera-Anlegen und die AppShell-weite Browser-Synchronisierung wurden entfernt.
- Kiosk verwendet pro Kamera genau einen kanonischen zentralen Preview-Key; Tile-Größe, Resize und UI-Qualität erzeugen keine zusätzliche Stream-Session.
- Der Kiosk-Qualitätswahlschalter wurde entfernt; die Backend-Preview-Qualität ist die alleinige Quelle.
- Bei Backend-Recovery bleibt der Browserplayer bestehen und hält den letzten/buffered Frame, statt wegen Backendstatus aggressiv neu aufgebaut zu werden.
- Das Backend überwacht fehlende permanente Preview-Publisher selbst und startet maximal einen fehlenden Publisher pro Wartungsrunde über die globale Kamera-Queue.
- Die Kameraübersicht zeigt Grün nur noch, wenn der zentrale Preview-Publisher samt Local-HLS tatsächlich ready ist. Eine alte Live-/Mainstream-Session kann die Ampel nicht mehr fälschlich grün halten.
- Update-Basis bleibt 2.20.32.

## 2.20.55 – Stabiler Live-Reconnect ohne Browser-Reconnect-Sturm

- Browser-Session- und Heartbeat-Abfragen duerfen einen fehlgeschlagenen permanenten Kamera-Publisher nicht mehr sofort neu starten.
- Der Backend-Backoff/Circuit-Breaker bleibt nun autoritativ; Browser-Polls warten auf den geplanten Restart statt weitere globale Kamera-Starts anzustossen.
- Der geplante Restart-Zeitpunkt wird als `restartAt` an Status/Browser ausgegeben.
- Live/Kiosk warten bei permanenten Publishern bis zu 300 Sekunden auf den kontrollierten Wiederaufbau, statt frueh `LIVE_CONNECT_FAILED` zu melden.
- Der zuletzt funktionierende Kandidat wird als Profil + Transport gepinnt, nicht nur als Profil.
- Permanente Preview-, Motion- und Prebuffer-Pfade sind video-only und erzeugen keinen optionalen AAC-Transcode mehr.
- Die Auto-Profil-First-Frame-Grenze wurde von 8 auf 12 Sekunden angehoben, damit langsam startende, aber stabile Kamera-Streams nicht vorschnell verworfen werden.
- Update-Basis bleibt 2.20.32.

## 2.20.54 – Stream Resource Guard gegen CPU-Runaway und Recovery-Leaks

- go2rtc-Broker-Referenzen werden bei Stream-Recovery nicht mehr mehrfach hochgezaehlt; Profil-/Encoderwechsel geben den alten Broker vor dem Wechsel frei.
- Ein periodischer Ressourcen-Waechter korrigiert fehlerhafte Broker-Refcounts und entfernt verwaiste go2rtc-Broker.
- Kurzlebige `ready`-Phasen setzen die Restart-Historie nicht mehr sofort auf null. Erst nach 60 Sekunden stabiler Laufzeit gilt ein Stream wieder als gesund.
- Nach sechs kurzen Start-/Absturzzyklen oeffnet ein Circuit Breaker und verzoegert weitere automatische Neustarts standardmaessig um mindestens 120 Sekunden.
- Der CPU-intensive Snapshot→H.264-Fallback ist fuer permanente Preview-, Recording-, Motion- und Prebuffer-Pfade gesperrt.
- Sticky Encoder-Fallback bleibt erhalten: Copy → VAAPI → CPU darf weiterhin erfolgen und bleibt bei stabilem CPU-Pfad gepinnt.
- Event-Prebuffer nutzt jetzt einen eigenen `prebuffer`-Streamzweck und erzwingt nicht mehr automatisch Recording/Mainstream-High.
- Synthetische Snapshot-Video-Sessions werden nicht mehr als Recording-/Motion-Quelle wiederverwendet.
- Update-Basis bleibt 2.20.32.

## 2.20.53 – Kameras starten strikt nacheinander statt in parallelen Loops

- Der bisherige Start-Lock war nur pro Kamera und erlaubte dadurch parallele RTSP/go2rtc/HLS-Aufbauten verschiedener Kameras.
- Eine globale Kamera-Startwarteschlange erlaubt jetzt systemweit nur einen aktiven Kamera-Verbindungsaufbau gleichzeitig.
- Der permanente Kamera-Bootstrap arbeitet alle aktivierten Kameras vollständig nacheinander ab.
- Der bisherige Timer-Stagger wurde durch eine echte Ruhepause nach einer fertig abgearbeiteten Kamera ersetzt.
- Motion Detection und Recording Scheduler starten erst, nachdem alle permanenten Preview-Publisher ihren ersten Startversuch abgeschlossen haben.
- Permanente Auto-Restarts werden während des initialen Bootstraps zurückgestellt und erst danach freigegeben.
- Dadurch können fehlerhafte Kameras den Erstaufbau der übrigen Kameras nicht mehr mit parallelen Restart-Loops stören.
- Update-Basis bleibt 2.20.32.

## 2.20.52 – Robuster Linux-Desktop-Installer für unvollständige Electron-Downloads

- Electron 35.7.5 bleibt fest gepinnt und wird weiterhin zuerst über den normalen npm-Installationspfad installiert.
- Meldet npm/rebuild Erfolg, obwohl `dist/electron` oder `path.txt` fehlen, greift jetzt ein verifizierter Direkt-Fallback.
- Der Fallback lädt das offizielle Electron-Release-ZIP und `SHASUMS256.txt`, prüft SHA-256 und entpackt mit `unzip` oder `python3`.
- `path.txt` wird nach erfolgreicher verifizierter Extraktion kontrolliert erzeugt; ein stiller npm-Erfolg kann die Installation nicht mehr blockieren.
- Desktop-Client-Paket und tatsächlich angebotene Linux-ZIP-Datei wurden auf 2.20.52 aktualisiert.
- Der Desktop-Installer-Test ist jetzt Bestandteil des Cross-Version-GitHub-Workflows.
- Direkte Updates bleiben ab 2.20.32 kompatibel.

## 2.20.51 – Abwärtskompatibler Update-Vertrag bis 2.20.32

- Direkte Update-Basis bleibt ausdrücklich `2.20.32`.
- `minimumVersion`, `minVersion`, `compatibleFrom` und `fromVersion` müssen weiterhin exakt `2.20.32` enthalten.
- `.env`, `data` und `.git` werden als geschützte Laufzeitpfade im Update-Vertrag fest geprüft.
- Der Legacy-Updater-Guard prüft weiterhin Root-Pfade, Manifest, Prüfsummen und Paketversionen gegen die v2.20.32-Kompatibilitätsbasis.
- Keine Funktionsänderung an Shared Warm Streams, Recording oder HLS; 2.20.51 härtet ausschließlich den Update-Vertrag.

## 2.20.50 – Shared Warm Stream Architecture für Live und Recording

- Live `Auto` hängt sich jetzt direkt an den bereits beim Backend-Start aufgebauten permanenten Preview/Substream-Publisher.
- Die Fenstergröße erzeugt im normalen Live-Auto-Modus keinen neuen High-/Mainstream mehr.
- Der permanente Ingest ist jetzt explizit ein geteilter Backend-Publisher und gehört nicht mehr dem zuletzt anfragenden Kiosk- oder Live-Consumer.
- Browser-Polling hält die ursprüngliche `quality=auto`-Anfrage fest und erzeugt dadurch nicht versehentlich eine zweite Low-Live-Session.
- Manuell gewählte Qualität/Profile dürfen weiterhin einen eigenen höherwertigen Stream anfordern.
- Recording `Auto` fordert ausdrücklich High/Mainstream an, damit Aufnahmen nicht versehentlich auf dem Preview/Substream landen.
- Bereits laufende geeignete Mainstream-Publisher werden durch `retain()` weiterhin zwischen Live und Recording geteilt.
- Der bestehende Local-HLS-Ring, Sticky-Profile und Sticky-Encoder bleiben unverändert aktiv.

## 2.20.49 – Live-Ampeln bleiben nach erfolgreichem Stream grün

- Eine bestätigte `ready`-Streamsession korrigiert einen veralteten Kamera-`stream_error` jetzt wieder auf `online`.
- Auch bereits laufende/recycelte Sessions synchronisieren den Kamera-Status bei `ensure` und Heartbeat zurück auf online.
- Kamera-API überlagert den persistierten Status mit dem echten Runtime-Zustand, solange eine gesunde Ready-Session existiert.
- Die Live-Ansicht schreibt einen erfolgreichen Playback-State sofort in den Redux-Kameraeintrag.
- Zusätzlich aktualisiert die Live-Kameraliste ihren Status alle fünf Sekunden, damit externe Statusänderungen nicht hängen bleiben.
- `hasReady()` nutzt jetzt die tatsächliche Prozess-/Session-Liveness statt nur einen vorhandenen Prozessverweis.

## 2.20.48 – Auto wechselt bei fehlenden Medienframes schneller auf Substream

- Auto-Modus wartet bei einem bevorzugten Profil nur noch begrenzt auf die ersten normalisierten Medienframes.
- Liefert ein Mainstream innerhalb von standardmäßig acht Sekunden keine nutzbaren Frames, wird der Versuch als Profilfehler gewertet.
- Dieser Fehler löst keinen Copy→VAAPI→CPU-Zyklus auf demselben toten Profil mehr aus.
- Stattdessen wird direkt das nächste schwächere Profil versucht.
- Manuell gewählte Profile behalten weiterhin den normalen Starttimeout und werden nicht automatisch nach acht Sekunden verworfen.
- Der erfolgreiche Downgrade bleibt wie seit 2.20.47 sticky für weitere Reconnects.

## 2.20.47 – Mainstream bevorzugen, aber nicht erzwingen

- Ein fehlschlagendes Mainstream-Profil blockiert das Livebild nicht mehr; die bestehende Reihenfolge `high → balanced → low` wird konsequent bis zu einem funktionierenden Profil durchlaufen.
- Sobald ein schwächeres Profil erfolgreich läuft, wird dieses Profil für weitere Reconnects derselben Session bevorzugt.
- Ein manuell gewähltes Mainstream-Profil bleibt Wunschprofil, wird nach erfolgreichem Downgrade aber nicht bei jedem Recovery erneut aggressiv ganz nach vorne gedrückt.
- Fehler-Memory für Streamquellen ist jetzt profilbezogen, damit ein Fehler des Mainstreams den Substream nicht mit abstraft.
- Der Sticky-Encoder aus 2.20.46 und der stabile Local-HLS-Kioskpfad bleiben unverändert bestehen.

## 2.20.46 – Sticky Kiosk-Encoder und keine Fallback-Oszillation

- Kiosk darf keinen separaten Browser-Transcode-Fallback mehr öffnen.
- Server verwirft `forceTranscode` für `purpose=kiosk` auch dann, wenn der globale Browser-Fallback aktiviert ist.
- Encoderfehler bleiben pro Kamera/Profil/Quelle bis zum Backend-Neustart gespeichert.
- Ein einmaliger Wechsel von VAAPI auf Software/CPU wird dadurch nicht mehr nach zehn Minuten automatisch zurückprobiert.
- Copy-/GPU-/CPU-Pfade bleiben für eine laufende Backend-Sitzung deterministisch und können nicht zyklisch hin- und herspringen.
- Der bestehende Local-HLS-Ring und die Kiosk-Lifecycle-Fixes aus 2.20.44/2.20.45 bleiben unverändert bestehen.

## 2.20.45 – Stabiler Kiosk-Stream ohne unnötige HLS-Recovery

- Kiosk-Player bindet einen laufenden Stream nicht mehr bei bloßen ResizeObserver-/Layoutänderungen neu an.
- Feste Qualitätsstufen verwenden eine stabile Verbindungsbreite; nur der echte Wechsel der Qualitätsstufe kann noch einen neuen Stream anfordern.
- Nicht-fatale hls.js-Pufferlöcher lösen keine sichtbare Recovery und keinen Sprung zur Live-Kante mehr aus.
- Vorhandener HLS-Puffer wird weiter abgespielt; erst ein echter fataler Netzwerk-/Medienfehler oder der langfristige Frame-Watchdog darf neu verbinden.
- Veraltete Frontend-Regressionstests wurden auf den aktuellen Local-HLS-/PREWARM-Pfad angepasst.
- Der 30-Sekunden-HLS-Ring aus 2.20.44 bleibt unverändert bestehen.

## 2.20.44 – Stabilerer Local-HLS-Puffer und zuverlässige Live-Ampeln

- Lokaler HLS-Ring von rund 8 auf standardmäßig 30 Ein-Sekunden-Segmente vergrößert; Größe und Segmentdauer sind über `LOCAL_HLS_LIST_SIZE` und `LOCAL_HLS_SEGMENT_SECONDS` einstellbar.
- Browserwiedergabe läuft bewusst rund 8 Sekunden hinter der Live-Kante, hält bis zu 30 Sekunden Vorwärtspuffer und 15 Sekunden Rückpuffer und toleriert kurze Netzstörungen länger vor einem Neuaufbau.
- HLS-Recovery erhält mehr Zeit und zusätzliche Segment-/Playlist-Wiederholungen, wodurch kurze WLAN-/LAN-Aussetzer seltener zu sichtbarem Flippern führen.
- Kamera-Status wird bei einem einzelnen fehlerhaften Hintergrund-/Profilstream nicht mehr auf `stream_error` gesetzt, solange ein anderer Stream derselben Kamera nachweislich gesund ist.
- Live-Ansicht bewertet die Ampel der aktuell ausgewählten Kamera zusätzlich anhand der tatsächlichen Browserwiedergabe: Grün bei laufenden Frames, Gelb bei Aufbau/Recovery, Rot nur bei echtem Offline-Zustand.
- Regressionsprüfungen für Local-HLS-Ring, Browserpuffer und Statusunterdrückung ergänzt.

## 2.20.43 – Reolink ONVIF-Port 8000

- ONVIF-HTTP-Erkennung auf TCP 8000 fuer neue Reolink-Modelle.
- Verifizierte SOAP-/Auth-Evidenz statt blinder SDK-Portzuordnung; Hikvision-Erkennung unveraendert.
- ONVIF-Probekandidaten priorisieren 8000 bei bestaetigter XAddr und pruefen den Port bei Reolink als Fallback.
- Optionales manuelles ONVIF-Portfeld in der Kameraeinrichtung mit automatischem Standard.
- Automatisierte Regressionstests fuer Port 8000, Nicht-Kamera-Gegenfaelle und kompatible Paketstruktur.

## 2.20.42 – Reale Codec-Pruefung und Copy-first fuer unbekannte ONVIF-Profile

- H.264-Kopierpfad wird auch bei leeren ONVIF-Codecangaben geprueft, ohne den Profilnamen als Codec-Beweis zu verwenden.
- FFprobe prueft das fertige lokale MPEG-TS-Segment; H.265/MJPEG-Kopien bleiben vor Browserfreigabe gesperrt und gehen in VAAPI-/CPU-Fallback.
- VAAPI-Opt-in ist in der Backend-Compose-Umgebung explizit sichtbar; temporaere Encoderfehler erhalten eine zeitlich begrenzte Quellensperre.
- Diagnoseskript und Reolink-Regressionstests hinzugefuegt; keine Benutzerdaten werden aktualisiert.

## 2.20.41 - Versionsuebergreifende Updates ab 2.20.32

- Das GitHub-Quellarchiv enthaelt ausschliesslich Wurzelpfade, die bereits der Updater 2.20.32 erlaubt. Die Desktop-Client-Quellen liegen jetzt unter `frontend/desktop-client/`; der eigentliche herunterladbare Linux-Client bleibt unveraendert unter `frontend/public/downloads/`.
- `minimumVersion`, `minVersion`, `compatibleFrom` und `fromVersion` im Vollupdate werden auf die getestete Kompatibilitaetsbasis 2.20.32 ausgerichtet statt auf die unmittelbar vorherige Version.
- Automatischer Release-Check blockiert inkompatible Root-Verzeichnisse, fehlende Prüfsummen, Versionsabweichungen und eine unbeabsichtigt angehobene Mindestversion.
- Alter Updater wird bei einem Update nicht eigenmaechtig im laufenden Prozess ersetzt; vorhandener Backup-/Rollback-Weg und `.env`, `data/`, `.git` bleiben geschuetzt.
- Eine direkte Aktualisierung aus noch aelteren oder unbekannten Staenden bleibt ohne separate Bridge-Pruefung gesperrt.

## 2.20.40 - CPU-Sparmodus fuer H.264-Streams und profilgebundener VAAPI-Fallback

- Bereits H.264-kodierte Kamerastreams werden standardmaessig mit go2rtc `#video=copy` statt erneutem libx264-Encoding weitergegeben.
- Ein `ffprobe`-Check am ersten fertigen HLS-Segment bestaetigt tatsaechliches H.264 vor der Browserfreigabe.
- Bei einem nicht startfaehigen H.264-Kopierpfad wird nur das betroffene Kamera-/Profil-/Quellen-Paar mit VAAPI oder Software neu versucht.
- Ein VAAPI-Fehler deaktiviert die Intel-GPU nicht mehr global fuer alle weiteren Kameras.
- Separate Broker-Identitaeten fuer Copy/VAAPI/Software erhalten gleichzeitig verwendete Streams bei einem Fallback.
- `GO2RTC_H264_COPY_FIRST=false` in `.env` erlaubt die sofortige Rueckkehr zum bisherigen Transcoding-Verhalten.
- Bestehende Videodaten, `.env` und die Intel-Docker-Freigabe bleiben unveraendert.

## 2.20.39 - Intel VAAPI video pipeline opt-in

- Add a device-scoped, opt-in Intel /dev/dri/renderD128 passthrough for go2rtc and the backend.
- Provide a safe Intel H.264 VAAPI smoke test before hardware transcoding is enabled.
- Use go2rtc #hardware=vaapi for normalized H.264, falling back to software upon stream-start failures.
- Show Intel acceleration configuration independently from GPU utilization and identify shared-memory VRAM.
- Keep CPU/software behavior as default and preserve recordings and `.env` permissions.

## 2.20.38 - Electron install-script approval and runtime verification

- Approves only pinned `electron@35.7.5` install script for npm 11+ script trust policy.
- Rebuilds incomplete Electron installs and verifies native executable, marker, and exact installed package version before declaring success.
- Updates embedded Desktop-Client ZIP and installation regression tests.

## 2.20.37 - Linux Desktop Client dependency bootstrap

- Desktop installer fetches and SHA-256-verifies Node.js 24 LTS with bundled npm in the user directory when not present.
- Electron dependency preflight with apt-based repair for Debian, Ubuntu and Linux Mint.
- Updated web UI instructions, packaged download and offline/error regression checks.

## 2.20.36 - Camera setup and GitHub update fixes

- Camera input metadata handling and detailed field validation feedback.
- Align GitHub source archive with the signed file manifest and improve GitHub diagnostics.

## 2.20.35 – Linux Desktop Client

- Add downloadable Linux x86_64 Electron desktop client source installer in the authenticated interface.
- Add a dedicated Desktop-Client navigation screen and static client archive.
- Desktop client connects to existing surveillance servers; no extra Docker instance.
- Enforce origin restrictions, sandboxing, certificate validation and disabled Node integration.
- Keep ZIP and GitHub application update paths unchanged.

## 2.20.34 - Docker installation bootstrap (2026-11-12)

- Install Docker Engine and Compose plugin during first start on supported Ubuntu, Debian, Linux Mint and Fedora hosts when Docker is absent.
- Keep existing Docker runtimes and NAS/container managers untouched, with explicit failure diagnostics and a disable switch.
- Add automated regression tests for first-start behavior and unsupported systems.

# Changelog

## 2.20.32 - 2026-10-03

- Fixed the Update Center remaining permanently at 42% (or another intermediate value) when the updater process/container restarts during an update.
- Added startup recovery for interrupted validating, preflight, installing, building, cleanup and rollback phases.
- Interrupted jobs are now closed explicitly with a diagnostic error and preserved backup reference instead of being shown as still running.
- Added update-history evidence for interrupted transactions.
- Removed the one-shot 60-second stale-status window so fast updater restarts are recovered reliably.
- Preserved all v2.20.31 timeline playback behavior unchanged.

## 2.20.32 - 2026-09-03

- Added click-to-time playback on the 24-hour recording timeline so playback starts at the selected point instead of always at the beginning of the recording.
- Added automatic sequential playback through every later recording for the same camera until the final recording of the selected day finishes.
- Added gap-aware handoff: clicks inside condensed gaps start at the next available block and gaps between recordings are skipped automatically.
- Added block-to-media offset metadata to the recording timeline API for accurate seeking across block archives and discontinuities.
- Added a compact current/total sequence indicator to the recording player while continuous timeline playback is active.
- Preserved double-click evidence-export selection and unchanged single-recording playback from the detailed archive list.

## 2.20.30 - 2026-09-03

- Reworked the recording archive into a compact 24-hour timeline per camera instead of printing every interval as an additional text/chip list.
- Removed overlapping start-time labels from short recording segments so dense event-recording days remain readable.
- Kept every available recording interval directly clickable on the timeline; hover/focus still exposes the exact time range and block count.
- Preserved double-click transfer of a timeline range to the evidence export and added click/double-click disambiguation so playback does not open accidentally during export selection.
- Reduced the minimum visual width of very short recording ranges to avoid artificial overlap while keeping one- and two-minute recordings visible.
- Kept the existing block-based archive, recording data, storage pipeline, motion regions, kiosk layouts and updater compatibility unchanged.

## 2.20.29 - 2026-09-03

- Completed Kiosk Mode localization across all 24 supported UI languages, including the layout editor, saved views, grid templates, camera assignment, quality controls, fullscreen actions, status labels, empty states and accessibility text.
- Completed Update Center localization across all 24 supported UI languages, including loading/error states, updater diagnostics, package workflow, confirmations, progress phases, backups, history, security notices and technical action labels.
- Replaced German/English-only update-service fallbacks with native locale entries for every supported language.
- Localized update progress from stable technical phase codes so German backend status sentences no longer leak into non-German interfaces.
- Made Update Center date and number formatting follow the selected locale.
- Updated the kiosk layout smoke test to assert i18n integration rather than a hard-coded German label.
- Added regression checks for 24-locale key parity, interpolation placeholders and hard-coded German UI literals.
- Preserved per-camera motion regions from v2.20.28, the v2.20.27 sidebar collapse fix and existing updater/recording/storage behavior.

## 2.20.28 - 2026-09-03

- Added a per-camera motion detection region that can be drawn directly on a current camera snapshot.
- Motion zones are stored as normalized coordinates so the selection remains valid across snapshots, substreams and differing camera resolutions.
- The motion comparator now ignores pixels outside the selected region, including stabilization and brightness compensation calculations.
- Existing cameras continue to use the complete image until a motion region is explicitly enabled.
- Added automatic SQLite migration for the nullable `motion_zone` camera setting without requiring manual database changes.
- Motion comparison baselines are reset safely when a camera motion region is changed to avoid false events during reconfiguration.
- Added regression coverage for ROI filtering, camera persistence and the snapshot-based drag selector.
- Preserved the v2.20.27 sidebar collapse fix, updater workflow, recording/storage pipeline and kiosk layouts.

## 2.20.27 - 2026-09-03

- Fixed the complete application layout breaking after pressing the desktop sidebar collapse button.
- Removed the conflicting CoreUI `sidebar-narrow` class from the TMP shell collapse state.
- Synchronized the collapsed sidebar and application grid at a fixed 72 px width to prevent overlap and content displacement.
- Preserved compact icon navigation, persisted collapse state and the existing mobile navigation behavior.
- Added regression coverage for the collapse class and width contract.
- Kept updater, recordings/storage, Docker cleanup, system status and kiosk layouts unchanged.

## 2.20.26 - 2026-09-02

- Fixed the CoreUI sidebar clipping lower administration entries when the browser viewport is too short or zoomed.
- Made the primary sidebar navigation vertically scrollable while keeping the logo and user/logout area fixed.
- Restored reliable visibility and access to the existing administrator Update Center entry.
- Added a navigation regression test for `/system/update` and sidebar overflow behavior.
- Kept the stable updater, recording/storage pipeline, Docker cleanup, system metrics and kiosk layout manager unchanged.

## 2.20.25 - 2026-09-02

- Added a Surveillance Station style kiosk layout manager with multiple named, persistent monitor views.
- Added eight grid templates including equal grids and asymmetric focus layouts such as 1+4, 1+6 and 2+4.
- Added per-tile camera assignment, empty tiles, automatic assignment, duplicate/delete actions and one-click switching between saved kiosk views.
- Preserved the automatic camera-count layout as the default and kept fullscreen mode compatible with saved asymmetric layouts.
- Stored kiosk layout preferences in versioned browser local storage; no camera, recording or backend schema changes are required.
- Kept recording, SMB/SFTP storage, updater, Docker cleanup and live disk metrics behavior from 2.20.24 unchanged.

## 2.20.24 - 2026-09-02

- Introduced a documented CoreUI 5.9.0 (MIT) foundation for the application shell, navigation, header and footer.
- Kept Live View, camera cards, PTZ, recordings, timeline and kiosk as TMP-specific surveillance components rather than generic admin-template screens.
- Centralized navigation metadata in `frontend/src/config/navigation.js` to remove duplicated menu structure and keep role-aware routes consistent.
- Added a compact application context header while preserving the existing dark TMP camera theme and responsive sidebar behavior.
- Added transparent UI provenance and the complete CoreUI MIT license under `docs/UI_FOUNDATION.md` and `docs/third-party/CoreUI-MIT.txt`.
- Added CoreUI and its Popper peer dependency as pinned frontend dependencies; no CoreUI PRO assets are used.
- Kept the stable recording, updater, Docker cleanup and live storage metrics behavior from 2.20.23 unchanged.

## 2.20.23

- Fixed stale disk usage in System Status after Docker image/build-cache cleanup.
- Host filesystem used/free values are now read live from the data bind mount instead of frozen `SYSTEM_HOST_DISK_*` startup values.
- Host snapshot capacity is used only to identify whether the live bind mount belongs to the host filesystem.
- Filesystem percentage now follows `df` semantics by excluding reserved blocks from user-available capacity.
- `start.sh` refreshes the fallback host-disk snapshot immediately after pre-build Docker cache cleanup.
- Binary byte values in System Status are labelled correctly as KiB/MiB/GiB/TiB instead of KB/MB/GB/TB.


## 2.20.22

- Added automatic pruning of dangling Docker images produced by repeated application builds.
- Added automatic pruning of unused Docker builder/buildx cache before and after updates.
- Added the same safe maintenance to host-side startup and updater repair.
- No Docker volumes, containers, tagged base images or recording files are removed by this maintenance.
- Added `data/updates/docker-cleanup.log` for disk-cleanup diagnostics.

## 2.20.21 - 2026-09-02

- Reworked recording storage integrity across compression, SMB/SFTP upload, retention and restart recovery.
- Remote uploads now verify the final remote file before local spool cleanup, and SQLite is only marked `remote` after the local copy is actually removed.
- Added startup reconciliation for interrupted uploads, legacy duplicate local copies and stale network-cache `.part` files.
- Fixed retention minimum-free-space cleanup deleting remote-only archive rows even though this could not free local disk space.
- Recordings with queued/running compression or unfinished network transfer are protected from retention cleanup until the pipeline reaches a safe terminal state.
- Interrupted recording recovery now requeues recovered blocks for compression and direct SMB/SFTP storage.
- Added transient compression-file recovery/cleanup for `.compressing` and `.compression-backup` states after restarts.
- Added `scripts/recording-storage-audit.sh` and recording-storage details to `diagnose.sh`.
- Kept the stable updater-agent lifecycle unchanged.

## 2.20.20 - 2026-09-02

- Fixed background recording compression being globally paused whenever any recording was active.
- Finalized blocks from active recordings are now eligible for compression and subsequent SMB/SFTP transfer while the next block continues recording.
- Kept active `.partial` writer files isolated from the compression worker.
- Added constrained-CRF archive encoding with a default 2500 kbit/s H.264 video ceiling to prevent high-bitrate source streams from remaining oversized after archival.
- Added startup requeue for oversized local blocks previously marked `skipped` by the unconstrained compression policy.
- Updated regression coverage for continuous recording plus background compression/network transfer.
- Kept the stable updater-agent lifecycle unchanged.

## 2.20.19 - 2026-09-02

- Removed marketplace-specific edition branding and distribution references from the neutral release package.
- Fixed direct SMB/SFTP recording storage bypassing the background recording compression pipeline.
- Finalized recording blocks are now queued for compression before they become eligible for network transfer.
- Network uploads wait until compression is completed, intentionally skipped, disabled, or finally failed, preventing premature upload of oversized source blocks.
- Compression backfill now also covers local spool files already marked as pending or retrying for network storage.
- Network transfer waits for the parent recording to be finalized before removing the local spool copy.
- Reworked the recording archive so the long completed-recording list is collapsed by default and can be expanded as one section.
- Added a compact archive summary with recording count, total duration and total storage size.
- Kept the stable updater-agent lifecycle and SMB/Synology compatibility from 2.20.17/2.20.18 unchanged.

## 2.20.18 - 2026-09-02

- Fixed misleading SMB validation that could report a generic server/port/path error for valid NAS workflows.
- Added parsing of common SMB URLs, UNC paths and `host:port` copy/paste formats.
- Added Synology-oriented SMB3-to-SMB2 negotiation fallback while keeping SMB1 disabled.
- Added direct IPv4 targeting and disabled Kerberos for local NAS username/password sessions.
- Split SMB errors into hostname, port, authentication, share, permission, protocol and operation classes.
- Added share-level probing before the destructive write/read/delete storage test.
- Extended all 24 Recording Storage translations for the new diagnostics.
- Kept the stable updater-agent lifecycle from 2.20.17 unchanged.

## 2.20.17 - 2026-09-02

- Removed in-transaction updater self-replacement from the in-app update lifecycle.
- Kept the active updater container online after successful application updates so the local IPC socket and Docker-network aliases remain stable.
- Continued building/staging the new updater image, but activation now occurs only during a normal host-side `start.sh` or explicit `repair-updater.sh`.
- Added a compatibility guard to `scripts/docker-compose.sh` that safely ignores the detached self-replacement call emitted by a running 2.20.16 updater while installing 2.20.17.
- Added regression coverage proving that a 2.20.17 backend accepts a healthy 2.20.16 updater agent over IPC.
- Removed the automatic full Compose down/up finalizer that could leave the updater unreachable on both Debian and Synology after an otherwise successful update.

## 2.20.16 - 2026-09-02

- Replaced Docker DNS as the primary Backend-to-Updater control path with a local Unix-domain HTTP socket in the shared persistent data directory (`/data/updates/tmp-camera-updater.sock`).
- The updater creates the socket with the configured `PUID:PGID`, allowing the unprivileged backend process to use the same authenticated update API without a network lookup.
- Docker service discovery (`updater:3010` / `tmp-camera-updater:3010`) remains available only as a compatibility fallback.
- Update health, package installation, rollback and system-control requests now prefer the local IPC channel, removing persistent `UPDATER_DNS_ERROR` failures observed after in-app self-updates on Synology DSM.
- Post-update validation and `diagnose.sh` now test the IPC channel first and fall back to TCP only when required.
- The existing detached full Compose restart remains as a secondary recovery mechanism, but updater availability no longer depends on Docker DNS being rebuilt correctly.
- Added a dedicated IPC regression test and retained the updater finalizer log at `data/updates/updater-finalizer.log`.

## 2.20.15 - 2026-09-01

- Changed the detached post-update finalizer to perform a complete Docker Compose `down` / clean `up` cycle after updater self-replacement.
- Recreated the project network and Docker DNS aliases instead of relying only on individual service recreation, matching the manual `stop.sh` + `start.sh` recovery used on Synology DSM.
- Started services in dependency-safe order and restored optional HTTPS/Caddy automatically.
- Retried the full restart once and persisted finalizer diagnostics in `data/updates/updater-finalizer.log`.

## 2.20.14 - 2026-09-01

- Branded the public media/container service as `TMP-Encoder`.
- Added Synology/NAS-safe backend application-code permissions for custom runtime `PUID:PGID` values.
- Changed frontend logo delivery to Vite-managed assets for improved NAS/reverse-proxy compatibility.
- Renamed the optional internal device-pack integration to `TMP Device Pack`.
- Removed automatic third-party device-pack downloads from the distribution package; optional imports now require a locally supplied source archive.
- Removed historical release-note files from the buyer package and added one complete English installation guide.
- Completed the Add Camera localization for all 24 supported UI languages and removed mixed German/English interface text.
- Switched automatic camera placeholders to language-neutral `CAM-*` names while preserving legacy `Kamera-*` numbering compatibility.
- Prevented raw German discovery evidence/generated discovery names from leaking into the Add Camera UI.
- Added direct recording storage on network devices using SMB/CIFS or SFTP/SSH with server, port, share/path and encrypted credential configuration from the web UI.
- Added connection/write verification, automatic transfer retry, remote playback/export materialization and a bounded local playback cache.
- Added complete Recording Storage UI translations for all 24 supported languages while keeping the SQLite database and active recording spool local for resilience.
- Stabilized in-app updater self-replacement on Synology DSM and legacy Docker Compose by waiting for the new updater health state and validating Docker DNS from the backend.
- Added automatic backend/frontend network recovery only when the backend cannot resolve/reach the recreated updater.
- Suppressed expected transient `UPDATER_DNS_ERROR` diagnostics during the bounded post-update restart grace period and added a persistent finalizer log for troubleshooting.
