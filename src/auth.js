import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { pool } from './db.js';

export const newApiKey = () => `pm_${randomBytes(24).toString('base64url')}`;
export const hashKey = (key) => createHash('sha256').update(key).digest('hex');

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}

// Tierheim-Zugang: Authorization: Bearer pm_…
export async function requireShelter(req, _res, next) {
  try {
    const m = (req.get('authorization') ?? '').match(/^Bearer\s+(pm_[\w-]+)$/);
    if (!m) throw new HttpError(401, 'unauthorized', 'API-Schlüssel fehlt. Sende ihn als „Authorization: Bearer pm_…“.');
    const { rows: [shelter] } = await pool.query('SELECT * FROM shelters WHERE api_key_hash = $1', [hashKey(m[1])]);
    if (!shelter) throw new HttpError(401, 'unauthorized', 'Unbekannter API-Schlüssel.');
    req.shelter = shelter;
    next();
  } catch (err) {
    next(err);
  }
}

// Verwaltung (Tierheime anlegen): X-Admin-Token aus der Umgebungsvariable ADMIN_TOKEN
export function requireAdmin(req, _res, next) {
  const expected = process.env.ADMIN_TOKEN;
  const given = req.get('x-admin-token') ?? '';
  const ok = expected && expected !== 'bitte-aendern' && given.length === expected.length
    && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  next(ok ? undefined : new HttpError(403, 'forbidden', 'Nur für die Verwaltung (X-Admin-Token).'));
}
