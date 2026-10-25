# Changelog

## [Unveröffentlicht] – Konten für Privatpersonen, Anfragen mit Vorprüfung, Fragebogen

### Neu
- **Persönliches Konto** (`/konto.html`): Anmeldung per E-Mail-Link oder Google auch für Privatpersonen. Übersicht der eigenen Anfragen mit Status, Wartelistenplatz und – nach Zusage – Kontaktdaten; Anfragen zurückziehen; Persönlichkeitsprofil und Anzeigename.
- **Vermittlungsanfragen** über die neue Tierseite `/tier.html?id=…` und den Button „Anfrage stellen“ im Quiz-Ergebnis:
  - Voraussetzungen: Persönlichkeitstest, Nachricht (80–2000 Zeichen), zwei Bestätigungen
  - Grenzen je Person: 3 offen, 5 pro Woche, 1 pro Tier
  - automatische Absage bei Ausschlussgründen oder Passung unter 55 %
  - Kapazität je Anbieter (pro Tier gleichzeitig, pro Tag), sonst Warteliste nach Passung
  - Nachrücken bei Absage, Rückzug, höheren Grenzen und Verfall nach 14 Tagen
  - Schließen offener Anfragen bei Reservierung oder Vermittlung
  - E-Mail-Benachrichtigungen an beide Seiten
- **Postfach** für Tierheime (Tab „Anfragen“) und Privatpersonen: Sortierung nach Passung, Profil und Nachricht der Person, Kennenlernen vorschlagen oder absagen mit Begründung, Grenzen einstellen. E-Mail-Adressen erst nach Zusage sichtbar.
- **Private Abgabe**: eigener Anbieter-Eintrag je Person.
  - höchstens 3 Tiere, Schutzgebühr höchstens 300 €
  - jede Anzeige und jede Änderung wird vor der Veröffentlichung geprüft
  - öffentlich nur PLZ und Ort; der freiwillige Standort wird auf ca. 1 km gerundet
- **Tierprofil im Formular** für Tierheime und Privatpersonen: anlegen und bearbeiten. Charakter per Verhaltensfragebogen (10 Fragen, Live-Vorschau der Skalen) oder Schieberegler.
- **Fragebogen-API**: `GET /v1/questionnaire`, `POST /v1/questionnaire/score`; beim Anlegen per API oder Formular reicht `assessment: { method: "questionnaire", answers }`. Neues Schemafeld `assessment` (`questionnaire | manual | import | api`).
- **Moderation** (`/admin.html`) und Admin-Endpunkte: `GET /v1/admin/animals?review=`, `POST /v1/admin/animals/{id}/review`. Die Oberfläche deckt auch die bestehende Freischaltung von Tierheimen ab.
- Anmelde-Links führen zurück auf die Seite, von der sie angefordert wurden (Verwaltung, Konto oder Tierseite). Andere Ziele sind nicht erlaubt, damit keine offene Weiterleitung entsteht.
- Tests für Fragebogen, Anfragen-Ablauf, Grenzen, Warteliste und private Abgabe (`test/requests.test.js`).

### Geändert
- Datenbank:
  - `shelters` um `kind` (shelter/private), `per_animal_limit` und `daily_request_limit` erweitert
  - `animals` um `review_status` und `review_note` erweitert
  - neue Tabellen `user_profiles` und `adoption_requests`
  - Migration über `npm run db:setup`
- `url` im Tierprofil ist im Schema optional; für Tierheime bleibt der Link zur Tierseite Pflicht (API, Formular, Excel). Ohne Link verweist `url` auf die Pfotenmatch-Tierseite.
- Öffentliche Suche, Matching und Tierheimliste zeigen nur freigeschaltete Anbieter und geprüfte Tiere. `/v1/shelters` listet nur Tierheime.
- Excel-Import, Team-Verwaltung und API-Schlüssel sind Tierheimen vorbehalten.
- Gemeinsame Browser-Helfer in `public/common.js`.
- Mailversand über eine gemeinsame `sendMail`-Funktion (SMTP oder Server-Log).

## 0.3.0 – Login, Excel-Import mit Fotos, Freischaltung
## 0.2.0 – Standortabfrage, gelb-braunes Design
## 0.1.0 – Tierheim-API mit einheitlichem Tierprofil und Persönlichkeitstest
