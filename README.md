# Pfotenmatch

Persönlichkeitstest, der passende Tiere aus Tierheimen in der Umgebung vorschlägt – und eine **einheitliche API**, über die Tierheime ihre vermittelbaren Tiere erfassen.

- **Quiz** (`/`): 13 Fragen zu Persönlichkeit und Lebensumständen → Tier-Typ und die passendsten Tiere mit Charakterbogen und Link zur Tierheimseite
- **API** (`/v1/…`): Tierheime legen Tiere im einheitlichen Format an; öffentliche Suche und Matching
- **Doku** (`/docs.html`): interaktive OpenAPI-Dokumentation, Spezifikation unter `/openapi.json`

Stack: Node.js 22, Express, PostgreSQL, JSON-Schema-Prüfung mit Ajv.

## Schnellstart

```bash
docker run -d --name pfotenmatch-db -e POSTGRES_USER=virony -e POSTGRES_PASSWORD=virony -e POSTGRES_DB=pfotenmatch -p 5432:5432 postgres:16-alpine
npm install
cp .env.example .env          # ADMIN_TOKEN unbedingt ändern
npm run db:setup              # Schema + Beispiel-Tierheime; gibt deren API-Schlüssel einmalig aus
npm start                     # → http://localhost:3200
npm test
```

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

## Umkreis

Mit Koordinaten (`lat`/`lng`, z. B. aus der Standortfreigabe im Browser) wird per Luftlinie gefiltert. Mit Postleitzahl werden Tierheime derselben **Leitregion** (gleiche erste zwei Ziffern) gezeigt – für echte Entfernungen braucht es später eine PLZ-Koordinaten-Tabelle oder einen Geocoder.

## Stand des Prototyps

- Beispiel-Tierheime und -Tiere in `db/examples.json` sind erfunden (`isExample: true`, Links auf `.example`).
- Noch offen für den Echtbetrieb: Rate-Limiting, Foto-Upload, Verwaltungsoberfläche für Tierheime, Datenschutzprüfung, PLZ-Geocoding, Benachrichtigung bei Statuswechsel (Webhooks).
