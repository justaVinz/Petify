# Petify

Petify is an Open Source pet rehoming webapp, which allows institutions and individuals to create personality entries for the pets. We then match those personalities based of a character test to you and provide information on how to reach out to your new saved pet.

**Deutsch:** Persönlichkeitstest, der passende Tiere aus Tierheimen und geprüften Privatabgaben in der Umgebung vorschlägt – und eine **einheitliche API**, über die Tierheime ihre vermittelbaren Tiere erfassen.

- **Quiz** (`/`): 13 Fragen zu Persönlichkeit und Lebensumständen → Tier-Typ und die passendsten Tiere mit Charakterbogen, direkter Anfrage und Link zur Tierheimseite
- **Tierseite** (`/tier.html?id=…`): Charakterbogen und Vermittlungsanfrage mit automatischer Vorprüfung
- **Konto** (`/konto.html`): Privatpersonen sehen ihre Anfragen und ihr Profil – und können selbst ein Tier zur Vermittlung anbieten (moderiert)
- **Verwaltung** (`/verwaltung.html`): Tierheime melden sich per E-Mail-Link oder Google an, tragen Tiere per Excel, Formular oder Fragebogen ein, beantworten Anfragen im Postfach
- **Moderation** (`/admin.html`): neue Tierheime freischalten, private Anzeigen prüfen (Zugang mit `ADMIN_TOKEN`)
- **API** (`/v1/…`): Tierheime legen Tiere im einheitlichen Format an; öffentliche Suche und Matching
- **Doku** (`/docs.html`): interaktive OpenAPI-Dokumentation, Spezifikation unter `/openapi.json`

Änderungen stehen im [CHANGELOG](CHANGELOG.md). Lizenz: [MIT](LICENSE).

Stack: Node.js 22, Express, PostgreSQL, JSON-Schema-Prüfung mit Ajv.

## Schnellstart

```bash
docker run -d --name petify-db -e POSTGRES_USER=virony -e POSTGRES_PASSWORD=virony -e POSTGRES_DB=petify -p 5432:5432 postgres:16-alpine
npm install
cp .env.example .env          # ADMIN_TOKEN unbedingt ändern
npm run db:setup              # Schema + Beispiel-Tierheime; gibt deren API-Schlüssel einmalig aus
npm start                     # → http://localhost:3200
npm test
```

## Verwaltungsbereich für Tierheime

**Anmeldung ohne Passwort**
- *E-Mail-Link:* 15 Minuten gültig, nur einmal nutzbar. Der Link öffnet die Seite, erst die Seite bestätigt die Anmeldung. So verbrauchen E-Mail-Scanner, die Links vorab öffnen, den Link nicht. Ohne `SMTP_URL` steht der Link im Server-Log (Entwicklung).
- *Google:* OpenID Connect mit PKCE, nur mit bestätigter Google-Adresse. Einrichtung: in der Google Cloud Console einen OAuth-Client „Webanwendung“ anlegen, als Weiterleitungs-URI `APP_URL/auth/google/callback` eintragen, `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` setzen. Ohne diese Werte wird der Google-Button ausgeblendet.
- Sitzungen liegen als Hash in der Datenbank; der Browser bekommt nur ein HttpOnly-Cookie (`SameSite=Lax`, bei HTTPS `Secure`). Schreibende Anfragen brauchen zusätzlich den Header `x-petify: 1` (CSRF-Schutz).

**Ablauf für ein neues Tierheim**
1. Anmelden → Tierheim eintragen (Status *in Prüfung*). Die anmeldende Person wird Admin.
2. Tiere per Excel importieren – sie sind gespeichert, aber noch nicht öffentlich.
3. Die Plattform schaltet frei: `POST /v1/admin/shelters/{id}/status` mit `{"status":"active"}` und `X-Admin-Token`. Offene Anträge: `GET /v1/admin/shelters?status=pending`.
4. Ab dann erscheinen vermittelbare Tiere in Suche und Quiz. Admins können Kolleg:innen per E-Mail-Adresse hinzufügen und einen API-Schlüssel erzeugen.

**Excel-Import**
- Vorlage mit Auswahllisten, Zahlenprüfung (1–5), Hinweisen in den Kopfzellen und einem Blatt „Anleitung“: `GET /portal/api/import-template.xlsx`.
- Deutsche Werte („Hund“, „ja“, „ab Alter“, „10.02.2026“) werden ins Einheitsformat übersetzt. Jede Zeile wird gegen das Schema geprüft; alle Fehler einer Zeile werden auf einmal mit Spaltennamen gemeldet.
- Erst Vorschau (neu / aktualisieren / übersprungen, gefundene und fehlende Fotos), dann Übernahme. Abgleich über die Karteinummer, ein erneuter Import aktualisiert also.
- Fotos werden zusammen mit der Datei hochgeladen; in der Spalte „Fotos“ stehen die Dateinamen (Groß-/Kleinschreibung egal) oder https-Links.

**Fotos**: JPG, PNG oder WebP bis 12 MB, höchstens 12 pro Tier. Der Inhalt wird geprüft, das Bild gedreht (EXIF), auf 1600 px verkleinert, als WebP gespeichert und um Metadaten wie GPS-Koordinaten bereinigt. Dazu ein quadratisches Vorschaubild (480 px). Ablage in `UPLOAD_DIR`, ausgeliefert unter `/media/…`. Für den Echtbetrieb sollte die Ablage auf einen Objektspeicher (z. B. S3-kompatibel) wechseln.

**Einzelne Tiere** tragt ihr im Formular ein (Tab *Tiere* → *Tier eintragen*). Charakter und Anforderungen entstehen dort wahlweise

- aus dem **Verhaltensfragebogen** (empfohlen): 10 Fragen zu beobachtbarem Verhalten („Wie reagiert es auf fremde Menschen?“), die in die Skalen des Tierprofils umgerechnet werden – so sind Einstufungen verschiedener Anbieter vergleichbar. Die Antworten werden in `assessment.answers` gespeichert, die Umrechnung steht in [`src/questionnaire.js`](src/questionnaire.js) und wird auch im Browser genutzt (Live-Vorschau). Über die API: `GET /v1/questionnaire`, `POST /v1/questionnaire/score` oder `assessment: { method: "questionnaire", answers }` beim Anlegen; fehlende Werte werden ergänzt, Handeingaben haben Vorrang.
- oder **von Hand** über Schieberegler (1–5).

## Vermittlungsanfragen mit Vorprüfung

Damit Tierheime und Privatpersonen nicht mit unpassenden oder zu vielen Anfragen überlastet werden, läuft jede Anfrage durch mehrere Stufen ([`src/requests.js`](src/requests.js)):

1. **Voraussetzungen:** Anmeldung, Persönlichkeitstest (das Profil wird aus dem Browser übernommen), Nachricht mit 80–2000 Zeichen, zwei Bestätigungen (ernst gemeint, Kontakt erlaubt). Keine Anfragen für eigene Tiere.
2. **Grenzen je Person:** höchstens 3 offene Anfragen gleichzeitig, 5 pro Woche, eine pro Tier.
3. **Vorprüfung:** Ausschlussgründe (Allergie + Fell, Wohnsituation, Zeitbedarf, Kinder, andere Tiere) oder eine Passung unter 55 % führen zur automatischen Absage mit Begründung. Der Anbieter sieht diese Anfragen nie.
4. **Kapazität je Anbieter:** pro Tier höchstens *N* Anfragen gleichzeitig beim Anbieter (Standard 5, privat 3), pro Tag höchstens *M* neue (Standard 25, privat 10). Einstellbar im Postfach. Darüber hinaus kommt die Anfrage auf die **Warteliste**, sortiert nach Passung.
5. **Nachrücken:** Bei Absage, Rückzug, höheren Grenzen oder wenn eine Anfrage nach 14 Tagen ohne Antwort verfällt, rückt die beste Anfrage der Warteliste nach.
6. **Datensparsam:** Im Postfach sehen Anbieter Profil, Nachricht, Passung und Vornamen. E-Mail-Adressen werden erst nach *Kennenlernen vorschlagen* gegenseitig sichtbar. Wird ein Tier reserviert oder vermittelt, werden offene Anfragen geschlossen und die Personen benachrichtigt.

Alle Beteiligten werden per E-Mail informiert (neue Anfrage, nachgerückt, Zusage, Absage mit Begründung).

## Private Abgabe

Privatpersonen nutzen dasselbe Konto für Anfragen und zum Abgeben eines eigenen Tieres:

- Einmalig Postleitzahl und Ort angeben und bestätigen, dass das Tier ihnen gehört und nicht gewerblich vermittelt wird. Ein freiwilliger Standort wird auf ca. 1 km gerundet.
- Höchstens 3 Tiere gleichzeitig, Schutzgebühr höchstens 300 €, kein Excel-Import, kein API-Schlüssel, kein Team.
- Jede Anzeige und jede Änderung wird vor der Veröffentlichung geprüft (`/admin.html` oder `GET /v1/admin/animals?review=pending`, `POST /v1/admin/animals/{id}/review`). Ablehnungen brauchen eine Begründung, die per E-Mail an die Person geht.
- Öffentlich erscheint der Anbieter als „Privatabgabe“ mit PLZ und Ort; Name und E-Mail-Adresse bleiben verborgen. Die Tierseite auf Petify ersetzt den Link zur Tierheimseite.

## Eigene Daten statt Website-Daten

Petify speichert die Tierprofile selbst; die Website des Tierheims bleibt über den Pflicht-Link die Stelle, an der vermittelt wird. Das automatische Einsammeln von Tierheim-Websites (Scraping) ist bewusst nicht vorgesehen: Texte, Fotos und Datenbanken sind rechtlich geschützt, Websites liefern keine vergleichbaren Charakterwerte, und Vermittlungen würden spät oder gar nicht erkannt.

## Das einheitliche Tierprofil

Das vollständige Schema steht in [`src/schema/animal.schema.json`](src/schema/animal.schema.json) (JSON Schema 2020-12) und ist live unter `GET /v1/schema/animal` abrufbar. Kernidee: Charakter und Anforderungen werden nicht als Freitext, sondern als **vergleichbare Skalen** erfasst, damit Tiere verschiedener Tierheime fair gematcht werden können.

| Bereich | Felder |
|---|---|
| Stammdaten | `externalId` (eigene Karteinummer), `status`, `name`, `species`, `breed`, `sex`, `neutered`, `age` (Geburtsdatum oder geschätzt), `intakeDate`, `groupSize` |
| Charakter (1–5) | `activity`, `affection`, `anxiety`, `noiseTolerance`, `routineNeed`, `playfulness` |
| Anforderungen | `space` (apartment/balcony/garden), `experience` (beginner/some/experienced), `timeNeed` (1–5), `maxHoursAlone`, `outdoorAccess` |
| Verträglichkeit | `children` (yes/no/from_age + `childrenMinAge`), `dogs`, `cats`, `smallAnimals` |
| Weiteres | `hasFur`, `health`, `description`, `idealHome`, `photos`, `url` (Link zur Tierheimseite), `adoptionFee` |

Status: `available` (vermittelbar), `reserved`, `adopted`, `not_available`. Nur `available` erscheint in Suche und Matching.

## Für Tierheime: Tiere eintragen

Ein Tierheim bekommt einmalig einen API-Schlüssel (Verwaltung: `POST /v1/shelters` mit `X-Admin-Token`).

```bash
# Profil prüfen, ohne zu speichern
curl -X POST localhost:3200/v1/validate -H 'Content-Type: application/json' -d @tier.json

# Tier anlegen
curl -X POST localhost:3200/v1/animals -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d @tier.json

# Viele Tiere auf einmal anlegen oder aktualisieren (Abgleich über externalId)
curl -X POST localhost:3200/v1/animals/import -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"animals":[ … ]}'

# Vermittelt!
curl -X PATCH localhost:3200/v1/animals/$ID/status -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"status":"adopted"}'
```

Fehler kommen einheitlich als `{ "error": { "code", "message", "details": [...] } }`, Schemafehler mit Feldpfad, z. B. `character.activity: muss zwischen den erlaubten Grenzen liegen`.

## Endpunkte

| Methode | Pfad | Zugang | Zweck |
|---|---|---|---|
| GET | `/v1/animals` | öffentlich | Suche: `species`, `status`, `lat`+`lng`+`radiusKm` oder `postalCode` |
| GET | `/v1/animals/{id}` | öffentlich | ein Tier |
| POST | `/v1/match` | öffentlich | Persönlichkeitsprofil → passende Tiere mit Begründung, ausgeschlossene Tiere mit Grund |
| GET | `/v1/shelters`, `/v1/shelters/{id}` | öffentlich | Tierheime |
| GET | `/v1/schema/animal` | öffentlich | JSON-Schema |
| POST | `/v1/validate` | öffentlich | Profil prüfen |
| GET | `/v1/me`, `/v1/me/animals` | Tierheim | eigene Daten, alle eigenen Tiere |
| POST | `/v1/animals` | Tierheim | anlegen |
| PUT | `/v1/animals/{id}` | Tierheim | ersetzen |
| PATCH | `/v1/animals/{id}/status` | Tierheim | Status ändern |
| DELETE | `/v1/animals/{id}` | Tierheim | löschen |
| POST | `/v1/animals/import` | Tierheim | Sammelimport (max. 500) |
| POST | `/v1/shelters` | Verwaltung | Tierheim anlegen, gibt API-Schlüssel einmalig aus |
| POST | `/v1/shelters/{id}/rotate-key` | Verwaltung | neuen Schlüssel ausstellen |
| GET | `/v1/questionnaire` | öffentlich | Fragen des Verhaltensfragebogens |
| POST | `/v1/questionnaire/score` | öffentlich | Antworten → Skalen und Anforderungen |
| GET | `/v1/admin/shelters`, `/v1/admin/animals` | Verwaltung | offene Freischaltungen und Anzeigen |
| POST | `/v1/admin/shelters/{id}/status`, `/v1/admin/animals/{id}/review` | Verwaltung | freischalten, sperren, Anzeige freigeben/ablehnen |

Der Bereich für angemeldete Personen (`/portal/api/…`, Sitzungs-Cookie) ist für die eigenen Seiten gedacht, nicht als öffentliche API: Profil (`PUT /me/profile`), Anfragen (`POST /requests`, `GET /me/requests`, `POST /requests/{id}/withdraw`), private Abgabe (`POST /private`), Tiere (`POST|GET|PUT /shelters/{sid}/animals/…`), Postfach (`GET /shelters/{sid}/requests`, `POST …/requests/{rid}/decision`, `PATCH /shelters/{sid}/settings`).

## Umkreis

Mit Koordinaten (`lat`/`lng`, z. B. aus der Standortfreigabe im Browser) wird per Luftlinie gefiltert. Mit Postleitzahl werden Tierheime derselben **Leitregion** (gleiche erste zwei Ziffern) gezeigt – für echte Entfernungen braucht es später eine PLZ-Koordinaten-Tabelle oder einen Geocoder.

## Stand des Prototyps

- Beispiel-Tierheime und -Tiere in `db/examples.json` sind erfunden (`isExample: true`, Links auf `.example`).
- Noch offen für den Echtbetrieb: Rate-Limiting für die öffentliche API (der Login-Versand ist begrenzt, aber nur im Arbeitsspeicher), Objektspeicher für Fotos, Datenschutzerklärung und Auftragsverarbeitung (Mailversand, Hosting, Speicherdauer von Anfragen), PLZ-Geocoding, Benachrichtigung bei Statuswechsel (Webhooks), Verfallen von Anfragen per Zeitplan statt beim Seitenaufruf, Melde-Funktion für verdächtige Anzeigen.
