// Gemeinsame Logik für Tiere – genutzt von der API (API-Schlüssel) und vom Verwaltungsbereich (Login).
import { randomBytes } from 'node:crypto';
import { pool } from './db.js';
import { validateAnimal } from './validate.js';
import { HttpError } from './auth.js';
import { photoUrls, deletePhotoFiles } from './media.js';
import { scoreQuestionnaire } from './questionnaire.js';

const appUrl = () => (process.env.APP_URL ?? 'http://localhost:3200').replace(/\/$/, '');
export const PRIVATE_LISTING_LIMIT = 3;
export const PRIVATE_FEE_LIMIT = 300;

export const ANIMAL_SELECT = `SELECT a.*, s.name AS shelter_name, s.city, s.postal_code, s.website, s.lat, s.lng, s.is_example, s.status AS shelter_status, s.kind,
  coalesce((SELECT json_agg(json_build_object('id', p.id, 'alt', p.alt, 'width', p.width, 'height', p.height) ORDER BY p.position, p.created_at)
            FROM photos p WHERE p.animal_id = a.id), '[]') AS uploaded
  FROM animals a JOIN shelters s ON s.id = a.shelter_id`;

// Öffentlich sichtbar: Anbieter freigeschaltet und Tier geprüft
export const PUBLIC_WHERE = "s.status = 'active' AND a.review_status = 'approved'";

export const animalOut = (row, extra = {}) => ({
  id: row.id,
  ...row.data,
  url: row.data.url ?? `${appUrl()}/tier.html?id=${row.id}`,
  // Hochgeladene Fotos zuerst, danach extern verlinkte Fotos aus dem Profil
  photos: [
    ...row.uploaded.map((p) => ({ id: p.id, ...photoUrls(p.id), alt: p.alt ?? `${row.name}`, width: p.width, height: p.height })),
    ...(row.data.photos ?? []),
  ],
  shelter: row.kind === 'private'
    ? { id: row.shelter_id, kind: 'private', name: 'Privatabgabe', city: row.city, postalCode: row.postal_code, website: null, isExample: row.is_example }
    : { id: row.shelter_id, kind: 'shelter', name: row.shelter_name, city: row.city, postalCode: row.postal_code, website: row.website, isExample: row.is_example },
  review: { status: row.review_status, note: row.review_note },
  createdAt: row.created_at, updatedAt: row.updated_at,
  ...extra,
});

export async function readAnimal(id) {
  const { rows: [row] } = await pool.query(`${ANIMAL_SELECT} WHERE a.id = $1`, [id]);
  return row;
}

// Fehlende Charakter- und Anforderungswerte aus dem Fragebogen ergänzen (Handeingaben haben Vorrang)
export function applyQuestionnaire(body) {
  if (body?.assessment?.method !== 'questionnaire' || !body.assessment.answers) return body;
  const score = scoreQuestionnaire(body.assessment.answers);
  const out = structuredClone(body);
  out.character = { ...Object.fromEntries(Object.entries(score.character).filter(([, v]) => v !== null)), ...(out.character ?? {}) };
  const req = Object.fromEntries(Object.entries(score.requirements).filter(([, v]) => v !== null));
  out.requirements = { ...req, ...(out.requirements ?? {}) };
  return out;
}

// Prüft das Profil und die Regeln je Anbieterart; liefert das gespeicherte Dokument
function prepare(provider, body) {
  const input = applyQuestionnaire(body ?? {});
  if (provider.kind === 'private') {
    delete input.url;
    delete input.intakeDate;
    input.externalId ||= `P-${randomBytes(4).toString('hex').toUpperCase()}`;
  }
  const result = validateAnimal(input);
  const errors = result.ok ? [] : [...result.errors];
  if (provider.kind === 'shelter' && !input.url) errors.push('url: Pflichtfeld für Tierheime – Link zur Tierseite auf eurer Website');
  if (provider.kind === 'private' && input.adoptionFee?.amount > PRIVATE_FEE_LIMIT) errors.push(`adoptionFee: Bei privater Abgabe höchstens ${PRIVATE_FEE_LIMIT} € Schutzgebühr`);
  if (errors.length) throw new HttpError(422, 'invalid_animal', 'Das Tierprofil ist unvollständig oder fehlerhaft.', errors);
  return result.value;
}

const reviewFor = (provider) => (provider.kind === 'private' ? 'pending' : 'approved');

export async function createAnimal(provider, body) {
  const doc = prepare(provider, body);
  if (provider.kind === 'private') {
    const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM animals WHERE shelter_id = $1 AND status <> 'adopted'", [provider.id]);
    if (n >= PRIVATE_LISTING_LIMIT) throw new HttpError(422, 'listing_limit', `Privat könnt ihr höchstens ${PRIVATE_LISTING_LIMIT} Tiere gleichzeitig einstellen.`);
  }
  try {
    const { rows: [row] } = await pool.query(
      'INSERT INTO animals (shelter_id, external_id, status, species, name, data, review_status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [provider.id, doc.externalId, doc.status, doc.species, doc.name, doc, reviewFor(provider)]);
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
  if (row.shelter_id !== shelterId) throw new HttpError(403, 'forbidden', 'Dieses Tier gehört zu einem anderen Anbieter.');
  return row;
}

export async function replaceAnimal(provider, id, body) {
  const old = await ownAnimal(provider.id, id);
  const doc = prepare(provider, { ...body, externalId: body?.externalId || old.external_id });
  try {
    // Geänderte Privatanzeigen werden erneut geprüft
    await pool.query(`UPDATE animals SET external_id=$2, status=$3, species=$4, name=$5, data=$6, updated_at=now(),
      review_status = CASE WHEN $7 = 'private' THEN 'pending' ELSE review_status END WHERE id=$1`,
    [id, doc.externalId, doc.status, doc.species, doc.name, doc, provider.kind]);
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
  if (status !== 'available') {
    // Offene Anfragen schließen, damit niemand umsonst wartet
    await pool.query(`UPDATE adoption_requests SET status = 'closed', decided_at = now(),
      note = CASE $2 WHEN 'reserved' THEN 'Das Tier ist inzwischen reserviert.' WHEN 'adopted' THEN 'Das Tier hat ein Zuhause gefunden.' ELSE 'Das Tier ist gerade nicht vermittelbar.' END
      WHERE animal_id = $1 AND status IN ('waitlist', 'sent')`, [id, status]);
  }
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
