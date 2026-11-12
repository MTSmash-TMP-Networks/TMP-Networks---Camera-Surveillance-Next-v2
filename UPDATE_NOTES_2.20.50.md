# TMP Camera Surveillance Next 2.20.50 – Shared Warm Stream Architecture

- **Live Auto nutzt den warmen Preview-Publisher:** Beim Kamerawechsel muss kein neuer Mainstream mehr aufgebaut werden. Der bereits beim Backend-Start laufende permanente Substream/Preview-Ingest wird direkt verwendet.
- **Kein Viewport-getriebener Mainstream mehr:** Die Live-Fenstergröße wandelt `Auto` nicht mehr in `high` oder `balanced` um.
- **Shared Backend Publisher:** Der permanente Ingest gehört keinem einzelnen Browser-Consumer mehr. Kiosk und Live können denselben warmen Publisher verwenden.
- **Auto bleibt Auto:** Auch während Status-Polling und Wiederanbindung bleibt die ursprüngliche `quality=auto`-Anfrage erhalten; dadurch entsteht keine zweite Low-Live-Session.
- **Explizite Qualität bleibt möglich:** Eine manuelle Profil-/Qualitätsauswahl kann weiterhin gezielt einen Mainstream oder anderes Profil anfordern.
- **Recording bleibt hochwertig:** Recording Auto fordert explizit High/Mainstream an.
- **Mainstream-Sharing bleibt aktiv:** Existiert bereits ein geeigneter Mainstream, wird dieser über `retain()` für Recording wiederverwendet statt eine zweite Kamera-Verbindung zu öffnen.
- **Stabilitätsregeln bleiben aktiv:** 30-Sekunden-Local-HLS-Ring, Sticky Profile und Sticky Encoder bleiben unverändert.

Ziel ist: Kamerawechsel in Live soll sich an einen bereits laufenden Stream hängen, statt die Kamera jedes Mal neu zu initialisieren. Aufnahmen dürfen weiterhin Mainstream-Qualität nutzen, aber vorhandene Publisher sollen geteilt werden.
