# TMP Camera Surveillance Next 2.20.48 – Auto-Fallback bei fehlenden Medienframes

- **Mainstream darf nicht blockieren:** Im Auto-Modus wartet ein bevorzugtes Profil nur begrenzt auf die ersten normalisierten Medienframes.
- **Acht-Sekunden-Fenster:** Standardmäßig gelten `STREAM_AUTO_PROFILE_FIRST_FRAME_TIMEOUT_MS=8000`.
- **Direkter Profilwechsel:** Kommen in diesem Fenster keine nutzbaren Frames, wird der Versuch als `PROFILE_MEDIA_TIMEOUT` gewertet und direkt das nächste schwächere Profil versucht.
- **Kein unnötiger Encoder-Zyklus:** Ein frame-loser Mainstream führt nicht mehr zu Copy → VAAPI → CPU auf demselben Profil.
- **Manuelle Auswahl bleibt bewusst:** Manuell gewählte Profile behalten den normalen Starttimeout und werden nicht automatisch nach acht Sekunden heruntergestuft.
- **Sticky Fallback bleibt bestehen:** Sobald Balanced/Secondstream/Substream erfolgreich läuft, bleibt dieses Profil für weitere Reconnects bevorzugt.

Ziel ist: Auto soll lieber schnell ein stabiles Livebild vom schwächeren Profil liefern, statt lange auf einem Mainstream ohne verwertbare Frames zu warten.
