# Übersetzungen, Sprachumschaltung und Qualitätssicherung

Die Browseroberfläche von **TMP Camera Surveillance Next 2.20.112** unterstützt 24 Sprachen. Das internationale Übersetzungssystem liegt unter `frontend/src/i18n/`.

## Unterstützte Sprachen

| Code | Sprache | Code | Sprache |
|---|---|---|---|
| `de` | Deutsch | `en` | English |
| `fr` | Français | `es` | Español |
| `it` | Italiano | `nl` | Nederlands |
| `pl` | Polski | `pt-BR` | Português (Brasil) |
| `tr` | Türkçe | `cs` | Čeština |
| `da` | Dansk | `sv` | Svenska |
| `nb` | Norsk Bokmål | `fi` | Suomi |
| `ro` | Română | `hu` | Magyar |
| `el` | Ελληνικά | `uk` | Українська |
| `ru` | Русский | `ar` | العربية (RTL) |
| `zh-CN` | 简体中文 | `zh-TW` | 繁體中文 |
| `ja` | 日本語 | `ko` | 한국어 |

Die Sprache wird zuerst aus der im Browser gespeicherten Auswahl, danach aus Browser-/Systemsprachen und schließlich aus Englisch ermittelt. Aliase wie `de-DE`, `pt-BR` und `zh-Hant` werden normalisiert. Für `zh-HK`/`zh-MO` ist traditionelles Chinesisch vorgesehen, für `zh-SG` vereinfachtes Chinesisch. Arabisch setzt `dir="rtl"`, andere Sprachen bleiben links-nach-rechts.

## Architektur

- `languages.js`: Sprachliste, regionale Aliase und Richtungsinformation.
- `messages.js`: zentrale Übersetzungszusammenführung; Englisch ist technischer Fallback, wenn ein Text tatsächlich fehlt.
- `coreEnhancements.js` und Themenmodule (Kameras, Aufnahmen, Kiosk, Update-Center, Netzwerk, Benachrichtigungen, KI): weitere Sprachpakete.
- `licenseUiIntl.js`: native UI-Texte für 22 internationale Sprachen auf der Lizenzseite.
- `I18nProvider.jsx`: ausgewählte Sprache, Browser-Speicherung, Datums-/Zahlenformatierung und Dokumentrichtung.
- `LegacyLocalizationBridge.jsx` / `legacyPhrases.js`: Übersetzung noch nicht vollständig umgestellter deutschsprachiger Alt-Komponenten.

**Wichtig:** Vollständige *Key-Parität* bedeutet nicht, dass jeder Text semantisch vollständig übersetzt ist: Einige historische bzw. spezialisierte Meldungen greifen noch auf Englisch zurück. Technische Produkt-/API-Namen bleiben absichtlich unverändert. Neue UI-Texte sollten immer über `t('bereich.schluessel')` laufen, nicht direkt als deutsche oder englische Literale in Komponenten stehen.

## Korrekturen ab 2.20.104

1. Die Lizenzseite hat bisher für alle 22 internationalen Sprachen durch einen letzten `productLicenseLabels.en`-Override wieder englische UI-Texte erhalten. Die deutsche und englische Version waren korrekt. Der Override verwendet nun die neu angelegten nativen Sprachzeilen.
2. Die **Detailabschnitte der rechtlichen Zusammenfassung** sind weiterhin nur auf Deutsch und Englisch vorhanden (`licenseContent.js`). Für alle anderen Sprachen zeigt die Oberfläche eine übersetzte, explizite Information, dass die Detailabschnitte auf Englisch erscheinen. Die mitgelieferte Lizenzvereinbarung bleibt maßgeblich.
3. Regionale chinesische Browser-Sprachcodes für Hongkong und Macau verwenden die traditionelle Schrift statt des vereinfachten Fallbacks.
4. Automatisierte Tests prüfen alle 24 Sprachpakete, Schlüsselgleichheit, Variablenplatzhalter, die Lizenzseiten-Bedienelemente und regionale/RTL-Sprachzuordnung.

Diese Prüfung ist eine **technische und gezielte redaktionelle QA**. Sie ist keine beglaubigte Übersetzung sämtlicher rechtlicher Detailabschnitte und ersetzt keine muttersprachliche Korrektur bei einer öffentlichen Freigabe.

## Prüfung lokal durchführen

Am Repository-Stammverzeichnis:

```bash
node --version
npm ci --prefix frontend --no-audit --no-fund
find frontend/src/i18n -maxdepth 1 -type f -name '*.test.mjs' ! -name 'recordings.test.mjs' -print0 | xargs -0 node --test
npm run test --prefix frontend -- src/i18n/recordings.test.mjs
npm run build --prefix frontend
```

Node.js 24 LTS ist für den aktuellen Frontend-Build empfohlen. Der erweiterte Test `licenseUiIntl.test.mjs` überprüft insbesondere, dass internationale Rechtsseiten **nicht** versehentlich durch Englisch überschrieben werden.

Der zugehörige GitHub-Actions-Workflow unter `.github/workflows/localization-documentation.yml` führt die automatisierten Lokalisierungs- und Build-Prüfungen im Pull Request bzw. auf `main` durch.

## Vorgehen für neue oder korrigierte Übersetzungen

1. Prüfen, ob der gewünschte Schlüssel bereits in `messages.en` und einem passenden Themenpaket existiert.
2. Schlüssel in **allen 24 Sprachpaketen** ergänzen und die Bedeutung des englischen Referenztextes beibehalten.
3. Variablen in geschweiften Klammern (z. B. `{name}`, `{count}`) in jeder Sprache **unverändert** übernehmen; nur den Text darum herum übersetzen.
4. Für dynamische Zahlen/Datumswerte die vorhandenen `formatNumber`- und `formatDate`-Helfer einsetzen.
5. Für Arabisch RTL, Icon-Abstände, Navigation und Mischtext prüfen; für Chinesisch beide Schriftsysteme überprüfen.
6. `node --test frontend/src/i18n/*.test.mjs` und `npm run build --prefix frontend` ausführen. Fehlende Schlüssel oder unzulässige Platzhalter verhindern die Freigabe.
7. Für Nutzertexte einen echten Browser-Sichttest durchführen. Automatische Schlüsseltests erkennen keine abgeschnittenen Buttons oder missverständlichen Formulierungen.

## Sprachumfang der privaten PHP-Cloud

Die separat bereitgestellte Plesk-WebApp (aktuell 3.1.2) ist **nicht Bestandteil des GitHub-Frontends** und übernimmt dessen 24-Sprachen-Katalog nicht automatisch. Diese Datei bleibt privat und wird nur über den separaten Betreiberprozess gepflegt. Deshalb beziehen sich die Prüfungen in diesem Dokument auf die React-Anwendung, **nicht** auf eine angeblich vollständig übersetzte PHP-WebApp.
