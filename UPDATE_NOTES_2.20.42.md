# TMP Camera Surveillance Next 2.20.42 – Codec-Erkennung und Intel-N97-CPU-Entlastung

- **Reolink und andere ONVIF-Kameras ohne Codecangabe:** Bei `videoCodec: null` wird jetzt zuerst die ressourcenschonende Stream-Kopie probiert. Vor der Browserfreigabe prueft FFprobe den tatsaechlichen Codec eines lokal erzeugten MPEG-TS-Segments. Nur bestaetigtes H.264 wird direkt weitergereicht; bei H.265 oder Fehlern greift der unveraenderte VAAPI-/Software-Fallback.
- **Keine Codec-Vermutung anhand des Namens:** Die Videoanalyse arbeitet nur mit echten Medienframes und protokolliert `BROKER_CODEC_VERIFIED` mit `observedVideoCodec`, niemals mit Zugangsdaten.
- **VAAPI-Weitergabe:** Backend erhaelt den `ENABLE_INTEL_GPU_COMPOSE`-Wert und unterstuetzt `auto` nach vorheriger GPU-Freigabe. Ein ausdrueckliches `GO2RTC_FFMPEG_HARDWARE=none` bleibt bindend. Die Aktivierung ueber `scripts/intel-vaapi.sh --enable` wird weiterhin vorausgesetzt.
- **Encoder-Wahl nachvollziehbar:** `BROKER_ENCODER_CANDIDATES`, `STREAM_READY.videoEncoder` und begruendete Fallback-Ereignisse helfen, CPU-intensive Kameras zu finden.
- **Temporäre Fehler:** Ein einmaliger Copy-/VAAPI-Fehler wird nur fuer diese Quelle und zehn Minuten gemerkt, nicht dauerhaft bis zum Backend-Neustart.
- **Host-Diagnose:** `sudo sh ./scripts/camera-encoder-diagnostics.sh` zeigt die wirksamen GPU-/Copy-Einstellungen und die laufenden go2rtc-Encoder ohne Kamera-Passwoerter.
- **Kompatibilitaet:** Vollstaendiges Update, Mindeststand 2.20.32, gleiche Root-Allowlist wie Legacy-Updater; `.env`, `.git` und `data/` bleiben unveraendert. Ein Dienstneustart kann Livebilder kurz unterbrechen.

Der tatsaechliche Lastgewinn kann erst nach Installation unter gleichen Kamerabedingungen gemessen werden.
