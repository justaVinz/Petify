// Persönliches Konto: eigene Anfragen, Persönlichkeitsprofil und private Tierabgabe.
import { esc, call, errorHtml, showMsg, loginForm, confirmLogin, logout, storedProfile, date, SPECIES, EMOJI, STATUS, REQUEST_STATUS } from '/common.js';
import { animalForm } from '/tierform.js';
import { inbox } from '/postfach.js';

const app = document.getElementById('app');
const REVIEW = { pending: 'in Prüfung', approved: 'öffentlich', rejected: 'abgelehnt' };
const DIMS = [['activity', 'Aktivität'], ['affection', 'Nähe'], ['patience', 'Geduld'], ['busyHome', 'Trubel'], ['routine', 'Struktur'], ['curiosity', 'Neugier']];
let me = null;
let tab = new URLSearchParams(location.search).get('tab') ?? 'requests';

async function start() {
  const notice = await confirmLogin();
  try {
    me = await call('GET', '/portal/api/me');
  } catch (err) {
    if (err.status === 401) {
      return loginForm(app, {
        title: 'Dein Pfotenmatch-Konto', next: 'konto', notice,
        intro: 'Mit deinem Konto stellst du Anfragen für Tiere, die zu dir passen, und siehst ihren Stand. Du kannst auch selbst ein Tier zur Vermittlung anbieten. Kein Passwort nötig: Wir schicken dir einen Anmelde-Link.',
      });
    }
    app.innerHTML = `<section class="portal"><p class="msg bad">${errorHtml(err)}</p></section>`;
    return;
  }
  // Testergebnis aus diesem Browser übernehmen
  const local = storedProfile();
  if (local && JSON.stringify(local) !== JSON.stringify(me.profile)) {
    me.profile = (await call('PUT', '/portal/api/me/profile', local).catch(() => null))?.profile ?? me.profile;
  }
  render();
}

function render() {
  const inboxCount = me.private?.inbox ?? 0;
  app.innerHTML = `<section class="portal">
    <div class="shelter-bar">
      <div><h1>Mein Konto</h1><p class="muted">${esc(me.user.name ? `${me.user.name} · ` : '')}${esc(me.user.email)}</p></div>
      <div class="actions">${me.shelters.length ? '<a class="btn ghost" href="/verwaltung.html">Tierheim-Verwaltung</a>' : ''}<button class="btn ghost" id="logout">Abmelden</button></div>
    </div>
    <div class="tabs" role="tablist">
      ${[['requests', `Meine Anfragen${me.requests.open ? ` <span class="count">${me.requests.open}</span>` : ''}`], ['profile', 'Mein Profil'], ['give', `Tier abgeben${inboxCount ? ` <span class="count">${inboxCount}</span>` : ''}`]]
        .map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}
    </div>
    <div id="tab"></div>
  </section>`;
  document.getElementById('logout').addEventListener('click', () => logout('/konto.html'));
  app.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    app.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    renderTab();
  });
  renderTab();
}

function renderTab() {
  const el = document.getElementById('tab');
  el.onclick = null;
  el.onchange = null;
  el.onsubmit = null;
  if (tab === 'profile') return renderProfile(el);
  if (tab === 'give') return renderGive(el);
  return renderRequests(el);
}

// --- Eigene Anfragen ---
async function renderRequests(el) {
  el.innerHTML = '<p class="muted">Lade Anfragen …</p>';
  const { requests } = await call('GET', '/portal/api/me/requests');
  if (!requests.length) {
    el.innerHTML = `<div class="panel"><h2>Noch keine Anfragen</h2>
      <p class="muted">${me.profile ? 'Schau dir die Tiere an, die zu deinem Profil passen, und stell eine Anfrage direkt auf der Tierseite.' : 'Mach zuerst den Persönlichkeitstest – danach siehst du passende Tiere und kannst anfragen.'}</p>
      <a class="btn primary" href="/">${me.profile ? 'Passende Tiere ansehen' : 'Zum Persönlichkeitstest'}</a></div>`;
    return;
  }
  const open = ['waitlist', 'sent', 'accepted'];
  el.innerHTML = `<p class="muted">Höchstens ${me.rules.maxOpenPerUser} offene Anfragen gleichzeitig, ${me.rules.maxPerWeek} pro Woche. Ziehst du eine Anfrage zurück, wird der Platz für andere frei.</p>
    <div class="req-list">${requests.map((q) => `<article class="req" data-id="${q.id}">
      <div class="req-head"><div><h3><a href="/tier.html?id=${q.animal.id}">${esc(q.animal.name)}</a></h3>
        <small class="muted">${esc(SPECIES[q.animal.species])} · ${esc(q.provider.name)} · ${date(q.createdAt)}</small></div>
        <span class="status-pill ${q.status}">${REQUEST_STATUS[q.status]}</span></div>
      <p class="muted">Passung ${q.score} %${q.status === 'waitlist' ? ` · Platz ${q.position} auf der Warteliste` : ''}${q.status === 'sent' ? ' · Antwort spätestens 14 Tage nach Eingang' : ''}</p>
      ${q.note ? `<p class="${q.status === 'declined_auto' ? 'caveat' : 'muted'}">${esc(q.note)}</p>` : ''}
      ${q.contact ? `<p class="msg ok">Der Anbieter möchte dich kennenlernen und meldet sich. Kontakt: <a href="mailto:${esc(q.contact.email)}">${esc(q.contact.email)}</a>${q.contact.phone ? ` · ${esc(q.contact.phone)}` : ''}</p>` : ''}
      ${open.includes(q.status) ? '<div class="actions"><button class="btn ghost" data-withdraw>Anfrage zurückziehen</button></div>' : ''}
      <p class="msg" data-msg hidden></p></article>`).join('')}</div>`;
  el.onclick = async (e) => {
    const w = e.target.closest('[data-withdraw]');
    if (!w) return;
    if (!w.classList.contains('confirm')) { w.classList.add('confirm'); w.textContent = 'Wirklich zurückziehen?'; return; }
    const card = w.closest('.req');
    try {
      await call('POST', `/portal/api/requests/${card.dataset.id}/withdraw`);
      me = await call('GET', '/portal/api/me');
      render();
    } catch (err) {
      showMsg(card.querySelector('[data-msg]'), 'bad', errorHtml(err));
    }
  };
}

// --- Profil ---
function renderProfile(el) {
  const p = me.profile;
  el.innerHTML = `<div class="panel"><h2>Dein Persönlichkeitsprofil</h2>
      ${p ? `<div class="profile" style="padding:0;border:0;background:none">${DIMS.map(([k, l]) => `<div class="trait-row"><span>${l}</span><span class="track"><i style="width:${Math.round(p[k] * 100)}%"></i></span><b>${Math.round(p[k] * 100)}</b></div>`).join('')}</div>
        <p class="muted">Jede Anfrage enthält dieses Profil. So sieht der Anbieter, wie du lebst – ohne dass du alles neu erzählen musst.</p>`
    : '<p class="muted">Noch kein Profil. Es entsteht aus dem Persönlichkeitstest und ist Voraussetzung für Anfragen.</p>'}
      <a class="btn ${p ? '' : 'primary'}" href="/">${p ? 'Test wiederholen' : 'Test machen'}</a></div>
    <form class="panel" id="name-form" novalidate><h2>Dein Name</h2>
      <p class="muted">Anbieter sehen bei einer Anfrage nur deinen Vornamen. Den vollen Namen und deine E-Mail-Adresse erst, wenn sie dich kennenlernen möchten.</p>
      <label class="field" for="n-name"><span>Name</span><input id="n-name" class="plain" maxlength="80" autocomplete="name" value="${esc(me.user.name)}"></label>
      <button class="btn" type="submit">Speichern</button><p class="msg" id="n-msg" hidden></p></form>`;
  el.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await call('PATCH', '/portal/api/me', { name: document.getElementById('n-name').value });
      me.user.name = r.name;
      showMsg(document.getElementById('n-msg'), 'ok', 'Gespeichert.');
    } catch (err) {
      showMsg(document.getElementById('n-msg'), 'bad', errorHtml(err));
    }
  };
}

// --- Private Tierabgabe ---
async function renderGive(el) {
  if (!me.private) return renderPrivateSetup(el);
  const provider = me.private;
  el.onsubmit = null;
  el.innerHTML = '<p class="muted">Lade …</p>';
  const { animals } = await call('GET', `/portal/api/shelters/${provider.id}/animals`);
  const edit = (animal) => animalForm(el, { provider, animal, onDone: () => renderGive(el) });
  const active = animals.filter((a) => a.status !== 'adopted').length;
  el.innerHTML = `<div class="panel">
      <div class="list-head"><h2>Deine Tiere</h2>${active < me.rules.privateListingLimit ? '<button class="btn primary" id="new-animal">Tier anbieten</button>' : ''}</div>
      <p class="muted">Privat kannst du bis zu ${me.rules.privateListingLimit} Tiere gleichzeitig anbieten. Wir prüfen jede Anzeige, bevor sie erscheint. Interessierte sehen nur ${esc(provider.postalCode)} ${esc(provider.city)}.</p>
      ${animals.length ? `<div class="animal-list">${animals.map((a) => `<article class="animal-row" data-id="${a.id}">
        ${a.photos[0]?.thumbUrl ? `<img class="thumb" src="${esc(a.photos[0].thumbUrl)}" alt="">` : `<span class="thumb" aria-hidden="true">${EMOJI[a.species] ?? '🐾'}</span>`}
        <div style="min-width:0">
          <h3>${esc(a.name)} <span class="badge ${a.review.status === 'approved' ? 'active' : a.review.status}">${REVIEW[a.review.status]}</span></h3>
          <small>${esc(SPECIES[a.species])}${a.breed ? ` · ${esc(a.breed)}` : ''}</small>
          ${a.review.status === 'rejected' && a.review.note ? `<p class="caveat">Grund: ${esc(a.review.note)}. Bearbeite die Anzeige, dann prüfen wir erneut.</p>` : ''}
          <div class="photo-strip">${a.photos.filter((p) => p.id).map((p) => `<figure><img src="${esc(p.thumbUrl)}" alt=""><button data-del-photo="${p.id}" aria-label="Foto löschen">×</button></figure>`).join('')}</div>
          <div class="row-actions">
            <select data-status aria-label="Status von ${esc(a.name)}">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${a.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
            <label class="btn file-label">Fotos<input type="file" accept="image/jpeg,image/png,image/webp" multiple data-photos></label>
            <button class="btn" data-edit>Bearbeiten</button>
            ${a.review.status === 'approved' ? `<a class="btn ghost" href="/tier.html?id=${a.id}">Ansehen</a>` : ''}
            <button class="btn ghost" data-delete>Löschen</button>
          </div>
          <p class="msg" data-msg hidden></p>
        </div></article>`).join('')}</div>` : '<p class="muted">Noch keine Tiere eingetragen.</p>'}
    </div>
    <div id="inbox"></div>`;
  inbox(document.getElementById('inbox'), provider, { isAdmin: true });
  el.onclick = async (e) => {
    if (e.target.closest('#new-animal')) return edit(null);
    const row = e.target.closest('.animal-row');
    if (!row) return;
    const msg = row.querySelector('[data-msg]');
    try {
      if (e.target.closest('[data-edit]')) return edit(animals.find((a) => a.id === row.dataset.id));
      const delPhoto = e.target.closest('[data-del-photo]');
      if (delPhoto) { await call('DELETE', `/portal/api/shelters/${provider.id}/photos/${delPhoto.dataset.delPhoto}`); return renderGive(el); }
      const del = e.target.closest('[data-delete]');
      if (del) {
        if (!del.classList.contains('confirm')) { del.classList.add('confirm'); del.textContent = 'Wirklich löschen?'; return; }
        await call('DELETE', `/portal/api/shelters/${provider.id}/animals/${row.dataset.id}`);
        renderGive(el);
      }
    } catch (err) {
      showMsg(msg, 'bad', errorHtml(err));
    }
  };
  el.onchange = async (e) => {
    const row = e.target.closest('.animal-row');
    if (!row) return;
    const msg = row.querySelector('[data-msg]');
    try {
      if (e.target.matches('[data-status]')) {
        await call('PATCH', `/portal/api/shelters/${provider.id}/animals/${row.dataset.id}/status`, { status: e.target.value });
        showMsg(msg, 'ok', `Status: ${STATUS[e.target.value]}${e.target.value !== 'available' ? '. Offene Anfragen wurden geschlossen.' : ''}`);
      }
      if (e.target.matches('[data-photos]') && e.target.files.length) {
        const form = new FormData();
        [...e.target.files].forEach((f) => form.append('photos', f));
        showMsg(msg, 'ok', 'Fotos werden hochgeladen …');
        await call('POST', `/portal/api/shelters/${provider.id}/animals/${row.dataset.id}/photos`, form, { form: true });
        renderGive(el);
      }
    } catch (err) {
      showMsg(msg, 'bad', errorHtml(err));
    }
  };
}

function renderPrivateSetup(el) {
  let coords = null;
  el.innerHTML = `<form class="panel" id="priv" novalidate>
    <h2>Ein Tier privat abgeben</h2>
    <p class="muted">Du kannst dein Tier nicht mehr behalten? Hier findest du Menschen, deren Persönlichkeit und Alltag zu ihm passen. Wir prüfen jede Anzeige, und Anfragen kommen nur vorgeprüft und in begrenzter Zahl bei dir an. Öffentlich sichtbar sind nur Postleitzahl und Ort.</p>
    <div class="form-grid">
      <label class="field" for="p-plz"><span>Postleitzahl *</span><input id="p-plz" inputmode="numeric" maxlength="5" autocomplete="postal-code"></label>
      <label class="field" for="p-city"><span>Ort *</span><input id="p-city" class="plain" autocomplete="address-level2"></label>
    </div>
    <button type="button" class="btn ghost" id="p-loc">Ungefähren Standort übernehmen</button>
    <p class="muted" id="p-loc-msg">Optional, auf ca. 1 km gerundet – damit Interessierte im Umkreis dich finden.</p>
    <div class="checks" style="display:grid;gap:4px">
      <label><input type="checkbox" id="p-owner"> Das Tier gehört mir bzw. ich darf es abgeben.</label>
      <label><input type="checkbox" id="p-noncom"> Ich vermittle nicht gewerblich und verkaufe keine Tiere aus Zucht.</label>
    </div>
    <p class="msg" id="p-err" hidden></p>
    <button class="btn primary" type="submit">Weiter zum Tierprofil</button>
  </form>`;
  el.onclick = (e) => {
    if (e.target.id !== 'p-loc') return;
    const msg = document.getElementById('p-loc-msg');
    if (!navigator.geolocation || !window.isSecureContext) { msg.textContent = 'Standort ist hier nicht verfügbar (nur über HTTPS).'; return; }
    msg.textContent = 'Standort wird ermittelt …';
    navigator.geolocation.getCurrentPosition((p) => { coords = { lat: p.coords.latitude, lng: p.coords.longitude }; msg.textContent = 'Ungefährer Standort übernommen.'; },
      () => { msg.textContent = 'Standort nicht freigegeben – kein Problem, er ist optional.'; }, { timeout: 10000 });
  };
  el.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await call('POST', '/portal/api/private', {
        postalCode: document.getElementById('p-plz').value.trim(), city: document.getElementById('p-city').value.trim(), ...(coords ? { location: coords } : {}),
        confirmations: { owner: document.getElementById('p-owner').checked, nonCommercial: document.getElementById('p-noncom').checked },
      });
      me = await call('GET', '/portal/api/me');
      el.onclick = el.onsubmit = null;
      animalForm(el, { provider: me.private, onDone: () => renderGive(el) });
    } catch (err) {
      showMsg(document.getElementById('p-err'), 'bad', errorHtml(err));
    }
  };
}

start();
