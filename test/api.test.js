// API-Tests gegen PostgreSQL (DATABASE_URL, vorher `npm run db:setup`). Legt eigene Test-Tierheime an und räumt sie wieder ab.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.ADMIN_TOKEN = 'test-admin-token-123';
const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db.js');

const example = JSON.parse(readFileSync(new URL('../db/examples.json', import.meta.url), 'utf8')).animals[0];
const { shelter: _s, ...bruno } = example;
let server, base;
const shelters = [];

const call = async (method, path, { body, key, admin } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (admin) headers['X-Admin-Token'] = admin;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

async function newShelter(name, location = { lat: 48.137, lng: 11.575 }, postalCode = '80331') {
  const res = await call('POST', '/v1/shelters', { admin: process.env.ADMIN_TOKEN, body: { name, postalCode, city: 'Teststadt', location, website: 'https://test.example' } });
  assert.equal(res.status, 201);
  shelters.push(res.body.shelter.id);
  return res.body;
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  if (shelters.length) await pool.query('DELETE FROM shelters WHERE id = ANY($1::uuid[])', [shelters]);
  server.close();
  await pool.end();
});

test('Tierheim anlegen nur mit Verwaltungszugang, Schlüssel nur einmal sichtbar', async () => {
  assert.equal((await call('POST', '/v1/shelters', { body: { name: 'X', postalCode: '80331', city: 'M' } })).status, 403);
  assert.equal((await call('POST', '/v1/shelters', { admin: 'falsch-falsch-falsch', body: { name: 'X', postalCode: '80331', city: 'M' } })).status, 403);
  const { shelter, apiKey } = await newShelter('Testtierheim Alpha');
  assert.match(apiKey, /^pm_/);
  assert.equal((await call('GET', '/v1/me', { key: apiKey })).body.id, shelter.id);
  assert.ok(!('apiKey' in (await call('GET', `/v1/shelters/${shelter.id}`)).body));
});

test('Tier anlegen, lesen, Status ändern, löschen', async () => {
  const { apiKey } = await newShelter('Testtierheim Beta');
  assert.equal((await call('POST', '/v1/animals', { body: bruno })).status, 401);
  const created = await call('POST', '/v1/animals', { key: apiKey, body: bruno });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'Bruno');
  assert.equal(created.body.shelter.name, 'Testtierheim Beta');
  assert.equal(created.body.groupSize, 1, 'Standardwert aus dem Schema');
  assert.equal((await call('POST', '/v1/animals', { key: apiKey, body: bruno })).status, 409);

  const id = created.body.id;
  const reserved = await call('PATCH', `/v1/animals/${id}/status`, { key: apiKey, body: { status: 'reserved' } });
  assert.equal(reserved.body.status, 'reserved');
  const list = await call('GET', '/v1/animals?lat=48.137&lng=11.575&radiusKm=5');
  assert.ok(!list.body.animals.some((a) => a.id === id), 'reservierte Tiere erscheinen nicht in der Suche');
  assert.equal((await call('DELETE', `/v1/animals/${id}`, { key: apiKey })).status, 204);
  assert.equal((await call('GET', `/v1/animals/${id}`)).status, 404);
});

test('Schema-Prüfung liefert verständliche Fehler', async () => {
  const { apiKey } = await newShelter('Testtierheim Gamma');
  const bad = { ...bruno, species: 'drache', character: { ...bruno.character, activity: 9 }, extra: true };
  delete bad.url;
  const res = await call('POST', '/v1/animals', { key: apiKey, body: bad });
  assert.equal(res.status, 422);
  const text = res.body.error.details.join('\n');
  assert.match(text, /url: Pflichtfeld/);
  assert.match(text, /species: erlaubt sind/);
  assert.match(text, /character\.activity/);
  assert.match(text, /unbekanntes Feld „extra“/);
  const from = await call('POST', '/v1/validate', { body: { ...bruno, compatibility: { ...bruno.compatibility, children: 'from_age' } } });
  assert.equal(from.status, 422);
  assert.match(from.body.errors[0], /childrenMinAge/);
  assert.equal((await call('POST', '/v1/validate', { body: bruno })).status, 200);
});

test('Tierheime können nur ihre eigenen Tiere ändern', async () => {
  const a = await newShelter('Testtierheim Delta');
  const b = await newShelter('Testtierheim Epsilon');
  const { body: animal } = await call('POST', '/v1/animals', { key: a.apiKey, body: { ...bruno, externalId: 'D-1' } });
  assert.equal((await call('PUT', `/v1/animals/${animal.id}`, { key: b.apiKey, body: bruno })).status, 403);
  assert.equal((await call('DELETE', `/v1/animals/${animal.id}`, { key: b.apiKey })).status, 403);
  const updated = await call('PUT', `/v1/animals/${animal.id}`, { key: a.apiKey, body: { ...bruno, externalId: 'D-1', name: 'Bruno II' } });
  assert.equal(updated.body.name, 'Bruno II');
});

test('Sammelimport legt an, aktualisiert und meldet ungültige Einträge', async () => {
  const { apiKey } = await newShelter('Testtierheim Zeta');
  const first = await call('POST', '/v1/animals/import', { key: apiKey, body: { animals: [{ ...bruno, externalId: 'Z-1' }, { ...bruno, externalId: 'Z-2', name: 'Rex' }] } });
  assert.deepEqual([first.body.created, first.body.updated, first.body.invalid], [2, 0, 0]);
  const second = await call('POST', '/v1/animals/import', { key: apiKey, body: { animals: [{ ...bruno, externalId: 'Z-1', status: 'adopted' }, { name: 'kaputt' }] } });
  assert.deepEqual([second.body.created, second.body.updated, second.body.invalid], [0, 1, 1]);
  assert.ok(second.body.results[1].errors.length > 0);
  const mine = await call('GET', '/v1/me/animals', { key: apiKey });
  assert.equal(mine.body.animals.find((x) => x.externalId === 'Z-1').status, 'adopted');
});

test('Match: Umkreis, Ausschlüsse mit Grund, Sortierung nach Passung', async () => {
  const { apiKey } = await newShelter('Testtierheim Eta', { lat: 53.55, lng: 9.99 }, '20095');
  const garden = { ...bruno, externalId: 'E-1', name: 'Gartenhund', requirements: { ...bruno.requirements, space: 'garden' } };
  const calm = { ...bruno, externalId: 'E-2', name: 'Sofahund' };
  await call('POST', '/v1/animals/import', { key: apiKey, body: { animals: [garden, calm] } });
  const profile = { activity: 0.3, affection: 0.9, patience: 0.6, busyHome: 0.5, routine: 0.6, curiosity: 0.2, space: 'balcony', timeAtHome: 'medium', experience: 'beginner', children: true, otherPets: [], allergy: false };
  const res = await call('POST', '/v1/match', { body: { location: { lat: 53.56, lng: 10.0, radiusKm: 10 }, profile, limit: 5 } });
  assert.equal(res.status, 200);
  assert.ok(res.body.matches.some((m) => m.animal.name === 'Sofahund'));
  assert.ok(res.body.matches.every((m) => m.animal.distanceKm <= 10));
  assert.match(res.body.excluded.find((x) => x.name === 'Gartenhund').reasons[0], /Garten/);
  const allergic = await call('POST', '/v1/match', { body: { location: { lat: 53.56, lng: 10.0, radiusKm: 10 }, profile: { ...profile, allergy: true } } });
  assert.equal(allergic.body.matches.length, 0);
  assert.equal((await call('POST', '/v1/match', { body: { profile: { activity: 2 } } })).status, 400);
});

test('OpenAPI und CORS', async () => {
  const spec = await (await fetch(`${base}/openapi.json`)).json();
  assert.equal(spec.openapi, '3.1.0');
  assert.ok(spec.components.schemas.Animal.properties.character);
  const pre = await fetch(`${base}/v1/animals`, { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
});
