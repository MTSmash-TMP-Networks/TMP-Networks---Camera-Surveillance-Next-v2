# TMP Camera Surveillance Next 2.20.47 – Mainstream-Fallback ohne Festbeißen

- **Mainstream bleibt bevorzugt:** Für Liveansichten wird weiterhin zuerst das stärkere Profil versucht.
- **Automatischer Downgrade:** Wenn der Mainstream nicht sauber startet, werden automatisch Balanced- und Low-/Substream-Profile versucht, bis ein nutzbares Livebild vorhanden ist.
- **Erfolgreicher Fallback bleibt sticky:** Läuft ein schwächeres Profil stabil, wird genau dieses Profil bei weiteren Reconnects derselben Session zuerst verwendet.
- **Kein aggressives Zurückspringen:** Ein zuvor fehlgeschlagenes Mainstream-Profil wird nach einem erfolgreichen Downgrade nicht bei jedem Recovery wieder erzwungen.
- **Profilbezogene Fehler-Memory:** Fehler eines Mainstream-Profils markieren nicht mehr versehentlich den Substream als problematisch, selbst wenn URI-/Transportmerkmale ähnlich sind.
- **Bestehende Stabilitätsregeln bleiben aktiv:** Local-HLS-Ring, Kiosk-Lifecycle-Fix und Sticky Encoder bleiben unverändert.

Ziel ist: Lieber sofort ein schwächeres, stabiles Livebild als dauerhaft kein Bild, weil sich die Session an einem nicht funktionierenden Mainstream festbeißt.
