# TMP Camera Surveillance Next 2.20.68 – Absturzfreier TMP Hardened Media Broker (gezielter Race-Fix)

## Produktionsfehler und Ursache
In der bisherigen go2rtc-Version 1.9.14 stuerzte der Prozess mit `fatal error: concurrent map writes` in `internal/streams.apiStreams` an `api.go:101` ab. Nach 29 Container-Neustarts und 15 STREAM_STALLED-Ereignissen innerhalb von 15 Minuten war klar: Der Broker wird durch parallele Verwaltungsanfragen destabilisiert. `OOMKilled=false`. RTSP-Timeouts einzelner Kameras erschweren den Streamaufbau, sind aber nicht die direkte Ursache dieses Go-Runtime-Crashs.

## Eigener TMP-Medienbroker
- Reproduzierbarer, versionsgepinnter go2rtc v1.9.14-Quellcode: `b5948cfb25404cc5cb37b166ecaa2dca20b11d4b`.
- Synchronisiert globales Streaminventar bei GET/DELETE, erstellt einen Map-Snapshot fuer JSON-Antworten und synchronisiert den Status-Endpunkt `/api` gegen paralleles Map-Schreiben.
- Der Quellcode-Patch ist unter `mediamtx/patches/go2rtc-http-streams-races.patch` dokumentiert. Upstream-Primaerquelle: AlexxIT/go2rtc PR #2444 (Stand zum Release nicht gemergt).
- Die tatsaechliche go2rtc-Binaerdatei wird mit Go gebaut und als einzige Datei in das Original-Image `alexxit/go2rtc:1.9.14` uebernommen. Damit bleiben FFmpeg, Intel-VAAPI, tini und die bisherige go2rtc.yaml erhalten.
- Build-Zwangstest mit Go Race Detector: 40 Streamnamen, acht gleichzeitige Streamlisten-Leser und acht schreibende Goroutinen. Docker-Image wird nur bei bestandenem Test gebaut.
- Der Updater und `start.sh` bauen `mediamtx` zusammen mit Backend und Frontend, bevor die alten Container abgeloest werden. Ein fehlgeschlagener Broker-Build bricht ab, statt die Kameraanlage auf einen unvollstaendigen neuen Broker umzuschalten.

## Kompatibilitaet
- Updatevertrag weiterhin ab v2.20.32. Bestehende .env, Datenbank, Kameraeinstellungen, Netzwerkspeicher und Aufnahmen werden beibehalten.
- FFmpeg / VAAPI / H.264-Copy-First / go2rtc-Portbelegung und Aufnahmepfade bleiben unveraendert.
- Diese Version behebt die nachgewiesene Go-Map-Race-Crashursache. Sie ist keine generelle Garantie, dass Kameras bei externen Netzwerkproblemen niemals ausfallen. Die separat begonnenen Local-HLS-Pufferanpassungen werden nach dem Broker-Fix geprueft und sind nicht Bestandteil dieses Releases.

## Installation
Normales Update ueber das Update-Center, vorzugsweise im Wartungsfenster. Der Updater kompiliert den TMP-Broker vor dem geplanten Container-Neustart. Der erstmals ausgefuehrte Go-Build kann mehr Ressourcen benoetigen als ein reiner Frontend-Build. Kameraausgabe und laufende Aufnahmen koennen waehrend der regulaeren Container-Neustarts kurz unterbrochen werden.

## Nachpruefung
```bash
cd /home/kamera/TMP-Networks---Camera-Surveillance-Next-v2 || exit 1
cat VERSION
sudo docker inspect tmp-camera-surveillance-next-mediamtx-1 --format 'Image={{.Config.Image}} RestartCount={{.RestartCount}} OOMKilled={{.State.OOMKilled}}'
sudo docker logs --since 30m tmp-camera-surveillance-next-mediamtx-1 2>&1 | grep -E 'fatal error|concurrent map|panic:' || true
sudo docker stats --no-stream
```
Reale 25-Kamera-Stabilitaet mit aktivierter Bewegungserkennung und Aufnahme pruefen. Kriterium: kein go2rtc-Go-Map-Panic, keine unerklaerlichen Broker-Neustarts und deutlich weniger Publisher-Neuanmeldungen. Bei RTSP-Timeouts einzelner Kameras gezielt Netzwerk/Quelle diagnostizieren.
