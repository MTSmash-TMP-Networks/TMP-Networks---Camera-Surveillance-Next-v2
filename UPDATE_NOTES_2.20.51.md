# TMP Camera Surveillance Next 2.20.51 – Abwärtskompatibel bis 2.20.32

- **Direkte Upgrade-Basis bleibt 2.20.32:** Die vier Kompatibilitätsfelder `minimumVersion`, `minVersion`, `compatibleFrom` und `fromVersion` bleiben fest auf `2.20.32` gesetzt.
- **Laufzeitdaten geschützt:** `.env`, `data` und `.git` bleiben als Preserve-Pfade Bestandteil des Release-Vertrags und werden jetzt zusätzlich automatisiert geprüft.
- **Legacy-Updater-Vertrag gehärtet:** Root-Pfade, Manifest, Dateizahl, Prüfsummen, Paketversionen und Compose-Version werden weiterhin gegen die 2.20.32-Basis validiert.
- **Keine Funktionsänderungen:** Shared Warm Streams, Recording, Local-HLS, Sticky Profile und Sticky Encoder bleiben unverändert.

Ziel ist, dass auch Installationen ab TMP Camera Surveillance Next 2.20.32 weiterhin direkt auf die aktuelle Version aktualisiert werden können, ohne Zwischenversionen installieren zu müssen.
