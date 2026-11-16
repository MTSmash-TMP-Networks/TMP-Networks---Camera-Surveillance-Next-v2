# TMP Camera Surveillance Next 2.20.54 – Stream Resource Guard

- **Broker-Ref-Leak behoben:** Eine recovering Session erhöht beim Wiederverwenden desselben go2rtc-Brokers den Refcount nicht erneut. Beim Profil-/Encoderwechsel wird der vorherige Broker zuerst sauber freigegeben.
- **Verwaiste Broker werden entfernt:** Der Stream-Wartungszyklus korrigiert fehlerhafte Refcounts und löscht go2rtc-Broker ohne Session-Owner.
- **Restart-Historie bleibt erhalten:** Ein Stream muss mindestens 60 Sekunden stabil laufen, bevor seine Fehlerhistorie zurückgesetzt wird.
- **Circuit Breaker:** Nach sechs kurzen Start-/Absturzzyklen wird der nächste automatische Neuaufbau standardmäßig mindestens 120 Sekunden verzögert.
- **Kein CPU-Snapshot-Fallback für Dauerpfade:** Permanente Preview-, Recording-, Motion- und Prebuffer-Sessions dürfen nicht mehr auf Snapshot→H.264/libx264 ausweichen.
- **Sticky CPU-Fallback bleibt erlaubt:** Copy → VAAPI → CPU bleibt verfügbar und wird bei stabilem CPU-Pfad nicht wieder zurückgeschaltet.
- **Prebuffer nicht mehr automatisch Mainstream:** Event-Vorlaufpuffer nutzt einen eigenen `prebuffer`-Pfad in der konfigurierten Standby-Qualität.
- **Synthetic Streams nicht recordbar:** Snapshot-/Snapshot-Video-Sessions werden nicht als Recording-/Motion-Quelle wiederverwendet.
- **Upgrade-Basis bleibt 2.20.32.**

Der Patch adressiert die CPU-Runaway-Kaskade aus wiederholten FFmpeg-Starts, anwachsenden Broker-Referenzen, zu schnell zurückgesetzter Restart-Historie und CPU-intensiven Fallbackpfaden.
