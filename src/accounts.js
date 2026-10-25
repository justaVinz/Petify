// Login für Tierheime und Privatpersonen: Anmelde-Link per E-Mail oder Google (OpenID Connect mit PKCE).
// Sitzungen liegen als Hash in der Datenbank, der Browser bekommt nur ein HttpOnly-Cookie.
import express from 'express';
import { randomBytes, createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
import { pool } from './db.js';
import { HttpError } from './auth.js';

const SESSION_COOKIE = 'pm_session';
const OAUTH_COOKIE = 'pm_oauth';
const SESSION_DAYS = 30;
const LINK_MINUTES = 15;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const appUrl = () => (process.env.APP_URL ?? 'http://localhost:3200').replace(/\/$/, '');
const secure = () => appUrl().startsWith('https://');
export const normalizeEmail = (e) => String(e ?? '').trim().toLowerCase();
// Nach der Anmeldung zurück zur passenden Seite: Verwaltung (Tierheime), Konto oder Tierseite (Privatpersonen)
const nextPage = (v) => (/^(verwaltung|konto|tier\/[0-9a-f-]{36})$/i.test(v ?? '') ? v : 'verwaltung');
const pageUrl = (next, query = '') => {
  const [page, id] = next.split('/');
  const params = new URLSearchParams(id ? { id } : {});
  if (query) for (const [k, v] of new URLSearchParams(query)) params.set(k, v);
  return `/${page}.html${params.toString() ? `?${params}` : ''}`;
};
export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;

// Austauschbar für Tests (Google-Endpunkte, Mailversand)
export const deps = {
  fetch: (...args) => fetch(...args),
  sendMail: null,
};

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name, value, maxAgeSeconds) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure() ? '; Secure' : ''}`;
}

// --- einfacher Schutz gegen massenhaftes Anfordern von Login-Links ---
const attempts = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const list = (attempts.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  attempts.set(key, list);
  return list.length > max;
}

// Versand per SMTP; ohne SMTP_URL (Entwicklung) nur ins Server-Log
export async function sendMail({ to, subject, text, link }) {
  if (deps.sendMail) return deps.sendMail({ to, subject, text, link });
  if (!process.env.SMTP_URL) {
    console.log(link ? `[Login-Link für ${to}] ${link}` : `[Mail an ${to}] ${subject}\n${text}`);
    return;
  }
  const transport = nodemailer.createTransport(process.env.SMTP_URL);
  await transport.sendMail({ from: process.env.MAIL_FROM ?? 'Petify <login@petify.example>', to, subject, text });
}

function sendLoginMail(email, link) {
  const text = `Hallo,\n\nmit diesem Link meldest du dich bei Petify an:\n${link}\n\nDer Link ist ${LINK_MINUTES} Minuten gültig und funktioniert nur einmal.\nWenn du das nicht angefordert hast, kannst du diese E-Mail ignorieren.`;
  return sendMail({ to: email, subject: 'Dein Anmelde-Link für Petify', text, link });
}

async function startSession(res, userId) {
  const id = token();
  await pool.query(`INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [sha256(id), userId]);
  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
  res.append('Set-Cookie', cookie(SESSION_COOKIE, id, SESSION_DAYS * 86400));
}

async function upsertUser({ email, name = null, googleSub = null }) {
  const { rows: [user] } = await pool.query(`INSERT INTO users (email, name, google_sub) VALUES ($1, $2, $3)
    ON CONFLICT (email) DO UPDATE SET name = coalesce(users.name, EXCLUDED.name), google_sub = coalesce(users.google_sub, EXCLUDED.google_sub)
    RETURNING *`, [email, name, googleSub]);
  return user;
}

// Hängt req.user an, wenn eine gültige Sitzung besteht
export async function loadUser(req, _res, next) {
  try {
    const sid = parseCookies(req.get('cookie'))[SESSION_COOKIE];
    if (sid) {
      const { rows: [user] } = await pool.query(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id_hash = $1 AND s.expires_at > now()`, [sha256(sid)]);
      req.user = user ?? null;
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'login_required', 'Bitte melde dich an.'));
  // CSRF-Schutz: schreibende Anfragen müssen von unserer eigenen Seite kommen
  if (!['GET', 'HEAD'].includes(req.method) && req.get('x-petify') !== '1') {
    return next(new HttpError(403, 'csrf', 'Anfrage nicht erlaubt.'));
  }
  next();
}

export function authRouter() {
  const r = express.Router();

  r.get('/config', (_req, res) => res.json({
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    emailDelivery: process.env.SMTP_URL ? 'smtp' : 'console',
  }));

  // 1. Anmelde-Link anfordern
  r.post('/email/start', async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body?.email);
      if (!isEmail(email)) throw new HttpError(422, 'invalid_email', 'Bitte gib eine gültige E-Mail-Adresse ein.');
      if (limited(`mail:${email}`, 5, 15 * 60e3) || limited(`ip:${req.ip}`, 20, 15 * 60e3)) {
        throw new HttpError(429, 'too_many_requests', 'Zu viele Anfragen. Bitte warte ein paar Minuten.');
      }
      const t = token();
      await pool.query(`INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ($1, $2, now() + interval '${LINK_MINUTES} minutes')`, [sha256(t), email]);
      const link = `${appUrl()}/auth/email/verify?token=${t}&next=${encodeURIComponent(nextPage(req.body?.next))}`;
      await sendLoginMail(email, link);
      res.json({ ok: true, message: `Wir haben dir einen Anmelde-Link an ${email} geschickt. Er ist ${LINK_MINUTES} Minuten gültig.` });
    } catch (err) {
      next(err);
    }
  });

  // 2. Link aus der E-Mail öffnen. Der Link selbst verbraucht nichts – E-Mail-Scanner öffnen Links
  //    oft automatisch. Erst die Seite bestätigt die Anmeldung per POST.
  r.get('/email/verify', (req, res) => {
    res.redirect(pageUrl(nextPage(req.query.next), `anmelden=${encodeURIComponent(String(req.query.token ?? ''))}`));
  });

  r.post('/email/confirm', async (req, res, next) => {
    try {
      if (req.get('x-petify') !== '1') throw new HttpError(403, 'csrf', 'Anfrage nicht erlaubt.');
      const t = String(req.body?.token ?? '');
      const { rows: [row] } = await pool.query(`UPDATE login_tokens SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING email`, [sha256(t)]);
      if (!row) throw new HttpError(410, 'link_expired', 'Der Anmelde-Link ist abgelaufen oder wurde schon benutzt. Fordere einfach einen neuen an.');
      const user = await upsertUser({ email: row.email });
      await startSession(res, user.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Google: Weiterleitung zum Google-Login
  r.get('/google', (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID) return next(new HttpError(503, 'google_disabled', 'Google-Login ist nicht eingerichtet.'));
    const state = token(), verifier = token(), nonce = token();
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    res.append('Set-Cookie', cookie(OAUTH_COOKIE, JSON.stringify({ state, verifier, nonce, next: nextPage(req.query.next) }), 600));
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: `${appUrl()}/auth/google/callback`, response_type: 'code',
      scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  // Google: Rückkehr mit Code → Token tauschen → verifizierte E-Mail abfragen
  r.get('/google/callback', async (req, res, next) => {
    try {
      let saved = null;
      try { saved = JSON.parse(parseCookies(req.get('cookie'))[OAUTH_COOKIE] ?? 'null'); } catch { /* ungültig */ }
      res.append('Set-Cookie', cookie(OAUTH_COOKIE, '', 0));
      const page = nextPage(saved?.next);
      if (!saved || req.query.state !== saved.state || !req.query.code) return res.redirect(pageUrl(page, 'fehler=google'));
      const tokenRes = await deps.fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(req.query.code), client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: `${appUrl()}/auth/google/callback`, grant_type: 'authorization_code', code_verifier: saved.verifier,
        }),
      });
      if (!tokenRes.ok) return res.redirect(pageUrl(page, 'fehler=google'));
      const { access_token: accessToken } = await tokenRes.json();
      const infoRes = await deps.fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
      const info = infoRes.ok ? await infoRes.json() : null;
      if (!info?.sub || !info.email || info.email_verified !== true) return res.redirect(pageUrl(page, 'fehler=google'));
      const user = await upsertUser({ email: normalizeEmail(info.email), name: info.name ?? null, googleSub: info.sub });
      await startSession(res, user.id);
      res.redirect(pageUrl(page));
    } catch (err) {
      next(err);
    }
  });

  r.post('/logout', async (req, res, next) => {
    try {
      const sid = parseCookies(req.get('cookie'))[SESSION_COOKIE];
      if (sid) await pool.query('DELETE FROM sessions WHERE id_hash = $1', [sha256(sid)]);
      res.append('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return r;
}
