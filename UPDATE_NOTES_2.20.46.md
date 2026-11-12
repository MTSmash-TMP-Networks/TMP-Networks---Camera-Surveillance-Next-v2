# TMP Camera Surveillance Next 2.20.46 – Sticky Kiosk-Encoder

- **Kein Fallback-Tanzen im Kiosk:** Der Kiosk darf keinen separaten Browser-Transcode-Fallback mehr anfordern.
- **Serverseitig abgesichert:** Selbst wenn der globale Browser-Fallback aktiviert ist, wird `forceTranscode` für `purpose=kiosk` ignoriert.
- **VAAPI→CPU bleibt fest:** Fällt VAAPI für eine konkrete Kamera/Profil/Quelle aus und Software übernimmt, bleibt dieser Softwarepfad bis zum Backend-Neustart aktiv.
- **Keine 10-Minuten-Rückprobe mehr:** Die bisherige Cooldown-Logik, die fehlgeschlagene Encoder nach zehn Minuten erneut ausprobiert hat, wurde entfernt.
- **Deterministische Encoderwahl:** Copy-, VAAPI- und Softwarepfade werden pro Kamera/Profil/Quelle nicht zyklisch hin- und hergeschaltet.
- **Local-HLS bleibt primär:** Der 30-Sekunden-Local-HLS-Ring sowie die Kiosk-Lifecycle- und Soft-Stall-Fixes aus 2.20.44/2.20.45 bleiben unverändert bestehen.

Ziel ist ein ruhiger Kioskmodus: Sobald ein stabiler Pfad gefunden wurde, wird dieser gehalten. Ein automatisches Zurückspringen auf einen zuvor fehlgeschlagenen GPU-Pfad findet erst nach einem bewussten Backend-Neustart wieder statt.
