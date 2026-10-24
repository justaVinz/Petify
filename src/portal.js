// Verwaltungsbereich für Tierheime (Login per Sitzung): Registrierung, Team, Excel-Import, Fotos.
import express from 'express';
import multer from 'multer';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { pool } from './db.js';
import { HttpError, newApiKey, hashKey } from './auth.js';
import { requireUser, normalizeEmail, isEmail } from './accounts.js';
import { ANIMAL_SELECT, animalOut, setStatus, deleteAnimal, ownAnimal, upsertAnimal } from './animals.js';
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
});

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
    const { rows } = await pool.query(`SELECT s.*, m.role FROM shelter_members m JOIN shelters s ON s.id = m.shelter_id
      WHERE m.email = $1 ORDER BY s.name`, [req.user.email]);
    res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name }, shelters: rows.map((s) => shelterOut(s, s.role)) });
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

  // --- Excel-Import ---
  r.get('/import-template.xlsx', asyncRoute(async (_req, res) => {
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', 'attachment; filename="pfotenmatch-tiere-vorlage.xlsx"');
    res.send(Buffer.from(await buildTemplate()));
  }));

  // 1. Datei + Fotos hochladen → Vorschau mit Fehlern je Zeile
  r.post('/shelters/:sid/imports', member(), upload.fields([{ name: 'file', maxCount: 1 }, { name: 'photos', maxCount: 60 }]), asyncRoute(async (req, res) => {
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
  r.post('/shelters/:sid/imports/:iid/commit', member(), asyncRoute(async (req, res) => {
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

  r.post('/shelters/:sid/members', member(true), asyncRoute(async (req, res) => {
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
  r.post('/shelters/:sid/api-key', member(true), asyncRoute(async (req, res) => {
    if (req.shelter.status !== 'active') throw new HttpError(422, 'not_active', 'API-Schlüssel gibt es nach der Freischaltung des Tierheims.');
    const apiKey = newApiKey();
    await pool.query('UPDATE shelters SET api_key_hash = $2 WHERE id = $1', [req.shelter.id, hashKey(apiKey)]);
    res.json({ apiKey });
  }));

  return r;
}
