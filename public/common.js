// Gemeinsame Helfer für Verwaltung, Konto, Tierseite und Moderation
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const SPECIES = { dog: 'Hund', cat: 'Katze', rabbit: 'Kaninchen', guinea_pig: 'Meerschweinchen', rodent: 'Nagetier', bird: 'Vogel', reptile: 'Reptil', fish: 'Fisch', horse: 'Pferd', other: 'Sonstiges' };
export const EMOJI = { dog: '🐕', cat: '🐈', rabbit: '🐇', guinea_pig: '🐹', rodent: '🐀', bird: '🦜', reptile: '🐢', fish: '🐟', horse: '🐎', other: '🐾' };
export const STATUS = { available: 'vermittelbar', reserved: 'reserviert', adopted: 'vermittelt', not_available: 'nicht vermittelbar' };
export const SEX = { male: 'männlich', female: 'weiblich', mixed: 'gemischt', unknown: 'unbekannt' };
export const REQUEST_STATUS = {
  declined_auto: 'nicht weitergeleitet', waitlist: 'Warteliste', sent: 'beim Anbieter', accepted: 'Kennenlernen',
  declined: 'abgesagt', withdrawn: 'zurückgezogen', expired: 'verfallen', closed: 'geschlossen',
};
// Ergebnis des Persönlichkeitstests, vom Quiz im Browser abgelegt
export const PROFILE_STORE = 'petify-profile-v1';

export async function call(method, path, body, { form = false } = {}) {
  const headers = { 'x-petify': '1' };
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: form ? body : body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error?.message ?? `Fehler ${res.status}`);
    err.status = res.status;
    err.code = data?.error?.code;
    err.details = data?.error?.details ?? [];
    throw err;
  }
  return data;
}

export const errorHtml = (err) => `${esc(err.message)}${err.details?.length ? `<ul>${err.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}`;

export function showMsg(el, kind, html) {
  el.className = `msg ${kind}`;
  el.innerHTML = html;
  el.hidden = false;
}

export const storedProfile = () => { try { return JSON.parse(localStorage.getItem(PROFILE_STORE) || 'null'); } catch { return null; } };

export const date = (d) => (d ? new Date(d).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// Anmelde-Formular (E-Mail-Link oder Google); next bestimmt die Seite nach dem Login
export async function loginForm(el, { title, intro, next, notice }) {
  const config = await fetch('/auth/config').then((r) => r.json()).catch(() => ({ google: false }));
  el.innerHTML = `<section class="wrap portal">
    <h1>${esc(title)}</h1>
    <p class="muted">${intro}</p>
    ${notice ? `<p class="msg bad">${esc(notice)}</p>` : ''}
    <form class="panel" id="login" novalidate>
      <label class="field" for="email"><span>E-Mail-Adresse</span><input id="email" type="email" autocomplete="email" placeholder="du@beispiel.de" class="plain"></label>
      <button class="btn primary" type="submit">Anmelde-Link schicken</button>
      <p class="msg" id="login-msg" role="status" hidden></p>
      ${config.google ? `<div class="or"><span>oder</span></div>
      <a class="btn google-btn" href="/auth/google?next=${encodeURIComponent(next)}"><svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Mit Google anmelden</a>` : ''}
    </form>
  </section>`;
  el.querySelector('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = el.querySelector('#login-msg');
    const btn = e.submitter;
    btn.disabled = true;
    try {
      const res = await call('POST', '/auth/email/start', { email: el.querySelector('#email').value, next });
      showMsg(msg, 'ok', esc(res.message + (config.emailDelivery === 'console' ? ' (Entwicklungsmodus: Der Link steht im Server-Log.)' : '')));
    } catch (err) {
      showMsg(msg, 'bad', errorHtml(err));
    }
    btn.disabled = false;
  });
}

// Anmelde-Link aus der E-Mail bestätigen; liefert eine Fehlermeldung oder null
export async function confirmLogin() {
  const params = new URLSearchParams(location.search);
  let notice = null;
  if (params.has('anmelden')) {
    try {
      await call('POST', '/auth/email/confirm', { token: params.get('anmelden') });
    } catch (err) {
      notice = err.message;
    }
  }
  if (params.get('fehler') === 'google') notice = 'Die Anmeldung mit Google hat nicht geklappt. Bitte versuch es nochmal oder nutze deine E-Mail-Adresse.';
  for (const k of ['anmelden', 'fehler']) params.delete(k);
  history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash);
  return notice;
}

export async function logout(to) {
  await call('POST', '/auth/logout').catch(() => {});
  location.href = to;
}
