// Fotos: verkleinern, als WebP speichern, Metadaten (z. B. GPS aus EXIF) entfernen.
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { pool } from './db.js';
import { HttpError } from './auth.js';

export const uploadDir = resolve(process.env.UPLOAD_DIR ?? './uploads');
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTOS = 12;

export const photoUrls = (id) => ({ url: `/media/${id}.webp`, thumbUrl: `/media/${id}-480.webp` });

// Bildinhalt prüfen (nicht nur den Dateityp aus dem Upload glauben) und zwei Größen ablegen
export async function storePhoto({ buffer, animalId, shelterId, alt = null, position, sourceName = null }) {
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw new HttpError(422, 'invalid_photo', 'Die Datei ist kein lesbares Bild.');
  }
  if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw new HttpError(422, 'invalid_photo', 'Erlaubt sind JPG, PNG und WebP.');
  const { rows: [{ n }] } = await pool.query('SELECT count(*)::int AS n FROM photos WHERE animal_id = $1', [animalId]);
  if (n >= MAX_PHOTOS) throw new HttpError(422, 'too_many_photos', `Höchstens ${MAX_PHOTOS} Fotos pro Tier.`);
  const base = sharp(buffer).rotate();   // EXIF-Drehung anwenden; Metadaten werden beim Export verworfen
  const large = await base.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  const thumb = await base.clone().resize({ width: 480, height: 480, fit: 'cover', position: 'attention' }).webp({ quality: 78 }).toBuffer();
  const { rows: [photo] } = await pool.query(
    'INSERT INTO photos (animal_id, shelter_id, position, alt, source_name, width, height) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [animalId, shelterId, position ?? n, alt, sourceName, large.info.width, large.info.height]);
  await mkdir(uploadDir, { recursive: true });
  await writeFile(resolve(uploadDir, `${photo.id}.webp`), large.data);
  await writeFile(resolve(uploadDir, `${photo.id}-480.webp`), thumb);
  return { id: photo.id, ...photoUrls(photo.id), width: large.info.width, height: large.info.height, alt };
}

export async function deletePhotoFiles(ids) {
  await Promise.all(ids.flatMap((id) => [`${id}.webp`, `${id}-480.webp`].map((f) => rm(resolve(uploadDir, f), { force: true }))));
}
