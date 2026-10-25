// Legt das Schema an und spielt Beispiel-Tierheime mit Beispieltieren ein.
//   --reset         löscht vorher alle Tabellen
//   --no-examples   nur Schema, keine Beispieldaten
import { readFile } from 'node:fs/promises';
import { pool } from '../src/db.js';
import { validateAnimal } from '../src/validate.js';
import { newApiKey, hashKey } from '../src/auth.js';

const reset = process.argv.includes('--reset');
const examples = !process.argv.includes('--no-examples');
const client = await pool.connect();
try {
  await client.query('BEGIN');
  if (reset) await client.query('DROP TABLE IF EXISTS adoption_requests, user_profiles, imports, photos, sessions, login_tokens, shelter_members, users, animals, shelters CASCADE');
  await client.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  const { rows: [{ n }] } = await client.query('SELECT count(*)::int AS n FROM shelters');
  if (examples && n === 0) {
    const data = JSON.parse(await readFile(new URL('../db/examples.json', import.meta.url), 'utf8'));
    const ids = {};
    console.log('Beispiel-Tierheime (API-Schlüssel werden nur jetzt angezeigt):');
    for (const s of data.shelters) {
      const key = newApiKey();
      const { rows: [row] } = await client.query(`INSERT INTO shelters (name, street, postal_code, city, lat, lng, website, email, is_example, api_key_hash)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9) RETURNING id`, [s.name, s.street, s.postalCode, s.city, s.location.lat, s.location.lng, s.website, s.email, hashKey(key)]);
      ids[s.key] = row.id;
      console.log(`  ${s.name}: ${key}`);
    }
    for (const { shelter, ...animal } of data.animals) {
      const v = validateAnimal(animal);
      if (!v.ok) throw new Error(`Beispieltier ${animal.name} ist ungültig: ${v.errors.join('; ')}`);
      await client.query('INSERT INTO animals (shelter_id, external_id, status, species, name, data) VALUES ($1,$2,$3,$4,$5,$6)',
        [ids[shelter], v.value.externalId, v.value.status, v.value.species, v.value.name, v.value]);
    }
    console.log(`${data.animals.length} Beispieltiere eingespielt.`);
  }
  await client.query('COMMIT');
  console.log('Datenbank bereit.');
} catch (err) {
  await client.query('ROLLBACK');
  console.error('Fehler:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
