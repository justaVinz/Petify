// Vermittlungsanfragen mit Vorprüfung, Warteliste und Postfach; Fragebogen; private Abgabe mit Moderation
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const uploads = mkdtempSync(join(tmpdir(), 'pfotenmatch-'));
process.env.UPLOAD_DIR = uploads;
process.env.ADMIN_TOKEN = 'test-admin-token-123';
process.env.APP_URL = 'http://localhost';

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db.js');
const { deps } = await import('../src/accounts.js');
const { scoreQuestionnaire, QUESTIONS } = await import('../src/questionnaire.js');

const mails = [];
deps.sendMail = async (m) => { mails.push(m); };
const run = Date.now().toString(36);
const mail = (name) => `${name}-${run}@anfrage.test`;
let server, base;

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  await pool.query('DELETE FROM shelters WHERE id IN (SELECT shelter_id FROM shelter_members WHERE email LIKE $1)', [`%-${run}@anfrage.test`]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`%-${run}@anfrage.test`]);
  server.close();
  await pool.end();
  rmSync(uploads, { recursive: true, force: true });
});

const cookieOf = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ');

function client(cookie = '') {
  return async (method, path, body) => {
    const headers = { cookie, 'x-pfotenmatch': '1' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* kein JSON */ }
    return { status: res.status, body: json, res };
  };
}

async function login(email, next) {
  const anon = client();
  assert.equal((await anon('POST', '/auth/email/start', { email, next })).status, 200);
  const link = mails.findLast((m) => m.to === email && m.link).link;
  const verify = await fetch(link.replace('http://localhost', base), { redirect: 'manual' });
  const target = new URL(verify.headers.get('location'), base);
  const confirm = await anon('POST', '/auth/email/confirm', { token: target.searchParams.get('anmelden') });
  assert.equal(confirm.status, 200);
  const api = client(cookieOf(confirm.res));
  api.landedOn = target;
  return api;
}

const admin = (method, path, body) => fetch(`${base}/v1/admin${path}`, {
  method, headers: { 'Content-Type': 'application/json', 'X-Admin-Token': process.env.ADMIN_TOKEN }, body: body && JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

// Mittlere Antworten im Fragebogen: Wohnung reicht, für Anfänger, bis 4 Stunden allein
const middle = Object.fromEntries(QUESTIONS.map((q) => [q.id, q.id === 'handling' || q.id === 'space' ? 0 : 2]));
const animalBody = (n, extra = {}) => ({
  externalId: `Q-${n}`, status: 'available', name: `Fragebogen-Tier ${n}`, species: 'cat', sex: 'female', hasFur: true,
  compatibility: { children: 'yes', dogs: 'unknown', cats: 'yes', smallAnimals: 'no' },
  description: 'Ruhige, freundliche Katze, die gern am Fenster sitzt und Besuch neugierig begrüßt.',
  url: `https://heim.example/tiere/${n}`,
  assessment: { method: 'questionnaire', answers: middle, assessedAt: '2026-10-01' },
  ...extra,
});
const profile = (extra = {}) => ({
  activity: 0.5, affection: 0.5, patience: 0.6, busyHome: 0.4, routine: 0.5, curiosity: 0.5,
  space: 'apartment', timeAtHome: 'medium', experience: 'some', children: false, otherPets: [], allergy: false, ...extra,
});
const message = 'Ich wohne ruhig in einer Altbauwohnung, arbeite drei Tage im Homeoffice und hatte als Kind schon Katzen. Ich freue mich auf ein Kennenlernen.';
const yes = { serious: true, contact: true };

test('Fragebogen: Verhalten wird in Skalen und Anforderungen übersetzt', () => {
  const s = scoreQuestionnaire({ ...middle, strangers: 0, noises: 4, alone: 3, handling: 2, space: 1 });
  assert.equal(s.complete, true);
  assert.deepEqual(s.character, { activity: 3, affection: 3, anxiety: 3, noiseTolerance: 3, routineNeed: 3, playfulness: 3 });
  assert.deepEqual(s.requirements, { timeNeed: 2, maxHoursAlone: 6, experience: 'experienced', space: 'balcony' });
  const partial = scoreQuestionnaire({ energy: 4 });
  assert.equal(partial.complete, false);
  assert.equal(partial.character.activity, 5);
  assert.equal(partial.character.affection, null);
});

test('Login-Link führt zurück auf die Seite, von der er angefordert wurde', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const api = await login(mail('ziel'), `tier/${id}`);
  assert.equal(api.landedOn.pathname, '/tier.html');
  assert.equal(api.landedOn.searchParams.get('id'), id);
  const other = await login(mail('ziel2'), 'https://boese.example');
  assert.equal(other.landedOn.pathname, '/verwaltung.html');
});

test('Anfragen: Vorprüfung, Limits, Warteliste, Postfach, Zusage', async () => {
  // Tierheim mit einem Tier aus dem Fragebogen, höchstens 1 offene Anfrage pro Tier
  const heim = await login(mail('heim'));
  const reg = await heim('POST', '/portal/api/shelters', { name: 'Test-Tierheim Anfrage', postalCode: '04109', city: 'Leipzig', website: 'https://heim.example' });
  const sid = reg.body.id;
  assert.equal((await admin('POST', `/shelters/${sid}/status`, { status: 'active' })).status, 200);
  const created = await heim('POST', `/portal/api/shelters/${sid}/animals`, animalBody(1));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual(created.body.character, { activity: 3, affection: 3, anxiety: 3, noiseTolerance: 3, routineNeed: 3, playfulness: 3 });
  assert.equal(created.body.requirements.space, 'apartment');
  assert.equal(created.body.review.status, 'approved');
  const animalId = created.body.id;
  // Handeingaben haben Vorrang vor dem Fragebogen
  const manual = await heim('PUT', `/portal/api/shelters/${sid}/animals/${animalId}`, { ...animalBody(1), character: { activity: 3, affection: 3, anxiety: 3, noiseTolerance: 3, routineNeed: 3, playfulness: 4 } });
  assert.equal(manual.body.character.playfulness, 4);
  assert.equal((await heim('POST', `/portal/api/shelters/${sid}/animals`, { ...animalBody(2), url: undefined })).status, 422, 'Tierheime brauchen den Link');
  assert.equal((await heim('PATCH', `/portal/api/shelters/${sid}/settings`, { perAnimalLimit: 1, dailyRequestLimit: 25 })).status, 200);

  // Ohne Persönlichkeitstest keine Anfrage
  const anna = await login(mail('anna'));
  assert.equal((await anna('POST', '/portal/api/requests', { animalId, message, confirmations: yes })).body.error.code, 'needs_profile');
  assert.equal((await anna('PUT', '/portal/api/me/profile', { activity: 2 })).status, 422);
  assert.equal((await anna('PUT', '/portal/api/me/profile', profile())).status, 200);
  assert.equal((await anna('POST', '/portal/api/requests', { animalId, message: 'Hallo!', confirmations: yes })).body.error.code, 'message_too_short');
  assert.equal((await anna('POST', '/portal/api/requests', { animalId, message, confirmations: { serious: true } })).body.error.code, 'confirmations');

  const a1 = await anna('POST', '/portal/api/requests', { animalId, message, confirmations: yes });
  assert.equal(a1.status, 201, JSON.stringify(a1.body));
  assert.equal(a1.body.status, 'sent');
  assert.ok(a1.body.score >= 55);
  assert.ok(mails.some((m) => m.to === mail('heim') && /Neue Anfrage/.test(m.subject)), 'Anbieter wird benachrichtigt');
  assert.equal((await anna('POST', '/portal/api/requests', { animalId, message, confirmations: yes })).status, 409, 'nur eine offene Anfrage pro Tier');

  // Kapazität erschöpft → Warteliste
  const ben = await login(mail('ben'));
  await ben('PUT', '/portal/api/me/profile', profile({ experience: 'beginner' }));
  const b1 = await ben('POST', '/portal/api/requests', { animalId, message, confirmations: yes });
  assert.deepEqual([b1.body.status, b1.body.position], ['waitlist', 1]);

  // Unpassende Lebensumstände → automatisch abgesagt, Anbieter sieht nichts davon
  const cem = await login(mail('cem'));
  await cem('PUT', '/portal/api/me/profile', profile({ allergy: true }));
  const c1 = await cem('POST', '/portal/api/requests', { animalId, message, confirmations: yes });
  assert.equal(c1.body.status, 'declined_auto');
  assert.match(c1.body.note, /allergie/i);

  // Eigenes Tier: keine Anfrage
  await heim('PUT', '/portal/api/me/profile', profile());
  assert.equal((await heim('POST', '/portal/api/requests', { animalId, message, confirmations: yes })).body.error.code, 'own_animal');

  // Postfach: Kontaktdaten erst nach Zusage, Warteliste ohne Inhalt
  const box = await heim('GET', `/portal/api/shelters/${sid}/requests`);
  assert.equal(box.body.requests.length, 1);
  assert.deepEqual(box.body.counts, { sent: 1, waitlist: 1 });
  assert.equal(box.body.requests[0].applicant.email, undefined);
  assert.equal(box.body.requests[0].message, message);
  const wait = await heim('GET', `/portal/api/shelters/${sid}/requests?status=waitlist`);
  assert.equal(wait.body.requests[0].message, null);
  const fremd = await login(mail('fremd'));
  assert.equal((await fremd('GET', `/portal/api/shelters/${sid}/requests`)).status, 403);

  // Absage → Warteliste rückt nach
  assert.equal((await heim('POST', `/portal/api/shelters/${sid}/requests/${a1.body.id}/decision`, { decision: 'declined', note: 'Wir suchen jemanden mit Garten.' })).status, 200);
  assert.ok(mails.some((m) => m.to === mail('anna') && /Garten/.test(m.text)));
  const benReqs = (await ben('GET', '/portal/api/me/requests')).body.requests;
  assert.equal(benReqs[0].status, 'sent');
  assert.equal(benReqs[0].contact, null);

  // Zusage → Kontaktdaten auf beiden Seiten
  assert.equal((await heim('POST', `/portal/api/shelters/${sid}/requests/${b1.body.id}/decision`, { decision: 'accepted' })).status, 200);
  assert.equal((await heim('POST', `/portal/api/shelters/${sid}/requests/${b1.body.id}/decision`, { decision: 'accepted' })).status, 404, 'nur einmal');
  assert.equal((await ben('GET', '/portal/api/me/requests')).body.requests[0].contact.email, reg.body.email);
  const accepted = await heim('GET', `/portal/api/shelters/${sid}/requests?status=accepted`);
  assert.equal(accepted.body.requests[0].applicant.email, mail('ben'));

  // Reserviert → offene Anfragen werden geschlossen
  const anna2 = await anna('POST', '/portal/api/requests', { animalId, message, confirmations: yes });
  assert.equal(anna2.body.status, 'sent', 'Zusagen belegen keinen Platz mehr');
  await heim('PATCH', `/portal/api/shelters/${sid}/animals/${animalId}/status`, { status: 'reserved' });
  const annaReqs = (await anna('GET', '/portal/api/me/requests')).body.requests;
  assert.equal(annaReqs.find((q) => q.id === anna2.body.id).status, 'closed');

  // Höchstens 3 offene Anfragen pro Person
  const ids = [];
  for (const n of [3, 4, 5, 6]) ids.push((await heim('POST', `/portal/api/shelters/${sid}/animals`, animalBody(n))).body.id);
  await heim('PATCH', `/portal/api/shelters/${sid}/settings`, { perAnimalLimit: 5, dailyRequestLimit: 100 });
  const dora = await login(mail('dora'));
  await dora('PUT', '/portal/api/me/profile', profile());
  for (const id of ids.slice(0, 3)) assert.equal((await dora('POST', '/portal/api/requests', { animalId: id, message, confirmations: yes })).body.status, 'sent');
  assert.equal((await dora('POST', '/portal/api/requests', { animalId: ids[3], message, confirmations: yes })).body.error.code, 'too_many_open');
  // Zurückziehen macht den Platz frei
  const doraReqs = (await dora('GET', '/portal/api/me/requests')).body.requests;
  assert.equal((await dora('POST', `/portal/api/requests/${doraReqs[0].id}/withdraw`)).body.status, 'withdrawn');
  assert.equal((await dora('POST', '/portal/api/requests', { animalId: ids[3], message, confirmations: yes })).body.status, 'sent');
});

test('Private Abgabe: geprüft, ohne Adresse, begrenzt', async () => {
  const eva = await login(mail('eva'), 'konto');
  assert.equal(eva.landedOn.pathname, '/konto.html');
  assert.equal((await eva('POST', '/portal/api/private', { postalCode: '10115', city: 'Berlin' })).status, 422, 'Bestätigungen fehlen');
  const priv = await eva('POST', '/portal/api/private', { postalCode: '10115', city: 'Berlin', location: { lat: 52.531234, lng: 13.384567 }, confirmations: { owner: true, nonCommercial: true } });
  assert.equal(priv.status, 201);
  assert.deepEqual(priv.body.location, { lat: 52.53, lng: 13.38 }, 'Standort gerundet');
  assert.equal((await eva('POST', '/portal/api/private', { postalCode: '10115', city: 'Berlin', confirmations: { owner: true, nonCommercial: true } })).status, 409);
  const me = (await eva('GET', '/portal/api/me')).body;
  assert.equal(me.private.id, priv.body.id);
  assert.deepEqual(me.shelters, []);
  const pid = priv.body.id;

  const body = { ...animalBody(1), url: undefined, externalId: undefined, name: 'Mieze privat' };
  assert.equal((await eva('POST', `/portal/api/shelters/${pid}/animals`, { ...body, adoptionFee: { amount: 500, currency: 'EUR' } })).status, 422, 'Schutzgebühr begrenzt');
  const a = await eva('POST', `/portal/api/shelters/${pid}/animals`, body);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.review.status, 'pending');
  assert.match(a.body.externalId, /^P-/);
  assert.equal((await fetch(`${base}/v1/animals/${a.body.id}`)).status, 404, 'vor der Prüfung nicht öffentlich');
  assert.equal((await eva('POST', `/portal/api/shelters/${pid}/api-key`)).status, 403);

  const pending = await admin('GET', '/animals?review=pending');
  assert.ok(pending.body.animals.some((x) => x.id === a.body.id));
  assert.equal((await admin('POST', `/animals/${a.body.id}/review`, { status: 'rejected' })).status, 422, 'Begründung nötig');
  assert.equal((await admin('POST', `/animals/${a.body.id}/review`, { status: 'approved' })).status, 200);
  const pub = await (await fetch(`${base}/v1/animals/${a.body.id}`)).json();
  assert.equal(pub.shelter.name, 'Privatabgabe');
  assert.equal(pub.shelter.website, null);
  assert.match(pub.url, /\/tier\.html\?id=/);

  // Änderungen werden erneut geprüft
  const edited = await eva('PUT', `/portal/api/shelters/${pid}/animals/${a.body.id}`, { ...body, description: `${body.description} Sie mag Leckerlis.` });
  assert.equal(edited.body.review.status, 'pending');
  assert.equal(edited.body.externalId, a.body.externalId);

  for (const n of [2, 3]) assert.equal((await eva('POST', `/portal/api/shelters/${pid}/animals`, { ...body, name: `Mieze ${n}` })).status, 201);
  assert.equal((await eva('POST', `/portal/api/shelters/${pid}/animals`, { ...body, name: 'Mieze 4' })).body.error.code, 'listing_limit');
});
