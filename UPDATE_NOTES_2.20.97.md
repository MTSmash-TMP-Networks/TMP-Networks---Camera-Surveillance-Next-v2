# TMP Camera Surveillance Next – 2.20.97

## Liveansicht: Kamerawechsel ohne zweiten Stream

Version 2.20.96 hatte fuer den Liveplayer einen React-Key mit Kamera-ID
hinzugefuegt. Das loeste einen vollstaendigen Remount bei jedem Wechsel aus,
obwohl der Stream-Pool den Videoknoten absichtlich persistent haelt.

### Reparatur

- LivePage verwendet wieder den bestehenden SeamlessLivePlayer ohne Kamera-Key.
- liveStreamPool verwendet `host.replaceChildren(entry.video)` statt
  `appendChild`. Es kann dadurch kein zweiter Videoknoten im selben Host stehen.
- Audio-Modus und Ton-Stummschaltung gelten nur fuer die aktiv angezeigte
  Kamera. Nach dem Wechsel wird die Audioanforderung zurueckgesetzt.
- Audio aus 2.20.96 bleibt ueber die Lautsprechertaste explizit verfuegbar.
- Regressionstests kontrollieren sowohl den einzelnen Player als auch
  den Kamerawechsel mit Audio.

### Unveraendert

Die private Plesk-PHP-WebApp 3.1.1 bleibt ausserhalb des GitHub-Repositories.
Backend, Kamera-Stream-Orchestrierung, HLS-Ring, Kioskmodus, gespeicherte
Aufnahmen, MySQL-Daten und Registrierung werden nicht veraendert.

### Nach dem Update pruefen

Zwei Kameras abwechselnd mehrfach anklicken. In der Liveansicht darf immer
nur ein Videofenster stehen. Danach Ton aktivieren und die Kamera wechseln:
die naechste Kamera muss zunaechst stumm starten.
