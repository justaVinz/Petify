// Login, Verwaltungsbereich und Excel-Import (gegen PostgreSQL, Fotos in einem Temp-Ordner)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const uploads = mkdtempSync(join(tmpdir(), 'petify-'));
process.env.UPLOAD_DIR = uploads;
process.env.ADMIN_TOKEN = 'test-admin-token-123';
process.env.APP_URL = 'http://localhost';
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db.js');
const { deps } = await import('../src/accounts.js');
const { buildTemplate } = await import('../src/excel.js');
const { default: ExcelJS } = await import('exceljs');
const { default: sharp } = await import('sharp');

const mails = [];
deps.sendMail = async (m) => { mails.push(m); };
const run = Date.now().toString(36);
const mail = (name) => `${name}-${run}@tierheim.test`;
let server, base;

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  await pool.query("DELETE FROM shelters WHERE email LIKE $1 OR name LIKE 'Test-Tierheim%'", [`%-${run}@tierheim.test`]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`%-${run}@tierheim.test`]);
  server.close();
  await pool.end();
  rmSync(uploads, { recursive: true, force: true });
});

const cookieOf = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ');

function client(cookie = '') {
  return async (method, path, body, { form = false, csrf = true } = {}) => {
    const headers = { cookie };
    if (csrf) headers['x-petify'] = '1';
    if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + path, { method, headers, body: form ? body : body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* kein JSON */ }
    return { status: res.status, body: json, res };
  };
}

async function login(email) {
  const anon = client();
  const start = await anon('POST', '/auth/email/start', { email });
  assert.equal(start.status, 200);
  const link = mails.findLast((m) => m.to === email && m.link).link;
  const verify = await fetch(link.replace('http://localhost', base), { redirect: 'manual' });
  assert.equal(verify.status, 302);
  const token = new URL(verify.headers.get('location'), base).searchParams.get('anmelden');
  const confirm = await anon('POST', '/auth/email/confirm', { token });
  assert.equal(confirm.status, 200);
  return client(cookieOf(confirm.res));
}

async function sampleXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildTemplate());
  const ws = wb.getWorksheet('Tiere');
  const example = ws.getRow(2).values.slice(1);
  for (const change of rows) {
    const row = [...example];
    for (const [i, v] of Object.entries(change)) row[i] = v;
    ws.addRow(row);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const jpeg = () => sharp({ create: { width: 900, height: 700, channels: 3, background: { r: 200, g: 150, b: 60 } } }).jpeg().toBuffer();

test('E-Mail-Login: Link nur einmal gültig, Bestätigung nur von der eigenen Seite', async () => {
  const anon = client();
  assert.equal((await anon('POST', '/auth/email/start', { email: 'kein-email' })).status, 422);
  const email = mail('einmal');
  await anon('POST', '/auth/email/start', { email });
  const token = new URL(mails.at(-1).link).searchParams.get('token');
  assert.equal((await anon('POST', '/auth/email/confirm', { token }, { csrf: false })).status, 403);
  const ok = await anon('POST', '/auth/email/confirm', { token });
  assert.equal(ok.status, 200);
  assert.match(cookieOf(ok.res), /^pm_session=/);
  assert.equal((await anon('POST', '/auth/email/confirm', { token })).status, 410);
  const me = await client(cookieOf(ok.res))('GET', '/portal/api/me');
  assert.equal(me.body.user.email, email);
  assert.equal((await anon('GET', '/portal/api/me')).status, 401);
});

test('Google-Login mit geprüfter E-Mail', async () => {
  const email = mail('google');
  deps.fetch = async (url) => {
    if (url.includes('/token')) return new Response(JSON.stringify({ access_token: 'at-1' }), { status: 200 });
    return new Response(JSON.stringify({ sub: `g-${run}`, email, email_verified: true, name: 'Gina Google' }), { status: 200 });
  };
  const go = await fetch(`${base}/auth/google`, { redirect: 'manual' });
  const location = new URL(go.headers.get('location'));
  assert.equal(location.hostname, 'accounts.google.com');
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  const state = location.searchParams.get('state');
  const oauthCookie = cookieOf(go);
  const wrong = await fetch(`${base}/auth/google/callback?code=c&state=falsch`, { headers: { cookie: oauthCookie }, redirect: 'manual' });
  assert.match(wrong.headers.get('location'), /fehler=google/);
  const cb = await fetch(`${base}/auth/google/callback?code=c&state=${state}`, { headers: { cookie: oauthCookie }, redirect: 'manual' });
  assert.equal(cb.headers.get('location'), '/verwaltung.html');
  const me = await client(cookieOf(cb))('GET', '/portal/api/me');
  assert.equal(me.body.user.name, 'Gina Google');
  // Unbestätigte Google-Adresse wird abgelehnt
  deps.fetch = async (url) => new Response(JSON.stringify(url.includes('/token') ? { access_token: 'x' } : { sub: 'g2', email: mail('unbestaetigt'), email_verified: false }));
  const go2 = await fetch(`${base}/auth/google`, { redirect: 'manual' });
  const st2 = new URL(go2.headers.get('location')).searchParams.get('state');
  const cb2 = await fetch(`${base}/auth/google/callback?code=c&state=${st2}`, { headers: { cookie: cookieOf(go2) }, redirect: 'manual' });
  assert.match(cb2.headers.get('location'), /fehler=google/);
});

test('Registrierung, Excel-Import mit Fotos, Freischaltung, Anzeige', async () => {
  const api = await login(mail('leitung'));
  const reg = await api('POST', '/portal/api/shelters', { name: 'Test-Tierheim Honig', postalCode: '04109', city: 'Leipzig', website: 'https://honig.example', location: { lat: 51.34, lng: 12.37 } });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.status, 'pending');
  const sid = reg.body.id;

  const xlsx = await sampleXlsx([
    { 0: 'H-1', 2: 'Honigbär', 33: 'honig-1.jpg, extra-fehlt.jpg' },
    { 0: 'H-2', 2: 'Fehlerhaft', 3: 'Drache', 11: 9 },
  ]);
  const form = new FormData();
  form.append('file', new Blob([xlsx]), 'tiere.xlsx');
  form.append('photos', new Blob([await jpeg()], { type: 'image/jpeg' }), 'Honig-1.JPG');
  form.append('photos', new Blob([await jpeg()], { type: 'image/jpeg' }), 'unbenutzt.jpg');
  const preview = await api('POST', `/portal/api/shelters/${sid}/imports`, form, { form: true });
  assert.equal(preview.status, 201, JSON.stringify(preview.body));
  assert.deepEqual(preview.body.summary, { create: 1, update: 0, skip: 1, photos: 2 });
  assert.deepEqual(preview.body.unusedPhotos, ['unbenutzt.jpg']);
  const [good, bad] = preview.body.rows;
  assert.deepEqual([good.photosFound, good.photosMissing], [['honig-1.jpg'], ['extra-fehlt.jpg']]);
  assert.ok(bad.errors.some((e) => e.startsWith('Tierart')) && bad.errors.some((e) => e.startsWith('Aktivität')));

  const commit = await api('POST', `/portal/api/shelters/${sid}/imports/${preview.body.id}/commit`);
  assert.deepEqual([commit.body.created, commit.body.skipped, commit.body.photos], [1, 1, 1]);
  assert.equal((await api('POST', `/portal/api/shelters/${sid}/imports/${preview.body.id}/commit`)).status, 404);

  const mine = await api('GET', `/portal/api/shelters/${sid}/animals`);
  const animal = mine.body.animals[0];
  assert.equal(animal.photos.length, 1);
  const img = await fetch(base + animal.photos[0].thumbUrl);
  assert.equal(img.headers.get('content-type'), 'image/webp');
  assert.deepEqual(await sharp(Buffer.from(await img.arrayBuffer())).metadata().then((m) => [m.width, m.height]), [480, 480]);

  // Noch nicht freigeschaltet → nicht öffentlich
  const near = '/v1/animals?lat=51.34&lng=12.37&radiusKm=5';
  assert.equal((await (await fetch(base + near)).json()).total, 0);
  assert.equal((await api('POST', `/portal/api/shelters/${sid}/api-key`)).status, 422);
  const approve = await fetch(`${base}/v1/admin/shelters/${sid}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': process.env.ADMIN_TOKEN }, body: JSON.stringify({ status: 'active' }) });
  assert.equal(approve.status, 200);
  const pub = await (await fetch(base + near)).json();
  assert.equal(pub.animals[0].name, 'Honigbär');
  assert.match(pub.animals[0].photos[0].url, /^\/media\/.+\.webp$/);

  // Erneuter Import: aktualisiert, Foto wird nicht doppelt angelegt
  const form2 = new FormData();
  form2.append('file', new Blob([await sampleXlsx([{ 0: 'H-1', 2: 'Honigbär II', 33: 'honig-1.jpg' }])]), 'tiere.xlsx');
  form2.append('photos', new Blob([await jpeg()], { type: 'image/jpeg' }), 'honig-1.jpg');
  const p2 = await api('POST', `/portal/api/shelters/${sid}/imports`, form2, { form: true });
  assert.equal(p2.body.summary.update, 1);
  const c2 = await api('POST', `/portal/api/shelters/${sid}/imports/${p2.body.id}/commit`);
  assert.deepEqual([c2.body.updated, c2.body.photos], [1, 0]);

  // Fotos einzeln: kein Bild → abgelehnt
  const bogus = new FormData();
  bogus.append('photos', new Blob(['kein bild']), 'x.jpg');
  assert.equal((await api('POST', `/portal/api/shelters/${sid}/animals/${animal.id}/photos`, bogus, { form: true })).status, 422);

  // Team: eingeladene Person sieht das Tierheim, Fremde nicht
  assert.equal((await api('POST', `/portal/api/shelters/${sid}/members`, { email: mail('kollegin') })).status, 201);
  const kollegin = await login(mail('kollegin'));
  assert.equal((await kollegin('GET', '/portal/api/me')).body.shelters[0].id, sid);
  assert.equal((await kollegin('POST', `/portal/api/shelters/${sid}/members`, { email: mail('x') })).status, 403, 'nur Admins laden ein');
  const fremd = await login(mail('fremd'));
  assert.equal((await fremd('GET', `/portal/api/shelters/${sid}/animals`)).status, 403);
  assert.equal((await fremd('DELETE', `/portal/api/shelters/${sid}/animals/${animal.id}`)).status, 403);
  assert.equal((await api('DELETE', `/portal/api/shelters/${sid}/members/${encodeURIComponent(mail('leitung'))}`)).status, 422, 'letzter Admin bleibt');

  const key = await api('POST', `/portal/api/shelters/${sid}/api-key`);
  assert.match(key.body.apiKey, /^pm_/);
});

test('Excel-Vorlage lässt sich herunterladen', async () => {
  const api = await login(mail('vorlage'));
  const res = await fetch(`${base}/portal/api/import-template.xlsx`, { headers: { cookie: (await api('GET', '/portal/api/me')).res.headers.get('x') ?? '' } });
  assert.equal(res.status, 401, 'nur angemeldet');
  const ok = await api('GET', '/portal/api/import-template.xlsx');
  assert.equal(ok.status, 200);
  assert.match(ok.res.headers.get('content-disposition'), /vorlage\.xlsx/);
});
