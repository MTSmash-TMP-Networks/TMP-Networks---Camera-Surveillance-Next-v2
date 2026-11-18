# TMP Camera Surveillance Next 2.20.73 – Visueller Kiosk-Rastereditor

## Bedienung
Im Kioskmodus > Raster verwalten zeigt der Editor die gespeicherten Ansichten oben, links eine durchsuchbare Kameraliste mit kleinen Vorschaubildern sowie rechts das Raster mit den bereits zugeordneten Kamerabildern. Kameras werden links per Drag-and-drop auf eine Kachel gezogen. Bereits zugeordnete Kacheln lassen sich durch Ziehen tauschen; beim Ziehen auf eine leere Kachel wird der Kameraplatz verschoben.

Ohne Drag-and-drop: Kamera links anklicken und Zielkachel rechts anklicken. Die bisherigen Dropdowns bleiben zur barrierearmen Bedienung und zum Entfernen oder Auswechseln einer Kamera erhalten. Einzelne Plätze können leer bleiben. Gespeicherte Raster, automatische Befüllung, Kopieren, Löschen, Namen und Vorlagen bleiben kompatibel.

## Kameravorschauen ohne zusätzliche Live-Streams
Es werden einzelne authentifizierte Kamera-Snapshots aus dem vorhandenen /api/cameras/:id/snapshot-Endpunkt geladen. Bilder werden nur bei Sichtbarkeit angefragt (IntersectionObserver), mit höchstens zwei parallelen Snapshot-Anfragen. Die Vorschau ist keine zweite Echtzeit-Videoverbindung; bei fehlender Kamera antwortet die Karte mit einem Videosymbol, nicht mit einem blockierenden Stream. Jeder Abruf besitzt ein Zeitlimit und wird beim Schließen abgebrochen. Browser-Blob-URLs werden beim Schließen freigegeben. Kein zusätzlicher go2rtc-Reader.

## Erhaltene Architektur und Daten
Die gespeicherten Kiosk-Layouts nutzen weiterhin `tmp-camera-kiosk-layouts-v1`, dieselben Slot-IDs, Rastergrößen und Kamera-IDs. Bestehende Aufnahmen, Bewegungserkennung, HLS-Broker, PTZ, Kaltstart mit 26 Kameras und Racefix im TMP-mediamtx-Image bleiben unverändert. Keine Migration von Datenbank oder .env.

## Prüfung
- Tests für unveränderliche Slot-Zuweisung, Zuordnung ins Raster, Kacheltausch und Speicherrückwärtskompatibilität
- Tests für Lazy-Snapshot-Loader mit maximal zwei parallelen Anfragen, Abbruch und Freigabe der Objekt-URLs
- Frontend-Test für Drag-and-drop, alternative Klick-Zuordnung, Touch/Keyboard-Controls, Sprachtexte, Snapshot-API mit Abbruch
- CI für Frontend-Build, Migration/Updater-Kompatibilität und go2rtc-Broker mit Docker-Classic-Builder

## Installation
Version 2.20.73 regulär im Update-Center, Wartungsfenster wegen Backend-/Frontend-Neustart empfohlen. Nach dem Update den Dialog Raster verwalten öffnen und die Kameras im rechten Raster arrangieren.
