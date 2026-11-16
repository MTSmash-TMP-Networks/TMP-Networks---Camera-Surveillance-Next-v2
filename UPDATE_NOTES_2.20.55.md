# TMP Camera Surveillance Next 2.20.55 – Stabiler Live-Reconnect

- **Browser respektiert Backend-Backoff:** Session- und Heartbeat-Abfragen starten einen fehlgeschlagenen permanenten Kamera-Publisher nicht mehr sofort neu.
- **Kein LIVE_CONNECT_FAILED-Reconnect-Sturm mehr:** Live/Kiosk warten bei permanenten Preview-Publishern auf den kontrollierten Backend-Restart.
- **Restart-Zeitpunkt sichtbar:** `restartAt` wird an Status und Browser weitergereicht.
- **Profil + Transport sticky:** Nicht nur das Profil, sondern der zuletzt funktionierende konkrete Kandidat inklusive TCP/UDP wird beim Reconnect bevorzugt.
- **Preview video-only:** Permanente Preview-, Motion- und Prebuffer-Pfade erzeugen keinen optionalen AAC-Transcode mehr.
- **Mehr First-Frame-Toleranz:** Auto-Profil-Fallback wartet jetzt bis zu 12 Sekunden auf erste Medienframes.
- **Upgrade-Basis bleibt 2.20.32.**

Der Patch adressiert das beobachtete Muster aus `LIVE_CONNECT_FAILED`, `GLOBAL_CAMERA_START_QUEUED`, erneutem Local-HLS-Aufbau und wechselnden TCP/UDP-Profilversuchen, obwohl der Backend-Publisher bereits seinen eigenen kontrollierten Recovery-Zyklus verwaltet.
