# TMP Camera Surveillance Next 2.20.94 – Kritischer Archiv-HLS-Fix

## Fehlerursache
Der Direkttest des Kameraservers zeigte bei der URL-Pruefung
`ReferenceError: parsed is not defined` in `backend/src/services/remoteProxyPolicy.js:19`.
Das URL-Objekt wurde mit `const parsed` innerhalb eines `try`-Blocks deklariert, nach dem Block jedoch fuer Archiv-HLS- und weitere Aufnahmepfade verwendet. Wegen JavaScript-Block-Scope bricht die Cloud-Agentenpruefung mit einer Exception ab, bevor ein Archiv-HLS-Auftrag den Backend-Player erreicht.

## Korrektur
- Deklaration des URL-Objekts ausserhalb des `try`-Blocks; Zuweisung innerhalb des `try`.
- Zusaetzlich fragmentehaltige Anfragen blockieren.
- Regressionstest prueft echte Aufrufpfade fuer Archivplaylist, Aufnahmesegmentliste und alte Kurzclip-Downloads: Erlaubte GET-Anfragen duerfen keine Exception werfen, unbekannte Query-Parameter bleiben gesperrt.
- Keine Aenderungen an der Kameraaufnahme, dem NAS, dem Live-HLS-Ring, der MySQL-Installation, der permanenten Cloud-ID oder den Anmeldedaten.
- Die vertrauliche PHP-WebApp bleibt bei Version **3.1.0**, wird nicht nach GitHub uebernommen und benoetigt fuer diesen Bugfix keine Neuinstallation.

## Update
1. In der lokalen Kamera-Software das Update **2.20.94** ueber das Updatecenter installieren.
2. Plesk-Portal `/cam/index.php` auf **3.1.0** belassen.
3. Die iPhone-WebApp wieder oeffnen, eine fertige Aufnahme abspielen und die erste 30-Sekunden-HLS-Archivaufbereitung pruefen.
4. Sollte weiterhin eine Warteanzeige erscheinen, die Fehlermeldung im Browser und die Archiv-Cache-Diagnose erneut pruefen. Ein vorhandenes Archiv-HLS-Verzeichnis ist dann ein erster Hinweis, dass der Agent die Anfrage inzwischen durchreicht.

## Status
Der absturzverursachende Variablenzugriff ist aus dem Code und dem realen Direkttest belegt. Der Hotfix behebt diesen konkreten Agenten-Abbruch. Ob zusaetzlich NAS-/FFmpeg-Probleme auftreten, laesst sich erst nach erneuter Ausfuehrung auf dem produktiven Server bestaetigen.
