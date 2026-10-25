// Vermittlungsanfragen mit Vorprüfung, damit Tierheime nicht mit unpassenden oder zu vielen Anfragen überlastet werden.
//
//   1. Vorprüfung: Persönlichkeitsprofil nötig; Ausschlussgründe (Garten, Allergie, Kinder …) und zu geringe
//      Passung führen zur automatischen Absage mit Begründung – der Anbieter sieht diese Anfragen nicht.
//   2. Limits je Person: offene Anfragen, Anfragen pro Woche, eine pro Tier.
//   3. Kapazität je Anbieter: pro Tier nur N Anfragen gleichzeitig, pro Tag höchstens M neue.
//      Darüber hinaus landet die Anfrage auf der Warteliste (sortiert nach Passung) und rückt automatisch nach.
//   4. Unbeantwortete Anfragen verfallen; dann rückt die Warteliste nach.
import { pool } from './db.js';
import { HttpError } from './auth.js';
import { matchAnimal } from './matching.js';
import { sendMail } from './accounts.js';

export const RULES = {
  minScore: 55,
  maxOpenPerUser: 3,
  maxPerWeek: 5,
  minMessage: 80,
  maxMessage: 2000,
  expireDays: 14,
};

const OPEN = ['waitlist', 'sent', 'accepted'];
const appUrl = () => (process.env.APP_URL ?? 'http://localhost:3200').replace(/\/$/, '');

async function notify(to, subject, text) {
  try {
    await sendMail({ to, subject, text });
  } catch (err) {
    console.error('Mailversand fehlgeschlagen:', err.message);
  }
}

export async function createRequest(user, animalId, { message, confirmations } = {}) {
  const { rows: [profileRow] } = await pool.query('SELECT profile FROM user_profiles WHERE user_id = $1', [user.id]);
  if (!profileRow) throw new HttpError(422, 'needs_profile', 'Bitte mach zuerst den Persönlichkeitstest – er ist die Grundlage jeder Anfrage.');
  const { rows: [animal] } = await pool.query(`SELECT a.*, s.kind, s.status AS shelter_status, s.per_animal_limit, s.daily_request_limit, s.name AS shelter_name, s.email AS shelter_email
    FROM animals a JOIN shelters s ON s.id = a.shelter_id WHERE a.id = $1`, [animalId]);
  if (!animal || animal.shelter_status !== 'active' || animal.review_status !== 'approved') throw new HttpError(404, 'not_found', 'Tier nicht gefunden.');
  if (animal.status !== 'available') throw new HttpError(422, 'not_available', 'Dieses Tier ist gerade nicht vermittelbar.');
  const { rows: [own] } = await pool.query('SELECT 1 FROM shelter_members WHERE shelter_id = $1 AND email = $2', [animal.shelter_id, user.email]);
  if (own) throw new HttpError(422, 'own_animal', 'Für eigene Tiere kannst du keine Anfrage stellen.');

  const text = String(message ?? '').trim();
  if (text.length < RULES.minMessage) throw new HttpError(422, 'message_too_short', `Erzähl dem Tierheim etwas mehr über dich und dein Zuhause (mindestens ${RULES.minMessage} Zeichen, bisher ${text.length}).`);
  if (text.length > RULES.maxMessage) throw new HttpError(422, 'message_too_long', `Bitte höchstens ${RULES.maxMessage} Zeichen.`);
  if (!confirmations?.serious || !confirmations?.contact) throw new HttpError(422, 'confirmations', 'Bitte bestätige, dass deine Anfrage ernst gemeint ist und du kontaktiert werden möchtest.');

  const { rows: [counts] } = await pool.query(`SELECT
      count(*) FILTER (WHERE status = ANY($2))::int AS open,
      count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS week,
      count(*) FILTER (WHERE animal_id = $3 AND status = ANY($2))::int AS same
    FROM adoption_requests WHERE user_id = $1`, [user.id, OPEN, animalId]);
  if (counts.same) throw new HttpError(409, 'duplicate', 'Für dieses Tier hast du schon eine offene Anfrage.');
  if (counts.open >= RULES.maxOpenPerUser) throw new HttpError(429, 'too_many_open', `Du hast schon ${RULES.maxOpenPerUser} offene Anfragen. Warte auf eine Antwort oder ziehe eine zurück.`);
  if (counts.week >= RULES.maxPerWeek) throw new HttpError(429, 'too_many_week', `Höchstens ${RULES.maxPerWeek} Anfragen pro Woche – so bleibt es für die Tierheime machbar.`);

  // Vorprüfung gegen das Tierprofil
  const m = matchAnimal(profileRow.profile, animal.data);
  const checks = [];
  let status;
  let note = null;
  if (m.excluded) {
    status = 'declined_auto';
    note = `Passt leider nicht zu deinen Lebensumständen: ${m.excluded.join(', ')}.`;
    checks.push({ check: 'lebensumstände', ok: false, details: m.excluded });
  } else if (m.score < RULES.minScore) {
    status = 'declined_auto';
    note = `Die Passung liegt bei ${m.score} % – ab ${RULES.minScore} % leiten wir Anfragen weiter. Schau dir Tiere mit höherer Passung an.`;
    checks.push({ check: 'passung', ok: false, score: m.score });
  } else {
    checks.push({ check: 'lebensumstände', ok: true }, { check: 'passung', ok: true, score: m.score });
    status = (await hasCapacity(animal)) ? 'sent' : 'waitlist';
    if (status === 'waitlist') note = 'Für dieses Tier liegen gerade viele Anfragen vor. Du stehst auf der Warteliste und rückst automatisch nach.';
  }

  const { rows: [req] } = await pool.query(`INSERT INTO adoption_requests (animal_id, shelter_id, user_id, status, message, profile, score, screening, note, sent_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $4 = 'sent' THEN now() END) RETURNING *`,
  [animalId, animal.shelter_id, user.id, status, text, profileRow.profile, m.score ?? 0, JSON.stringify({ checks, reasons: m.reasons ?? [], caveats: m.caveats ?? [] }), note]);
  if (status === 'sent') await notifyProvider(animal);
  return { ...req, position: status === 'waitlist' ? await waitlistPosition(req) : null };
}

async function hasCapacity(animal, client = pool) {
  const { rows: [c] } = await client.query(`SELECT
      count(*) FILTER (WHERE animal_id = $1 AND status = 'sent')::int AS animal_open,
      count(*) FILTER (WHERE sent_at > now() - interval '1 day')::int AS today
    FROM adoption_requests WHERE shelter_id = $2`, [animal.id, animal.shelter_id]);
  return c.animal_open < animal.per_animal_limit && c.today < animal.daily_request_limit;
}

async function notifyProvider(animal) {
  if (!animal.shelter_email) return;
  await notify(animal.shelter_email, `Neue Anfrage für ${animal.name}`,
    `Für ${animal.name} ist eine neue, vorgeprüfte Vermittlungsanfrage eingegangen.\n\nZum Postfach: ${appUrl()}/${animal.kind === 'private' ? 'konto' : 'verwaltung'}.html`);
}

export async function waitlistPosition(req) {
  const { rows: [{ n }] } = await pool.query(`SELECT count(*)::int AS n FROM adoption_requests
    WHERE animal_id = $1 AND status = 'waitlist' AND (score > $2 OR (score = $2 AND created_at < $3))`, [req.animal_id, req.score, req.created_at]);
  return n + 1;
}

// Rückt die besten Anfragen der Warteliste nach, solange Kapazität frei ist
export async function promote(animalId) {
  const { rows: [animal] } = await pool.query(`SELECT a.*, s.kind, s.per_animal_limit, s.daily_request_limit, s.email AS shelter_email
    FROM animals a JOIN shelters s ON s.id = a.shelter_id WHERE a.id = $1`, [animalId]);
  if (!animal || animal.status !== 'available') return 0;
  let moved = 0;
  while (await hasCapacity(animal)) {
    const { rows: [next] } = await pool.query(`UPDATE adoption_requests SET status = 'sent', sent_at = now(), note = NULL
      WHERE id = (SELECT id FROM adoption_requests WHERE animal_id = $1 AND status = 'waitlist' ORDER BY score DESC, created_at LIMIT 1)
      RETURNING user_id`, [animalId]);
    if (!next) break;
    moved++;
    const { rows: [u] } = await pool.query('SELECT email FROM users WHERE id = $1', [next.user_id]);
    if (u) await notify(u.email, `Deine Anfrage für ${animal.name} ist jetzt beim Anbieter`, `Du bist von der Warteliste nachgerückt. Status: ${appUrl()}/konto.html`);
  }
  if (moved) await notifyProvider(animal);
  return moved;
}

// Unbeantwortete Anfragen verfallen lassen; danach rückt die Warteliste nach
export async function expireStale() {
  const { rows } = await pool.query(`UPDATE adoption_requests SET status = 'expired', decided_at = now(),
    note = 'Der Anbieter hat innerhalb von ${RULES.expireDays} Tagen nicht geantwortet.'
    WHERE status = 'sent' AND sent_at < now() - interval '${RULES.expireDays} days' RETURNING animal_id`);
  for (const animalId of new Set(rows.map((r) => r.animal_id))) await promote(animalId);
  return rows.length;
}

export async function decide(shelterId, requestId, decision, note) {
  if (!['accepted', 'declined'].includes(decision)) throw new HttpError(422, 'invalid_decision', 'Entscheidung: accepted oder declined.');
  const { rows: [req] } = await pool.query(`UPDATE adoption_requests SET status = $3, decided_at = now(), note = $4
    WHERE id = $1 AND shelter_id = $2 AND status = 'sent' RETURNING *`, [requestId, shelterId, decision, note?.trim() || null]);
  if (!req) throw new HttpError(404, 'not_found', 'Anfrage nicht gefunden oder schon beantwortet.');
  const { rows: [info] } = await pool.query('SELECT u.email, a.name FROM users u, animals a WHERE u.id = $1 AND a.id = $2', [req.user_id, req.animal_id]);
  await notify(info.email, decision === 'accepted' ? `Gute Nachrichten zu ${info.name}` : `Antwort zu deiner Anfrage für ${info.name}`,
    decision === 'accepted'
      ? `Der Anbieter möchte dich kennenlernen und meldet sich bei dir.${req.note ? `\n\nNachricht: ${req.note}` : ''}`
      : `Diesmal hat es leider nicht gepasst.${req.note ? `\n\nBegründung: ${req.note}` : ''}\n\nWeitere passende Tiere: ${appUrl()}/`);
  if (decision === 'declined') await promote(req.animal_id);
  return req;
}

export async function withdraw(userId, requestId) {
  const { rows: [req] } = await pool.query(`UPDATE adoption_requests SET status = 'withdrawn', decided_at = now()
    WHERE id = $1 AND user_id = $2 AND status = ANY($3) RETURNING *`, [requestId, userId, OPEN]);
  if (!req) throw new HttpError(404, 'not_found', 'Anfrage nicht gefunden oder schon abgeschlossen.');
  await promote(req.animal_id);
  return req;
}
