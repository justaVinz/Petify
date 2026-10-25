// Moderation: neue Tierheime freischalten, private Anzeigen prüfen. Zugang über ADMIN_TOKEN.
import { esc, errorHtml, showMsg, date, SPECIES, EMOJI } from '/common.js';

const app = document.getElementById('app');
const KEY = 'petify-admin';
let token = (() => { try { return sessionStorage.getItem(KEY) ?? ''; } catch { return ''; } })();

async function api(method, path, body) {
  const res = await fetch(`/v1/admin${path}`, { method, headers: { 'X-Admin-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error?.message ?? `Fehler ${res.status}`), { status: res.status, details: data?.error?.details ?? [] });
  return data;
}

function renderLogin(notice) {
  app.innerHTML = `<section class="wrap portal"><h1>Moderation</h1>
    ${notice ? `<p class="msg bad">${esc(notice)}</p>` : ''}
    <form class="panel" id="tok" novalidate>
      <label class="field" for="t"><span>Admin-Token</span><input id="t" type="password" class="plain" autocomplete="off"></label>
      <button class="btn primary" type="submit">Weiter</button></form></section>`;
  document.getElementById('tok').addEventListener('submit', (e) => {
    e.preventDefault();
    token = document.getElementById('t').value.trim();
    try { sessionStorage.setItem(KEY, token); } catch { /* egal */ }
    render();
  });
}

async function render() {
  if (!token) return renderLogin();
  let shelters, animals;
  try {
    [{ shelters }, { animals }] = await Promise.all([api('GET', '/shelters?status=pending'), api('GET', '/animals?review=pending')]);
  } catch (err) {
    if (err.status === 401 || err.status === 403) { token = ''; return renderLogin('Token ungültig.'); }
    app.innerHTML = `<p class="msg bad">${errorHtml(err)}</p>`;
    return;
  }
  app.innerHTML = `<section class="portal">
    <div class="shelter-bar"><h1>Moderation</h1><button class="btn ghost" id="out">Token vergessen</button></div>
    <div class="panel"><h2>Neue Tierheime (${shelters.length})</h2>
      <p class="muted">Vor der Freischaltung prüfen: Gibt es das Tierheim, passt die Website, gehören die E-Mail-Adressen dazu?</p>
      ${shelters.length ? `<div class="req-list">${shelters.map((s) => `<article class="req" data-shelter="${s.id}">
        <div class="req-head"><div><h3>${esc(s.name)}</h3><small class="muted">${esc(s.postalCode)} ${esc(s.city)} · seit ${date(s.createdAt)}</small></div></div>
        <p class="muted">${s.website ? `<a href="${esc(s.website)}" target="_blank" rel="noopener">${esc(s.website)}</a> · ` : ''}Team: ${s.members.map(esc).join(', ')}</p>
        <div class="actions"><button class="btn primary" data-status="active">Freischalten</button><button class="btn ghost" data-status="suspended">Sperren</button></div>
        <p class="msg" data-msg hidden></p></article>`).join('')}</div>` : '<p class="muted">Nichts zu tun.</p>'}
    </div>
    <div class="panel"><h2>Private Anzeigen (${animals.length})</h2>
      <p class="muted">Prüfen: echtes Tier, kein Handel oder Zucht, keine Kontaktdaten im Text, Schutzgebühr angemessen, Beschreibung ehrlich.</p>
      ${animals.length ? `<div class="req-list">${animals.map((a) => `<article class="req" data-animal="${a.id}">
        <div class="req-head"><div><h3>${EMOJI[a.species] ?? ''} ${esc(a.name)}</h3><small class="muted">${esc(SPECIES[a.species])}${a.breed ? ` · ${esc(a.breed)}` : ''} · ${esc(a.shelter.postalCode)} ${esc(a.shelter.city)} · ${date(a.updatedAt)}</small></div></div>
        ${a.photos.length ? `<div class="photo-strip">${a.photos.map((p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.thumbUrl ?? p.url)}" alt=""></a>`).join('')}</div>` : ''}
        <blockquote>${esc(a.description)}${a.idealHome ? `\n\nWunsch-Zuhause: ${esc(a.idealHome)}` : ''}${a.health?.notes ? `\n\nGesundheit: ${esc(a.health.notes)}` : ''}</blockquote>
        <p class="muted">${a.adoptionFee ? `Schutzgebühr ${esc(a.adoptionFee.amount)} € · ` : ''}Einstufung: ${a.assessment?.method === 'questionnaire' ? 'Fragebogen' : 'selbst'}</p>
        <label class="field"><span>Begründung (bei Ablehnung Pflicht, geht an die Person)</span><textarea rows="2" data-note></textarea></label>
        <div class="actions"><button class="btn primary" data-review="approved">Freigeben</button><button class="btn ghost" data-review="rejected">Ablehnen</button></div>
        <p class="msg" data-msg hidden></p></article>`).join('')}</div>` : '<p class="muted">Nichts zu tun.</p>'}
    </div></section>`;
  document.getElementById('out').addEventListener('click', () => { token = ''; try { sessionStorage.removeItem(KEY); } catch { /* egal */ } renderLogin(); });
  app.onclick = async (e) => {
    const b = e.target.closest('[data-status], [data-review]');
    if (!b) return;
    const card = b.closest('.req');
    b.disabled = true;
    try {
      if (b.dataset.status) await api('POST', `/shelters/${card.dataset.shelter}/status`, { status: b.dataset.status });
      else await api('POST', `/animals/${card.dataset.animal}/review`, { status: b.dataset.review, note: card.querySelector('[data-note]').value });
      render();
    } catch (err) {
      showMsg(card.querySelector('[data-msg]'), 'bad', errorHtml(err));
      b.disabled = false;
    }
  };
}

render();
