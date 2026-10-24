import express from 'express';
import Ajv2020 from 'ajv/dist/2020.js';
import { pool } from './db.js';
import { validateAnimal, animalSchema } from './validate.js';
import { matchAnimal, haversineKm } from './matching.js';
import { requireShelter, requireAdmin, newApiKey, hashKey, HttpError } from './auth.js';
import { openapi } from './openapi.js';

const asyncRoute = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

const ajv = new Ajv2020({ allErrors: true, useDefaults: true });
const unit = { type: 'number', minimum: 0, maximum: 1 };
const checkMatch = ajv.compile({
  type: 'object', additionalProperties: false, required: ['profile'],
  properties: {
    location: {
      type: 'object', additionalProperties: false,
      properties: {
        lat: { type: 'number', minimum: -90, maximum: 90 }, lng: { type: 'number', minimum: -180, maximum: 180 },
        postalCode: { type: 'string', pattern: '^\\d{5}$' }, radiusKm: { type: 'number', minimum: 1, maximum: 500, default: 25 },
      },
    },
    profile: {
      type: 'object', additionalProperties: false,
      required: ['activity', 'affection', 'patience', 'busyHome', 'routine', 'curiosity', 'space', 'timeAtHome', 'experience', 'children', 'allergy'],
      properties: {
        activity: unit, affection: unit, patience: unit, busyHome: unit, routine: unit, curiosity: unit,
        space: { enum: ['apartment', 'balcony', 'garden'] },
        timeAtHome: { enum: ['low', 'medium', 'high'] },
        experience: { enum: ['beginner', 'some', 'experienced'] },
        children: { type: 'boolean' },
        otherPets: { type: 'array', items: { enum: ['dog', 'cat', 'smallAnimal'] }, uniqueItems: true },
        allergy: { type: 'boolean' },
      },
    },
    species: { type: 'array', items: { enum: animalSchema.properties.species.enum } },
    limit: { type: 'integer', minimum: 1, maximum: 50, default: 3 },
  },
});

const shelterPublic = (s) => ({
  id: s.id, name: s.name, street: s.street, postalCode: s.postal_code, city: s.city,
  location: s.lat !== null && s.lng !== null ? { lat: s.lat, lng: s.lng } : null,
  website: s.website, email: s.email, phone: s.phone, isExample: s.is_example,
});

const animalOut = (row, extra = {}) => ({
  id: row.id,
  ...row.data,
  shelter: { id: row.shelter_id, name: row.shelter_name, city: row.city, postalCode: row.postal_code, website: row.website, isExample: row.is_example },
  createdAt: row.created_at, updatedAt: row.updated_at,
  ...extra,
});

const ANIMAL_SELECT = `SELECT a.*, s.name AS shelter_name, s.city, s.postal_code, s.website, s.lat, s.lng, s.is_example
  FROM animals a JOIN shelters s ON s.id = a.shelter_id`;

// Umkreis: mit Koordinaten per Luftlinie, sonst über die ersten zwei Ziffern der Postleitzahl (Leitregion)
function locate(rows, loc) {
  if (!loc) return rows.map((r) => ({ row: r, distanceKm: null }));
  if (loc.lat !== undefined && loc.lng !== undefined) {
    return rows
      .filter((r) => r.lat !== null && r.lng !== null)
      .map((r) => ({ row: r, distanceKm: Math.round(haversineKm(loc, { lat: r.lat, lng: r.lng }) * 10) / 10 }))
      .filter((x) => x.distanceKm <= (loc.radiusKm ?? 25))
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }
  if (loc.postalCode) return rows.filter((r) => r.postal_code.slice(0, 2) === loc.postalCode.slice(0, 2)).map((r) => ({ row: r, distanceKm: null }));
  return rows.map((r) => ({ row: r, distanceKm: null }));
}

function parseLocation(q) {
  const loc = {};
  if (q.lat !== undefined || q.lng !== undefined) {
    loc.lat = Number(q.lat); loc.lng = Number(q.lng);
    if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) throw new HttpError(400, 'invalid_location', 'lat und lng müssen Zahlen sein.');
  }
  if (q.postalCode !== undefined) {
    if (!/^\d{5}$/.test(q.postalCode)) throw new HttpError(400, 'invalid_location', 'postalCode muss fünfstellig sein.');
    loc.postalCode = q.postalCode;
  }
  if (q.radiusKm !== undefined) loc.radiusKm = Math.min(500, Math.max(1, Number(q.radiusKm) || 25));
  return Object.keys(loc).length ? loc : null;
}

async function ownAnimal(req) {
  if (!isUuid(req.params.id)) throw new HttpError(404, 'not_found', 'Tier nicht gefunden.');
  const { rows: [row] } = await pool.query('SELECT * FROM animals WHERE id = $1', [req.params.id]);
  if (!row) throw new HttpError(404, 'not_found', 'Tier nicht gefunden.');
  if (row.shelter_id !== req.shelter.id) throw new HttpError(403, 'forbidden', 'Dieses Tier gehört zu einem anderen Tierheim.');
  return row;
}

function requireValid(body) {
  const result = validateAnimal(body);
  if (!result.ok) throw new HttpError(422, 'invalid_animal', 'Das Tierprofil entspricht nicht dem Schema.', result.errors);
  return result.value;
}

async function readAnimal(id) {
  const { rows: [row] } = await pool.query(`${ANIMAL_SELECT} WHERE a.id = $1`, [id]);
  return row;
}

export function createApp({ staticDir } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  // Offene API: Tierheim-Websites dürfen sie direkt aus dem Browser abfragen
  app.use('/v1', (req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Admin-Token');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  const v1 = express.Router();

  v1.get('/health', asyncRoute(async (_req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); }));
  v1.get('/schema/animal', (_req, res) => res.json(animalSchema));

  // Prüft ein Tierprofil, ohne es zu speichern – hilfreich beim Anbinden eigener Software
  v1.post('/validate', (req, res) => {
    const result = validateAnimal(req.body);
    res.status(result.ok ? 200 : 422).json(result.ok ? { valid: true } : { valid: false, errors: result.errors });
  });

  // --- öffentlich ---
  v1.get('/shelters', asyncRoute(async (_req, res) => {
    const { rows } = await pool.query(`SELECT s.*, count(a.id) FILTER (WHERE a.status = 'available')::int AS available
      FROM shelters s LEFT JOIN animals a ON a.shelter_id = s.id GROUP BY s.id ORDER BY s.name`);
    res.json({ shelters: rows.map((s) => ({ ...shelterPublic(s), availableAnimals: s.available })) });
  }));

  v1.get('/shelters/:id', asyncRoute(async (req, res) => {
    const { rows: [s] } = isUuid(req.params.id) ? await pool.query('SELECT * FROM shelters WHERE id = $1', [req.params.id]) : { rows: [] };
    if (!s) throw new HttpError(404, 'not_found', 'Tierheim nicht gefunden.');
    res.json(shelterPublic(s));
  }));

  v1.get('/animals', asyncRoute(async (req, res) => {
    const status = req.query.status ?? 'available';
    if (!animalSchema.properties.status.enum.includes(status)) throw new HttpError(400, 'invalid_status', 'Unbekannter Status.');
    const params = [status];
    let where = 'a.status = $1';
    if (req.query.species) {
      params.push(String(req.query.species).split(','));
      where += ` AND a.species = ANY($${params.length})`;
    }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const { rows } = await pool.query(`${ANIMAL_SELECT} WHERE ${where} ORDER BY a.updated_at DESC`, params);
    const located = locate(rows, parseLocation(req.query));
    res.json({ total: located.length, limit, offset, animals: located.slice(offset, offset + limit).map(({ row, distanceKm }) => animalOut(row, { distanceKm })) });
  }));

  v1.get('/animals/:id', asyncRoute(async (req, res) => {
    const row = isUuid(req.params.id) ? await readAnimal(req.params.id) : null;
    if (!row) throw new HttpError(404, 'not_found', 'Tier nicht gefunden.');
    res.json(animalOut(row));
  }));

  // Persönlichkeitsprofil → passende, vermittelbare Tiere in der Umgebung
  v1.post('/match', asyncRoute(async (req, res) => {
    const body = structuredClone(req.body ?? {});
    if (!checkMatch(body)) throw new HttpError(400, 'invalid_profile', 'Profil unvollständig oder ungültig.', checkMatch.errors.map((e) => `${e.instancePath || '(body)'} ${e.message}`));
    const params = ['available'];
    let where = 'a.status = $1';
    if (body.species?.length) { params.push(body.species); where += ' AND a.species = ANY($2)'; }
    const { rows } = await pool.query(`${ANIMAL_SELECT} WHERE ${where}`, params);
    const located = locate(rows, body.location);
    const results = located.map(({ row, distanceKm }) => ({ row, distanceKm, m: matchAnimal(body.profile, row.data) }));
    const fitting = results.filter((r) => !r.m.excluded).sort((a, b) => b.m.score - a.m.score);
    res.json({
      considered: results.length,
      fitting: fitting.length,
      matches: fitting.slice(0, body.limit).map(({ row, distanceKm, m }) => ({ score: m.score, reasons: m.reasons, caveats: m.caveats, animal: animalOut(row, { distanceKm }) })),
      excluded: results.filter((r) => r.m.excluded).map(({ row, m }) => ({ id: row.id, name: row.name, species: row.species, reasons: m.excluded })),
    });
  }));

  // --- Tierheime (API-Schlüssel) ---
  v1.get('/me', requireShelter, (req, res) => res.json(shelterPublic(req.shelter)));

  v1.get('/me/animals', requireShelter, asyncRoute(async (req, res) => {
    const { rows } = await pool.query(`${ANIMAL_SELECT} WHERE a.shelter_id = $1 ORDER BY a.updated_at DESC`, [req.shelter.id]);
    res.json({ animals: rows.map((r) => animalOut(r)) });
  }));

  v1.post('/animals', requireShelter, asyncRoute(async (req, res) => {
    const doc = requireValid(req.body);
    try {
      const { rows: [row] } = await pool.query(
        'INSERT INTO animals (shelter_id, external_id, status, species, name, data) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [req.shelter.id, doc.externalId, doc.status, doc.species, doc.name, doc]);
      res.status(201).location(`/v1/animals/${row.id}`).json(animalOut(await readAnimal(row.id)));
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'duplicate_external_id', `externalId „${doc.externalId}“ existiert bereits. Zum Ändern PUT /v1/animals/{id} oder den Import nutzen.`);
      throw err;
    }
  }));

  v1.put('/animals/:id', requireShelter, asyncRoute(async (req, res) => {
    await ownAnimal(req);
    const doc = requireValid(req.body);
    try {
      await pool.query('UPDATE animals SET external_id=$2, status=$3, species=$4, name=$5, data=$6, updated_at=now() WHERE id=$1',
        [req.params.id, doc.externalId, doc.status, doc.species, doc.name, doc]);
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'duplicate_external_id', `externalId „${doc.externalId}“ gehört schon zu einem anderen Tier.`);
      throw err;
    }
    res.json(animalOut(await readAnimal(req.params.id)));
  }));

  v1.patch('/animals/:id/status', requireShelter, asyncRoute(async (req, res) => {
    const row = await ownAnimal(req);
    const status = req.body?.status;
    if (!animalSchema.properties.status.enum.includes(status)) throw new HttpError(422, 'invalid_status', `status muss einer von ${animalSchema.properties.status.enum.join(', ')} sein.`);
    await pool.query('UPDATE animals SET status=$2, data = jsonb_set(data, \'{status}\', to_jsonb($2::text)), updated_at=now() WHERE id=$1', [row.id, status]);
    res.json(animalOut(await readAnimal(row.id)));
  }));

  v1.delete('/animals/:id', requireShelter, asyncRoute(async (req, res) => {
    const row = await ownAnimal(req);
    await pool.query('DELETE FROM animals WHERE id = $1', [row.id]);
    res.status(204).end();
  }));

  // Sammelimport: legt neue Tiere an oder aktualisiert bestehende anhand der externalId
  v1.post('/animals/import', requireShelter, asyncRoute(async (req, res) => {
    const list = req.body?.animals;
    if (!Array.isArray(list) || !list.length || list.length > 500) throw new HttpError(400, 'invalid_import', 'Erwarte { "animals": [ … ] } mit 1 bis 500 Tierprofilen.');
    const results = [];
    for (const [index, item] of list.entries()) {
      const v = validateAnimal(item);
      if (!v.ok) { results.push({ index, externalId: item?.externalId ?? null, result: 'invalid', errors: v.errors }); continue; }
      const d = v.value;
      const { rows: [row] } = await pool.query(`INSERT INTO animals (shelter_id, external_id, status, species, name, data) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (shelter_id, external_id) DO UPDATE SET status=EXCLUDED.status, species=EXCLUDED.species, name=EXCLUDED.name, data=EXCLUDED.data, updated_at=now()
        RETURNING id, (xmax = 0) AS inserted`, [req.shelter.id, d.externalId, d.status, d.species, d.name, d]);
      results.push({ index, externalId: d.externalId, id: row.id, result: row.inserted ? 'created' : 'updated' });
    }
    const count = (k) => results.filter((r) => r.result === k).length;
    res.status(count('invalid') === results.length ? 422 : 200).json({ created: count('created'), updated: count('updated'), invalid: count('invalid'), results });
  }));

  // --- Verwaltung ---
  v1.post('/shelters', requireAdmin, asyncRoute(async (req, res) => {
    const b = req.body ?? {};
    const errors = [];
    if (typeof b.name !== 'string' || b.name.trim().length < 3) errors.push('name: mindestens 3 Zeichen');
    if (!/^\d{5}$/.test(b.postalCode ?? '')) errors.push('postalCode: fünfstellige Postleitzahl');
    if (typeof b.city !== 'string' || !b.city.trim()) errors.push('city: Pflichtfeld');
    if (b.location && !(Number.isFinite(b.location.lat) && Number.isFinite(b.location.lng))) errors.push('location: lat und lng als Zahlen');
    if (b.website && !/^https?:\/\//.test(b.website)) errors.push('website: muss mit http(s):// beginnen');
    if (errors.length) throw new HttpError(422, 'invalid_shelter', 'Tierheimdaten unvollständig.', errors);
    const apiKey = newApiKey();
    const { rows: [s] } = await pool.query(`INSERT INTO shelters (name, street, postal_code, city, lat, lng, website, email, phone, is_example, api_key_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [b.name.trim(), b.street ?? null, b.postalCode, b.city.trim(), b.location?.lat ?? null, b.location?.lng ?? null, b.website ?? null, b.email ?? null, b.phone ?? null, Boolean(b.isExample), hashKey(apiKey)]);
    // Der Schlüssel wird nur dieses eine Mal im Klartext ausgegeben
    res.status(201).json({ shelter: shelterPublic(s), apiKey });
  }));

  v1.post('/shelters/:id/rotate-key', requireAdmin, asyncRoute(async (req, res) => {
    const apiKey = newApiKey();
    const { rowCount } = isUuid(req.params.id) ? await pool.query('UPDATE shelters SET api_key_hash = $2 WHERE id = $1', [req.params.id, hashKey(apiKey)]) : { rowCount: 0 };
    if (!rowCount) throw new HttpError(404, 'not_found', 'Tierheim nicht gefunden.');
    res.json({ apiKey });
  }));

  v1.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Unbekannter Endpunkt.')));
  app.use('/v1', v1);

  app.get('/openapi.json', (_req, res) => res.json(openapi));
  if (staticDir) {
    app.use(express.static(staticDir));
  }

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'invalid_json', 'Der Body ist kein gültiges JSON.');
    if (!(err instanceof HttpError)) { console.error(err); err = new HttpError(500, 'internal', 'Interner Serverfehler.'); }
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
  });
  return app;
}

