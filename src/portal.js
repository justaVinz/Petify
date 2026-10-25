// Bereich für angemeldete Personen: Tierheime (Registrierung, Team, Excel-Import, Fotos), Privatabgaben,
// eigenes Profil und Vermittlungsanfragen.
import express from 'express';
import multer from 'multer';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { pool } from './db.js';
import { HttpError, newApiKey, hashKey } from './auth.js';
import { requireUser, normalizeEmail, isEmail } from './accounts.js';
import { ANIMAL_SELECT, animalOut, setStatus, deleteAnimal, ownAnimal, upsertAnimal, createAnimal, replaceAnimal, readAnimal, PRIVATE_LISTING_LIMIT } from './animals.js';
import { validateProfile } from './profile.js';
import { createRequest, withdraw, decide, expireStale, waitlistPosition, promote, RULES } from './requests.js';
import { storePhoto, deletePhotoFiles, uploadDir, MAX_PHOTO_BYTES } from './media.js';
import { buildTemplate, parseWorkbook } from './excel.js';

const asyncRoute = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES, files: 61 } });
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s ?? '');
const stagingDir = (importId) => resolve(uploadDir, 'staging', importId);
const fileKey = (name) => basename(String(name)).trim().toLowerCase();

const shelterOut = (s, role) => ({
  id: s.id, name: s.name, street: s.street, postalCode: s.postal_code, city: s.city, website: s.website, email: s.email, phone: s.phone,
  location: s.lat !== null && s.lng !== null ? { lat: s.lat, lng: s.lng } : null, status: s.status, hasApiKey: Boolean(s.api_key_hash), role,
  kind: s.kind, limits: { perAnimal: s.per_animal_limit, daily: s.daily_request_limit },
});

const requestOut = (q) => ({
  id: q.id, status: q.status, message: q.message, score: q.score, screening: q.screening, note: q.note,
  createdAt: q.created_at, sentAt: q.sent_at, decidedAt: q.decided_at,
  animal: { id: q.animal_id, name: q.animal_name, species: q.species },
});

// Excel-Import und API-Schlüssel sind Tierheimen vorbehalten
const shelterOnly = (req, _res, next) => next(req.shelter.kind === 'shelter' ? undefined : new HttpError(403, 'shelters_only', 'Nur für Tierheime.'));

// Nur Mitglieder des Tierheims; optional nur Admins
const member = (adminOnly = false) => asyncRoute(async (req, _res, next) => {
  if (!isUuid(req.params.sid)) throw new HttpError(404, 'not_found', 'Tierheim nicht gefunden.');
  const { rows: [row] } = await pool.query(`SELECT s.*, m.role FROM shelter_members m JOIN shelters s ON s.id = m.shelter_id
    WHERE m.shelter_id = $1 AND m.email = $2`, [req.params.sid, req.user.email]);
  if (!row) throw new HttpError(403, 'forbidden', 'Du gehörst nicht zu diesem Tierheim.');
  if (adminOnly && row.role !== 'admin') throw new HttpError(403, 'forbidden', 'Nur für Admins des Tierheims.');
  req.shelter = row;
  next();
});

export function portalRouter() {
  const r = express.Router();
  r.use(requireUser);

  r.get('/me', asyncRoute(async (req, res) => {
    await expireStale();
    const { rows } = await pool.query(`SELECT s.*, m.role,
        (SELECT count(*)::int FROM adoption_requests q WHERE q.shelter_id = s.id AND q.status = 'sent') AS inbox
      FROM shelter_members m JOIN shelters s ON s.id = m.shelter_id WHERE m.email = $1 ORDER BY s.name`, [req.user.email]);
    const { rows: [p] } = await pool.query('SELECT profile FROM user_profiles WHERE user_id = $1', [req.user.id]);
    const { rows: [c] } = await pool.query(`SELECT count(*) FILTER (WHERE status IN ('waitlist','sent','accepted'))::int AS open,
      count(*)::int AS total FROM adoption_requests WHERE user_id = $1`, [req.user.id]);
    const out = (s) => ({ ...shelterOut(s, s.role), inbox: s.inbox });
    const priv = rows.find((s) => s.kind === 'private');
    res.json({
      user: { id: req.user.id, email: req.user.email, name: req.user.name },
      shelters: rows.filter((s) => s.kind === 'shelter').map(out),
      private: priv ? out(priv) : null,
      profile: p?.profile ?? null,
      requests: c,
      rules: { ...RULES, privateListingLimit: PRIVATE_LISTING_LIMIT },
    });
  }));

  r.patch('/me', asyncRoute(async (req, res) => {
    const name = String(req.body?.name ?? '').trim().slice(0, 80) || null;
    await pool.query('UPDATE users SET name = $2 WHERE id = $1', [req.user.id, name]);
    res.json({ name });
  }));

  // Ergebnis des Persönlichkeitstests speichern – Voraussetzung für Anfragen
  r.put('/me/profile', asyncRoute(async (req, res) => {
    const v = validateProfile(req.body);
    if (!v.ok) throw new HttpError(422, 'invalid_profile', 'Das Profil ist unvollständig.', v.errors);
    await pool.query(`INSERT INTO user_profiles (user_id, profile) VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = now()`, [req.user.id, v.value]);
    res.json({ profile: v.value });
  }));

  // --- Eigene Anfragen ---
  r.get('/me/requests', asyncRoute(async (req, res) => {
    await expireStale();
    const { rows } = await pool.query(`SELECT q.*, a.name AS animal_name, a.species, s.kind, s.name AS shelter_name, s.email AS shelter_email, s.phone AS shelter_phone
      FROM adoption_requests q JOIN animals a ON a.id = q.animal_id JOIN shelters s ON s.id = q.shelter_id
      WHERE q.user_id = $1 ORDER BY q.created_at DESC`, [req.user.id]);
    const out = [];
    for (const q of rows) {
      out.push({
        ...requestOut(q),
        provider: { kind: q.kind, name: q.kind === 'private' ? 'Privatabgabe' : q.shelter_name },
        // Kontaktdaten erst nach Zusage
        contact: q.status === 'accepted' ? { email: q.shelter_email, phone: q.shelter_phone } : null,
        position: q.status === 'waitlist' ? await waitlistPosition(q) : null,
      });
    }
    res.json({ requests: out });
  }));

  r.post('/requests', asyncRoute(async (req, res) => {
    if (!isUuid(req.body?.animalId)) throw new HttpError(404, 'not_found', 'Tier nicht gefunden.');
    const q = await createRequest(req.user, req.body.animalId, req.body);
    res.status(201).json({ id: q.id, status: q.status, score: q.score, note: q.note, position: q.position, screening: q.screening });
  }));

  r.post('/requests/:id/withdraw', asyncRoute(async (req, res) => {
    if (!isUuid(req.params.id)) throw new HttpError(404, 'not_found', 'Anfrage nicht gefunden.');
    const q = await withdraw(req.user.id, req.params.id);
    res.json({ id: q.id, status: q.status });
  }));

  // --- Privatabgabe: jede Person bekommt einen eigenen Anbieter-Eintrag ---
  r.post('/private', asyncRoute(async (req, res) => {
    const b = req.body ?? {};
    const errors = [];
    if (!/^\d{5}$/.test(b.postalCode ?? '')) errors.push('Postleitzahl: fünfstellig');
    if (typeof b.city !== 'string' || !b.city.trim()) errors.push('Ort: Pflichtfeld');
    if (b.location && !(Number.isFinite(b.location.lat) && Number.isFinite(b.location.lng))) errors.push('Standort: ungültig');
    if (!b.confirmations?.owner) errors.push('Bestätigung: Das Tier gehört dir bzw. du darfst es abgeben');
    if (!b.confirmations?.nonCommercial) errors.push('Bestätigung: keine gewerbliche Vermittlung oder Zucht');
    if (errors.length) throw new HttpError(422, 'invalid_private', 'Bitte prüfe deine Angaben.', errors);
    const { rows: [existing] } = await pool.query(`SELECT s.id FROM shelter_members m JOIN shelters s ON s.id = m.shelter_id
      WHERE m.email = $1 AND s.kind = 'private'`, [req.user.email]);
    if (existing) throw new HttpError(409, 'exists', 'Du hast bereits einen Bereich für private Abgaben.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Für die Öffentlichkeit gerundeter Standort (ca. 1 km), damit keine Wohnadresse ablesbar ist
      const round = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
      const { rows: [s] } = await client.query(`INSERT INTO shelters (name, postal_code, city, lat, lng, email, kind, status, per_animal_limit, daily_request_limit)
        VALUES ($1,$2,$3,$4,$5,$6,'private','active',3,10) RETURNING *`,
      [req.user.name || 'Privatperson', b.postalCode, b.city.trim(), round(b.location?.lat), round(b.location?.lng), req.user.email]);
      await client.query("INSERT INTO shelter_members (shelter_id, email, role) VALUES ($1, $2, 'admin')", [s.id, req.user.email]);
      await client.query('COMMIT');
      res.status(201).json(shelterOut(s, 'admin'));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }));

  // Neues Tierheim registrieren: wird erst nach Prüfung öffentlich sichtbar
  r.post('/shelters', asyncRoute(async (req, res) => {
    const b = req.body ?? {};
    const errors = [];
    if (typeof b.name !== 'string' || b.name.trim().length < 3) errors.push('Name: mindestens 3 Zeichen');
    if (!/^\d{5}$/.test(b.postalCode ?? '')) errors.push('Postleitzahl: fünfstellig');
    if (typeof b.city !== 'string' || !b.city.trim()) errors.push('Ort: Pflichtfeld');
    if (!/^https?:\/\/\S+\.\S+/.test(b.website ?? '')) errors.push('Website: bitte die Adresse eurer Website (https://…)');
    if (b.location && !(Number.isFinite(b.location.lat) && Number.isFinite(b.location.lng))) errors.push('Standort: ungültig');
    if (errors.length) throw new HttpError(422, 'invalid_shelter', 'Bitte prüft eure Angaben.', errors);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [s] } = await client.query(`INSERT INTO shelters (name, street, postal_code, city, lat, lng, website, email, phone, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending') RETURNING *`,
      [b.name.trim(), b.street?.trim() || null, b.postalCode, b.city.trim(), b.location?.lat ?? null, b.location?.lng ?? null, b.website.trim(), b.email?.trim() || req.user.email, b.phone?.trim() || null]);
      await client.query("INSERT INTO shelter_members (shelter_id, email, role) VALUES ($1, $2, 'admin')", [s.id, req.user.email]);
      await client.query('COMMIT');
      res.status(201).json(shelterOut(s, 'admin'));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }));

  // --- Tiere ---
  r.get('/shelters/:sid/animals', member(), asyncRoute(async (req, res) => {
    const { rows } = await pool.query(`${ANIMAL_SELECT} WHERE a.shelter_id = $1 ORDER BY a.updated_at DESC`, [req.shelter.id]);
    res.json({ animals: rows.map((row) => animalOut(row)) });
  }));

  // Manueller Eintrag oder Fragebogen (assessment.method = 'questionnaire')
  r.post('/shelters/:sid/animals', member(), asyncRoute(async (req, res) => {
    res.status(201).json(animalOut(await createAnimal(req.shelter, req.body)));
  }));

  r.get('/shelters/:sid/animals/:id', member(), asyncRoute(async (req, res) => {
    await ownAnimal(req.shelter.id, req.params.id);
    res.json(animalOut(await readAnimal(req.params.id)));
  }));

  r.put('/shelters/:sid/animals/:id', member(), asyncRoute(async (req, res) => {
    res.json(animalOut(await replaceAnimal(req.shelter, req.params.id, req.body)));
  }));

  r.patch('/shelters/:sid/animals/:id/status', member(), asyncRoute(async (req, res) => {
    res.json(animalOut(await setStatus(req.shelter.id, req.params.id, req.body?.status)));
  }));

  r.delete('/shelters/:sid/animals/:id', member(), asyncRoute(async (req, res) => {
    await deleteAnimal(req.shelter.id, req.params.id);
    res.status(204).end();
  }));

  r.post('/shelters/:sid/animals/:id/photos', member(), upload.array('photos', 12), asyncRoute(async (req, res) => {
    const animal = await ownAnimal(req.shelter.id, req.params.id);
    if (!req.files?.length) throw new HttpError(422, 'no_photos', 'Bitte mindestens ein Foto auswählen.');
    const stored = [];
    for (const f of req.files) stored.push(await storePhoto({ buffer: f.buffer, animalId: animal.id, shelterId: req.shelter.id, alt: animal.name, sourceName: fileKey(f.originalname) }));
    res.status(201).json({ photos: stored });
  }));

  r.delete('/shelters/:sid/photos/:pid', member(), asyncRoute(async (req, res) => {
    const { rowCount } = isUuid(req.params.pid) ? await pool.query('DELETE FROM photos WHERE id = $1 AND shelter_id = $2', [req.params.pid, req.shelter.id]) : { rowCount: 0 };
    if (!rowCount) throw new HttpError(404, 'not_found', 'Foto nicht gefunden.');
    await deletePhotoFiles([req.params.pid]);
    res.status(204).end();
  }));

  // --- Postfach: vorgeprüfte Anfragen ---
  r.get('/shelters/:sid/requests', member(), asyncRoute(async (req, res) => {
    await expireStale();
    const status = ['sent', 'accepted', 'declined', 'waitlist'].includes(req.query.status) ? req.query.status : 'sent';
    const { rows } = await pool.query(`SELECT q.*, a.name AS animal_name, a.species, u.email, u.name AS user_name
      FROM adoption_requests q JOIN animals a ON a.id = q.animal_id JOIN users u ON u.id = q.user_id
      WHERE q.shelter_id = $1 AND q.status = $2 ORDER BY q.score DESC, q.created_at`, [req.shelter.id, status]);
    const { rows: counts } = await pool.query(`SELECT status, count(*)::int AS n FROM adoption_requests
      WHERE shelter_id = $1 AND status IN ('sent','accepted','declined','waitlist') GROUP BY status`, [req.shelter.id]);
    res.json({
      counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
      requests: rows.map((q) => ({
        ...requestOut(q),
        // Wartelisten-Anfragen: nur Anzahl und Passung, keine Inhalte – sie sind noch nicht beim Anbieter
        message: q.status === 'waitlist' ? null : q.message,
        profile: q.status === 'waitlist' ? null : q.profile,
        applicant: q.status === 'accepted' ? { email: q.email, name: q.user_name } : { name: q.user_name ? q.user_name.split(' ')[0] : null },
      })),
    });
  }));

  r.post('/shelters/:sid/requests/:rid/decision', member(), asyncRoute(async (req, res) => {
    if (!isUuid(req.params.rid)) throw new HttpError(404, 'not_found', 'Anfrage nicht gefunden.');
    const q = await decide(req.shelter.id, req.params.rid, req.body?.decision, req.body?.note);
    res.json({ id: q.id, status: q.status });
  }));

  // Wie viele Anfragen gleichzeitig ankommen dürfen
  r.patch('/shelters/:sid/settings', member(true), asyncRoute(async (req, res) => {
    const per = Number(req.body?.perAnimalLimit), daily = Number(req.body?.dailyRequestLimit);
    if (!Number.isInteger(per) || per < 1 || per > 50) throw new HttpError(422, 'invalid_limit', 'Anfragen pro Tier: 1 bis 50.');
    if (!Number.isInteger(daily) || daily < 1 || daily > 500) throw new HttpError(422, 'invalid_limit', 'Anfragen pro Tag: 1 bis 500.');
    await pool.query('UPDATE shelters SET per_animal_limit = $2, daily_request_limit = $3 WHERE id = $1', [req.shelter.id, per, daily]);
    // Mehr Kapazität → Warteliste rückt nach
    const { rows } = await pool.query("SELECT DISTINCT animal_id FROM adoption_requests WHERE shelter_id = $1 AND status = 'waitlist'", [req.shelter.id]);
    let promoted = 0;
    for (const r2 of rows) promoted += await promote(r2.animal_id);
    res.json({ perAnimalLimit: per, dailyRequestLimit: daily, promoted });
  }));

  // --- Excel-Import ---
  r.get('/import-template.xlsx', asyncRoute(async (_req, res) => {
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', 'attachment; filename="petify-tiere-vorlage.xlsx"');
    res.send(Buffer.from(await buildTemplate()));
  }));

  // 1. Datei + Fotos hochladen → Vorschau mit Fehlern je Zeile
  r.post('/shelters/:sid/imports', member(), shelterOnly, upload.fields([{ name: 'file', maxCount: 1 }, { name: 'photos', maxCount: 60 }]), asyncRoute(async (req, res) => {
    const file = req.files?.file?.[0];
    if (!file) throw new HttpError(422, 'no_file', 'Bitte eine Excel-Datei (.xlsx) auswählen.');
    const parsed = await parseWorkbook(file.buffer);
    if (parsed.error) throw new HttpError(422, 'invalid_file', parsed.error);
    const photos = (req.files.photos ?? []).map((f) => ({ name: fileKey(f.originalname), buffer: f.buffer }));
    const photoNames = new Set(photos.map((p) => p.name));
    const { rows: existing } = await pool.query('SELECT external_id FROM animals WHERE shelter_id = $1 AND external_id = ANY($2)',
      [req.shelter.id, parsed.rows.map((x) => x.externalId).filter(Boolean)]);
    const known = new Set(existing.map((e) => e.external_id));
    const rows = parsed.rows.map((x) => ({
      ...x,
      action: x.errors.length ? 'skip' : known.has(x.externalId) ? 'update' : 'create',
      photosFound: x.photoNames.filter((n) => photoNames.has(fileKey(n))),
      photosMissing: x.photoNames.filter((n) => !photoNames.has(fileKey(n))),
    }));
    const referenced = new Set(rows.flatMap((x) => x.photoNames.map(fileKey)));
    const { rows: [imp] } = await pool.query('INSERT INTO imports (shelter_id, user_id, filename, rows, photos) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [req.shelter.id, req.user.id, file.originalname, JSON.stringify(rows), JSON.stringify(photos.map((p) => p.name))]);
    if (photos.length) {
      await mkdir(stagingDir(imp.id), { recursive: true });
      for (const p of photos) await writeFile(resolve(stagingDir(imp.id), encodeURIComponent(p.name)), p.buffer);
    }
    const count = (a) => rows.filter((x) => x.action === a).length;
    res.status(201).json({
      id: imp.id, filename: file.originalname,
      summary: { create: count('create'), update: count('update'), skip: count('skip'), photos: photos.length },
      unusedPhotos: photos.map((p) => p.name).filter((n) => !referenced.has(n)),
      rows: rows.map(({ doc, ...rest }) => rest),
    });
  }));

  // 2. Vorschau übernehmen: fehlerfreie Zeilen speichern, Fotos zuordnen
  r.post('/shelters/:sid/imports/:iid/commit', member(), shelterOnly, asyncRoute(async (req, res) => {
    if (!isUuid(req.params.iid)) throw new HttpError(404, 'not_found', 'Import nicht gefunden.');
    const { rows: [imp] } = await pool.query("SELECT * FROM imports WHERE id = $1 AND shelter_id = $2 AND status = 'preview'", [req.params.iid, req.shelter.id]);
    if (!imp) throw new HttpError(404, 'not_found', 'Import nicht gefunden oder schon übernommen.');
    const valid = imp.rows.filter((x) => !x.errors.length);
    const client = await pool.connect();
    const saved = [];
    try {
      await client.query('BEGIN');
      for (const x of valid) saved.push({ x, ...(await upsertAnimal(req.shelter.id, x.doc, client)) });
      await client.query("UPDATE imports SET status = 'committed' WHERE id = $1", [imp.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    let photos = 0;
    const photoErrors = [];
    for (const { x, id } of saved) {
      const { rows: have } = await pool.query('SELECT source_name FROM photos WHERE animal_id = $1', [id]);
      const already = new Set(have.map((h) => h.source_name));
      for (const name of x.photosFound) {
        const key = fileKey(name);
        if (already.has(key)) continue;
        try {
          const buffer = await readFile(resolve(stagingDir(imp.id), encodeURIComponent(key)));
          await storePhoto({ buffer, animalId: id, shelterId: req.shelter.id, alt: x.name, sourceName: key });
          photos++;
        } catch (err) {
          photoErrors.push(`${name}: ${err.message}`);
        }
      }
    }
    await rm(stagingDir(imp.id), { recursive: true, force: true });
    res.json({
      created: saved.filter((s) => s.inserted).length, updated: saved.filter((s) => !s.inserted).length,
      skipped: imp.rows.length - valid.length, photos, photoErrors,
    });
  }));

  r.delete('/shelters/:sid/imports/:iid', member(), asyncRoute(async (req, res) => {
    if (!isUuid(req.params.iid)) throw new HttpError(404, 'not_found', 'Import nicht gefunden.');
    await pool.query("UPDATE imports SET status = 'discarded' WHERE id = $1 AND shelter_id = $2 AND status = 'preview'", [req.params.iid, req.shelter.id]);
    await rm(stagingDir(req.params.iid), { recursive: true, force: true });
    res.status(204).end();
  }));

  // --- Team ---
  r.get('/shelters/:sid/members', member(), asyncRoute(async (req, res) => {
    const { rows } = await pool.query(`SELECT m.email, m.role, m.created_at, u.name, u.last_login_at FROM shelter_members m
      LEFT JOIN users u ON u.email = m.email WHERE m.shelter_id = $1 ORDER BY m.role, m.email`, [req.shelter.id]);
    res.json({ members: rows.map((m) => ({ email: m.email, role: m.role, name: m.name, joined: Boolean(m.last_login_at) })) });
  }));

  r.post('/shelters/:sid/members', member(true), shelterOnly, asyncRoute(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const role = req.body?.role === 'admin' ? 'admin' : 'member';
    if (!isEmail(email)) throw new HttpError(422, 'invalid_email', 'Bitte eine gültige E-Mail-Adresse eingeben.');
    await pool.query(`INSERT INTO shelter_members (shelter_id, email, role) VALUES ($1,$2,$3)
      ON CONFLICT (shelter_id, email) DO UPDATE SET role = EXCLUDED.role`, [req.shelter.id, email, role]);
    res.status(201).json({ email, role });
  }));

  r.delete('/shelters/:sid/members/:email', member(true), asyncRoute(async (req, res) => {
    const email = normalizeEmail(req.params.email);
    const { rows: admins } = await pool.query("SELECT email FROM shelter_members WHERE shelter_id = $1 AND role = 'admin'", [req.shelter.id]);
    if (admins.length === 1 && admins[0].email === email) throw new HttpError(422, 'last_admin', 'Das Tierheim braucht mindestens einen Admin.');
    await pool.query('DELETE FROM shelter_members WHERE shelter_id = $1 AND email = $2', [req.shelter.id, email]);
    res.status(204).end();
  }));

  // API-Schlüssel für die Anbindung eigener Software (z. B. Tierheimverwaltung)
  r.post('/shelters/:sid/api-key', member(true), shelterOnly, asyncRoute(async (req, res) => {
    if (req.shelter.status !== 'active') throw new HttpError(422, 'not_active', 'API-Schlüssel gibt es nach der Freischaltung des Tierheims.');
    const apiKey = newApiKey();
    await pool.query('UPDATE shelters SET api_key_hash = $2 WHERE id = $1', [req.shelter.id, hashKey(apiKey)]);
    res.json({ apiKey });
  }));

  return r;
}
