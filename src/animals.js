// Gemeinsame Logik für Tiere – genutzt von der API (API-Schlüssel) und vom Verwaltungsbereich (Login).
import { pool } from './db.js';
import { validateAnimal } from './validate.js';
import { HttpError } from './auth.js';
import { photoUrls, deletePhotoFiles } from './media.js';

export const ANIMAL_SELECT = `SELECT a.*, s.name AS shelter_name, s.city, s.postal_code, s.website, s.lat, s.lng, s.is_example, s.status AS shelter_status,
  coalesce((SELECT json_agg(json_build_object('id', p.id, 'alt', p.alt, 'width', p.width, 'height', p.height) ORDER BY p.position, p.created_at)
            FROM photos p WHERE p.animal_id = a.id), '[]') AS uploaded
  FROM animals a JOIN shelters s ON s.id = a.shelter_id`;

export const animalOut = (row, extra = {}) => ({
  id: row.id,
  ...row.data,
  // Hochgeladene Fotos zuerst, danach extern verlinkte Fotos aus dem Profil
  photos: [
    ...row.uploaded.map((p) => ({ id: p.id, ...photoUrls(p.id), alt: p.alt ?? `${row.name}`, width: p.width, height: p.height })),
    ...(row.data.photos ?? []),
  ],
  shelter: { id: row.shelter_id, name: row.shelter_name, city: row.city, postalCode: row.postal_code, website: row.website, isExample: row.is_example },
  createdAt: row.created_at, updatedAt: row.updated_at,
  ...extra,
});

export async function readAnimal(id) {
  const { rows: [row] } = await pool.query(`${ANIMAL_SELECT} WHERE a.id = $1`, [id]);
  return row;
}

export function requireValid(body) {
  const result = validateAnimal(body);
  if (!result.ok) throw new HttpError(422, 'invalid_animal', 'Das Tierprofil entspricht nicht dem Schema.', result.errors);
  return result.value;
}

export async function createAnimal(shelterId, body) {
  const doc = requireValid(body);
  try {
    const { rows: [row] } = await pool.query(
      'INSERT INTO animals (shelter_id, external_id, status, species, name, data) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [shelterId, doc.externalId, doc.status, doc.species, doc.name, doc]);
    return readAnimal(row.id);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'duplicate_external_id', `Karteinummer „${doc.externalId}“ existiert bereits.`);
    throw err;
  }
}

export async function ownAnimal(shelterId, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) throw new HttpError(404, 'not_found', 'Tier nicht gefunden.');
  const { rows: [row] } = await pool.query('SELECT * FROM animals WHERE id = $1', [id]);
  if (!row) throw new HttpError(404, 'not_found', 'Tier nicht gefunden.');
  if (row.shelter_id !== shelterId) throw new HttpError(403, 'forbidden', 'Dieses Tier gehört zu einem anderen Tierheim.');
  return row;
}

export async function replaceAnimal(shelterId, id, body) {
  await ownAnimal(shelterId, id);
  const doc = requireValid(body);
  try {
    await pool.query('UPDATE animals SET external_id=$2, status=$3, species=$4, name=$5, data=$6, updated_at=now() WHERE id=$1',
      [id, doc.externalId, doc.status, doc.species, doc.name, doc]);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'duplicate_external_id', `Karteinummer „${doc.externalId}“ gehört schon zu einem anderen Tier.`);
    throw err;
  }
  return readAnimal(id);
}

export const STATUSES = ['available', 'reserved', 'adopted', 'not_available'];

export async function setStatus(shelterId, id, status) {
  await ownAnimal(shelterId, id);
  if (!STATUSES.includes(status)) throw new HttpError(422, 'invalid_status', `status muss einer von ${STATUSES.join(', ')} sein.`);
  await pool.query('UPDATE animals SET status=$2, data = jsonb_set(data, \'{status}\', to_jsonb($2::text)), updated_at=now() WHERE id=$1', [id, status]);
  return readAnimal(id);
}

export async function deleteAnimal(shelterId, id) {
  await ownAnimal(shelterId, id);
  const { rows } = await pool.query('SELECT id FROM photos WHERE animal_id = $1', [id]);
  await pool.query('DELETE FROM animals WHERE id = $1', [id]);
  await deletePhotoFiles(rows.map((r) => r.id));
}

// Anlegen oder aktualisieren über die Karteinummer; doc muss bereits geprüft sein
export async function upsertAnimal(shelterId, doc, client = pool) {
  const { rows: [row] } = await client.query(`INSERT INTO animals (shelter_id, external_id, status, species, name, data) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (shelter_id, external_id) DO UPDATE SET status=EXCLUDED.status, species=EXCLUDED.species, name=EXCLUDED.name, data=EXCLUDED.data, updated_at=now()
    RETURNING id, (xmax = 0) AS inserted`, [shelterId, doc.externalId, doc.status, doc.species, doc.name, doc]);
  return row;
}
