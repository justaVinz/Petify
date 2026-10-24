import express from 'express';
import Ajv2020 from 'ajv/dist/2020.js';
import { pool } from './db.js';
import { validateAnimal, animalSchema } from './validate.js';
import { matchAnimal, haversineKm } from './matching.js';
import { requireShelter, requireAdmin, newApiKey, hashKey, HttpError } from './auth.js';
import { openapi } from './openapi.js';
import { ANIMAL_SELECT, animalOut, readAnimal, createAnimal, replaceAnimal, setStatus, deleteAnimal, upsertAnimal } from './animals.js';
import { authRouter, loadUser } from './accounts.js';
import { portalRouter } from './portal.js';
import { uploadDir } from './media.js';

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
      FROM shelters s LEFT JOIN animals a ON a.shelter_id = s.id WHERE s.status = 'active' GROUP BY s.id ORDER BY s.name`);
    res.json({ shelters: rows.map((s) => ({ ...shelterPublic(s), availableAnimals: s.available })) });
  }));

  v1.get('/shelters/:id', asyncRoute(async (req, res) => {
    const { rows: [s] } = isUuid(req.params.id) ? await pool.query("SELECT * FROM shelters WHERE id = $1 AND status = 'active'", [req.params.id]) : { rows: [] };
    if (!s) throw new HttpError(404, 'not_found', 'Tierheim nicht gefunden.');
    res.json(shelterPublic(s));
  }));

  v1.get('/animals', asyncRoute(async (req, res) => {
    const status = req.query.status ?? 'available';
    if (!animalSchema.properties.status.enum.includes(status)) throw new HttpError(400, 'invalid_status', 'Unbekannter Status.');
    const params = [status];
    let where = "a.status = $1 AND s.status = 'active'";
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
    if (!row || row.shelter_status !== 'active') throw new HttpError(404, 'not_found', 'Tier nicht gefunden.');
    res.json(animalOut(row));
  }));

  // Persönlichkeitsprofil → passende, vermittelbare Tiere in der Umgebung
  v1.post('/match', asyncRoute(async (req, res) => {
    const body = structuredClone(req.body ?? {});
    if (!checkMatch(body)) throw new HttpError(400, 'invalid_profile', 'Profil unvollständig oder ungültig.', checkMatch.errors.map((e) => `${e.instancePath || '(body)'} ${e.message}`));
    const params = ['available'];
    let where = "a.status = $1 AND s.status = 'active'";
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
    const row = await createAnimal(req.shelter.id, req.body);
    res.status(201).location(`/v1/animals/${row.id}`).json(animalOut(row));
  }));

  v1.put('/animals/:id', requireShelter, asyncRoute(async (req, res) => {
    res.json(animalOut(await replaceAnimal(req.shelter.id, req.params.id, req.body)));
  }));

  v1.patch('/animals/:id/status', requireShelter, asyncRoute(async (req, res) => {
    res.json(animalOut(await setStatus(req.shelter.id, req.params.id, req.body?.status)));
  }));

  v1.delete('/animals/:id', requireShelter, asyncRoute(async (req, res) => {
    await deleteAnimal(req.shelter.id, req.params.id);
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
      const row = await upsertAnimal(req.shelter.id, d);
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

  v1.get('/admin/shelters', requireAdmin, asyncRoute(async (req, res) => {
    const status = ['pending', 'active', 'suspended'].includes(req.query.status) ? req.query.status : 'pending';
    const { rows } = await pool.query(`SELECT s.*, (SELECT array_agg(email) FROM shelter_members m WHERE m.shelter_id = s.id) AS members
      FROM shelters s WHERE s.status = $1 ORDER BY s.created_at`, [status]);
    res.json({ shelters: rows.map((s) => ({ ...shelterPublic(s), status: s.status, members: s.members ?? [], createdAt: s.created_at })) });
  }));

  v1.post('/admin/shelters/:id/status', requireAdmin, asyncRoute(async (req, res) => {
    const status = req.body?.status;
    if (!['pending', 'active', 'suspended'].includes(status)) throw new HttpError(422, 'invalid_status', 'status: pending, active oder suspended');
    const { rows: [s] } = isUuid(req.params.id) ? await pool.query('UPDATE shelters SET status = $2 WHERE id = $1 RETURNING *', [req.params.id, status]) : { rows: [] };
    if (!s) throw new HttpError(404, 'not_found', 'Tierheim nicht gefunden.');
    res.json({ ...shelterPublic(s), status: s.status });
  }));

  v1.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Unbekannter Endpunkt.')));
  app.use('/v1', v1);

  // Login und Verwaltungsbereich (Sitzungs-Cookie, nur gleiche Herkunft)
  app.use('/auth', loadUser, authRouter());
  app.use('/portal/api', loadUser, portalRouter());
  app.use('/media', express.static(uploadDir, { maxAge: '30d', immutable: true, index: false, fallthrough: false }));

  app.get('/openapi.json', (_req, res) => res.json(openapi));
  if (staticDir) {
    app.use(express.static(staticDir));
  }

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'invalid_json', 'Der Body ist kein gültiges JSON.');
    if (err.code === 'LIMIT_FILE_SIZE') err = new HttpError(413, 'file_too_large', 'Eine Datei ist zu groß (höchstens 12 MB).');
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') err = new HttpError(413, 'too_many_files', 'Zu viele Dateien auf einmal (höchstens 60 Fotos).');
    if (err.status === 404 && err.expose && !(err instanceof HttpError)) err = new HttpError(404, 'not_found', 'Nicht gefunden.');
    if (!(err instanceof HttpError)) { console.error(err); err = new HttpError(500, 'internal', 'Interner Serverfehler.'); }
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
  });
  return app;
}

