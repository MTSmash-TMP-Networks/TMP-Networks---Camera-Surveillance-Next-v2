# TMP Camera Surveillance Next 2.20.86 – HTTPS-Fernzugriff automatisch aktiv

## Neuer Standard
Bei einer Neuinstallation startet der ausgehende Cloud-Agent automatisch. Bereits installierte Kamera-Server erhalten bei diesem Update eine einmalige Migration von AUS auf AKTIV. Der schon vorhandene Installationsschluessel, die persistente Server-ID und die Kamera-Konfiguration bleiben erhalten. Danach bewusst vorgenommene lokale Deaktivierungen bleiben bestehen.

Eine Installation meldet sich ohne Kopplungscode per HTTPS an `https://support.tmp-networks.de/cam/` an. Nutzer melden sich dort mit Server-ID und den normalen Kamera-Zugangsdaten an. Der private PHP-Portaladministrator darf eine Server-ID vollstaendig sperren.

## Ursache von 'Route GET /api/system/remote-proxy nicht gefunden'
Der Fehler kommt von einem noch veralteten Backend-Container, auch wenn der Frontend-Code aktuell ist. Die API-Route ist seit 2.20.84 im Repo definiert. Die neue Release prueft `features.remoteProxy` im Backend-Healthcheck und zeigt fehlende Backend-Routen explizit als NICHT VERFUEGBAR statt AUS. Die Systemseite aktualisiert den Status regelmaessig.

## Upgrade / Reparatur
Die normale Updatecenter-Installation erstellt die geaenderten Images neu. Wenn ein zuvor unterbrochenes Update einen alten Container hinterlassen hat, im Kamera-Projektverzeichnis ausfuehren:

```sh
sudo docker compose build backend frontend
sudo docker compose up -d --no-deps --force-recreate backend frontend
sudo docker compose ps
sudo docker compose logs --tail=100 backend
```

Die Version und Faehigkeiten des Backends pruefen:

```sh
sudo docker compose exec -T backend node -e "fetch('http://127.0.0.1:3000/health').then(r=>r.json()).then(console.log)"
```

Bei Version 2.20.86 steht `features.remoteProxy: true` in der Antwort. Die authentifizierte Route `/api/system/remote-proxy` soll einen Adminstatus ausgeben; ohne gueltige Anmeldung ist HTTP 401 statt 404 normal.

`.env`, `data/`, Aufnahmen, Logins, Kamera-/Kiosk-Einstellungen und Updatesicherungen bleiben unveraendert. Kompatibel ab 2.20.32. Die private Plesk-PHP-/MySQL-Portaldatei wird getrennt verteilt und gehoert nicht ins oeffentliche GitHub-Repository.
