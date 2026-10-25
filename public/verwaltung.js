// Verwaltungsbereich für Tierheime: Anmeldung, Registrierung, Tiere, Excel-Import, Team.
import { esc, call, errorHtml, loginForm, confirmLogin, logout as doLogout, SPECIES, EMOJI, STATUS } from '/common.js';
import { animalForm } from '/tierform.js';
import { inbox } from '/postfach.js';

const app = document.getElementById('app');

let me = null;
let shelter = null;
let tab = 'animals';

// --- Start: Anmelde-Link bestätigen, Fehler aus Weiterleitungen anzeigen ---
async function start() {
  const notice = await confirmLogin();
  try {
    me = await call('GET', '/portal/api/me');
  } catch (err) {
    if (err.status === 401) return renderLogin(notice);
    app.innerHTML = `<section class="portal"><p class="msg bad">${errorHtml(err)}</p></section>`;
    return;
  }
  shelter = me.shelters[0] ?? null;
  shelter ? renderDashboard() : renderRegister();
}

// --- Anmeldung ---
function renderLogin(notice) {
  return loginForm(app, {
    title: 'Anmelden für Tierheime', next: 'verwaltung', notice,
    intro: 'Tragt eure Tiere per Excel-Datei oder Formular ein, ladet Fotos hoch und beantwortet vorgeprüfte Anfragen. Ihr braucht kein Passwort: Wir schicken euch einen Anmelde-Link. <br>Du möchtest privat ein Tier abgeben oder adoptieren? <a href="/konto.html">Zum persönlichen Konto</a>.',
  });
}

// --- Tierheim registrieren ---
function renderRegister() {
  let coords = null;
  app.innerHTML = `<section class="wrap portal">
    <h1>Euer Tierheim eintragen</h1>
    <p class="muted">Angemeldet als ${esc(me.user.email)}. Nach dem Eintragen prüfen wir kurz, ob es euer Tierheim wirklich gibt. Bis dahin könnt ihr schon Tiere importieren – öffentlich sichtbar werden sie nach der Freischaltung.</p>
    <p class="msg">Du bist kein Tierheim, sondern möchtest privat ein Tier abgeben? Das geht in deinem <a href="/konto.html">persönlichen Konto</a>.</p>
    <form class="panel" id="reg" novalidate>
      <div class="form-grid">
        <label class="field" for="r-name"><span>Name des Tierheims *</span><input id="r-name" autocomplete="organization" style="letter-spacing:0;font-family:var(--body)"></label>
        <label class="field" for="r-street"><span>Straße und Hausnummer</span><input id="r-street" autocomplete="street-address" style="letter-spacing:0;font-family:var(--body)"></label>
        <label class="field" for="r-plz"><span>Postleitzahl *</span><input id="r-plz" inputmode="numeric" maxlength="5" autocomplete="postal-code"></label>
        <label class="field" for="r-city"><span>Ort *</span><input id="r-city" autocomplete="address-level2" style="letter-spacing:0;font-family:var(--body)"></label>
        <label class="field" for="r-web"><span>Website *</span><input id="r-web" type="url" placeholder="https://" style="letter-spacing:0;font-family:var(--body)"></label>
        <label class="field" for="r-phone"><span>Telefon</span><input id="r-phone" type="tel" autocomplete="tel"></label>
      </div>
      <button type="button" class="btn ghost" id="r-loc">Standort des Tierheims übernehmen (wenn ihr gerade dort seid)</button>
      <p class="muted" id="r-loc-msg">Mit Standort können Interessierte euch im Umkreis finden.</p>
      <p class="msg bad" id="r-err" hidden></p>
      <div class="actions"><button class="btn primary" type="submit">Tierheim eintragen</button><button type="button" class="btn ghost" id="logout">Abmelden</button></div>
    </form>
  </section>`;
  document.getElementById('logout').addEventListener('click', logout);
  document.getElementById('r-loc').addEventListener('click', () => {
    const msg = document.getElementById('r-loc-msg');
    if (!navigator.geolocation || !window.isSecureContext) { msg.textContent = 'Standort ist hier nicht verfügbar (nur über HTTPS).'; return; }
    msg.textContent = 'Standort wird ermittelt …';
    navigator.geolocation.getCurrentPosition((p) => { coords = { lat: p.coords.latitude, lng: p.coords.longitude }; msg.textContent = 'Standort übernommen.'; },
      () => { msg.textContent = 'Standort nicht freigegeben – kein Problem, er ist optional.'; }, { timeout: 10000 });
  });
  document.getElementById('reg').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (id) => document.getElementById(id).value.trim();
    try {
      shelter = await call('POST', '/portal/api/shelters', { name: v('r-name'), street: v('r-street'), postalCode: v('r-plz'), city: v('r-city'), website: v('r-web'), phone: v('r-phone'), ...(coords ? { location: coords } : {}) });
      me = await call('GET', '/portal/api/me');
      tab = 'import';
      renderDashboard();
    } catch (err) {
      const box = document.getElementById('r-err');
      box.innerHTML = errorHtml(err);
      box.hidden = false;
    }
  });
}

const logout = () => doLogout('/verwaltung.html');

// --- Übersicht ---
function renderDashboard() {
  const isAdmin = shelter.role === 'admin';
  app.innerHTML = `<section class="portal">
    <div class="shelter-bar">
      <div><h1>${esc(shelter.name)}</h1><p class="muted">${esc(shelter.postalCode)} ${esc(shelter.city)} · angemeldet als ${esc(me.user.email)}</p></div>
      <div class="actions">
        ${me.shelters.length > 1 ? `<select id="switch" aria-label="Tierheim wechseln">${me.shelters.map((s) => `<option value="${s.id}"${s.id === shelter.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}
        <span class="badge ${shelter.status}">${shelter.status === 'active' ? 'freigeschaltet' : shelter.status === 'pending' ? 'in Prüfung' : 'gesperrt'}</span>
        <button class="btn ghost" id="logout">Abmelden</button>
      </div>
    </div>
    ${shelter.status === 'pending' ? '<p class="msg bad">Euer Tierheim wird gerade geprüft. Ihr könnt schon Tiere importieren; öffentlich erscheinen sie nach der Freischaltung.</p>' : ''}
    <div class="tabs" role="tablist">
      ${[['animals', 'Tiere'], ['requests', `Anfragen${shelter.inbox ? ` <span class="count">${shelter.inbox}</span>` : ''}`], ['import', 'Excel-Import'], ['team', isAdmin ? 'Team & API' : 'Team']].map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}
    </div>
    <div id="tab"></div>
  </section>`;
  document.getElementById('logout').addEventListener('click', logout);
  document.getElementById('switch')?.addEventListener('change', (e) => { shelter = me.shelters.find((s) => s.id === e.target.value); renderDashboard(); });
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
  if (tab === 'import') return renderImport();
  if (tab === 'team') return renderTeam();
  if (tab === 'requests') return inbox(document.getElementById('tab'), shelter, { isAdmin: shelter.role === 'admin' });
  return renderAnimals();
}

// --- Tiere ---
async function renderAnimals() {
  const el = document.getElementById('tab');
  el.innerHTML = '<p class="muted">Lade Tiere …</p>';
  const { animals } = await call('GET', `/portal/api/shelters/${shelter.id}/animals`);
  const edit = (animal) => animalForm(el, { provider: shelter, animal, onDone: () => renderAnimals() });
  if (!animals.length) {
    el.innerHTML = `<div class="panel"><h2>Noch keine Tiere</h2><p class="muted">Viele Tiere auf einmal gehen am schnellsten per Excel. Einzelne Tiere tragt ihr direkt im Formular ein – mit Fragebogen zum Charakter.</p>
      <div class="actions"><button class="btn primary" id="go-import">Zum Excel-Import</button><button class="btn" id="new-animal">Einzelnes Tier eintragen</button></div></div>`;
    document.getElementById('go-import').addEventListener('click', () => { tab = 'import'; renderDashboard(); });
    document.getElementById('new-animal').addEventListener('click', () => edit(null));
    return;
  }
  el.innerHTML = `<div class="list-head"><p class="muted">${animals.length} Tiere · ${animals.filter((a) => a.status === 'available').length} vermittelbar</p><button class="btn primary" id="new-animal">Tier eintragen</button></div>
    <div class="animal-list">${animals.map((a) => `<article class="animal-row" data-id="${a.id}">
      ${a.photos[0]?.thumbUrl ? `<img class="thumb" src="${esc(a.photos[0].thumbUrl)}" alt="">` : `<span class="thumb" aria-hidden="true">${EMOJI[a.species] ?? '🐾'}</span>`}
      <div style="min-width:0">
        <h3>${esc(a.name)}</h3><small>${esc(SPECIES[a.species])} · Karteinr. ${esc(a.externalId)}${a.breed ? ` · ${esc(a.breed)}` : ''}</small>
        <div class="photo-strip">${a.photos.filter((p) => p.id).map((p) => `<figure><img src="${esc(p.thumbUrl)}" alt=""><button data-del-photo="${p.id}" aria-label="Foto löschen">×</button></figure>`).join('')}</div>
        <div class="row-actions">
          <select data-status aria-label="Status von ${esc(a.name)}">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${a.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
          <label class="btn file-label">Fotos hinzufügen<input type="file" accept="image/jpeg,image/png,image/webp" multiple data-photos></label>
          <button class="btn" data-edit>Bearbeiten</button>
          <a class="btn ghost" href="${esc(a.url)}" target="_blank" rel="noopener">Tierseite</a>
          <button class="btn ghost" data-delete>Löschen</button>
        </div>
        <p class="msg" data-msg hidden></p>
      </div></article>`).join('')}</div>`;
  el.onchange = async (e) => {
    const row = e.target.closest('.animal-row');
    if (!row) return;
    const msg = row.querySelector('[data-msg]');
    try {
      if (e.target.matches('[data-status]')) {
        await call('PATCH', `/portal/api/shelters/${shelter.id}/animals/${row.dataset.id}/status`, { status: e.target.value });
        msg.className = 'msg ok'; msg.textContent = `Status: ${STATUS[e.target.value]}`; msg.hidden = false;
      }
      if (e.target.matches('[data-photos]') && e.target.files.length) {
        const form = new FormData();
        [...e.target.files].forEach((f) => form.append('photos', f));
        msg.className = 'msg ok'; msg.textContent = 'Fotos werden hochgeladen …'; msg.hidden = false;
        await call('POST', `/portal/api/shelters/${shelter.id}/animals/${row.dataset.id}/photos`, form, { form: true });
        renderAnimals();
      }
    } catch (err) {
      msg.className = 'msg bad'; msg.innerHTML = errorHtml(err); msg.hidden = false;
    }
  };
  el.onclick = async (e) => {
    if (e.target.closest('#new-animal')) return edit(null);
    const row = e.target.closest('.animal-row');
    if (!row) return;
    if (e.target.closest('[data-edit]')) return edit(animals.find((a) => a.id === row.dataset.id));
    const del = e.target.closest('[data-delete]');
    const delPhoto = e.target.closest('[data-del-photo]');
    try {
      if (delPhoto) { await call('DELETE', `/portal/api/shelters/${shelter.id}/photos/${delPhoto.dataset.delPhoto}`); renderAnimals(); }
      if (del) {
        if (!del.classList.contains('confirm')) { del.classList.add('confirm'); del.textContent = 'Wirklich löschen?'; return; }
        await call('DELETE', `/portal/api/shelters/${shelter.id}/animals/${row.dataset.id}`);
        renderAnimals();
      }
    } catch (err) {
      const msg = row.querySelector('[data-msg]');
      msg.className = 'msg bad'; msg.innerHTML = errorHtml(err); msg.hidden = false;
    }
  };
}

// --- Excel-Import ---
function renderImport() {
  const el = document.getElementById('tab');
  let file = null;
  let photos = [];
  el.innerHTML = `<div class="panel">
    <h2>Tiere per Excel importieren</h2>
    <ol class="steps-import">
      <li><a href="/portal/api/import-template.xlsx">Vorlage herunterladen</a> – mit Auswahllisten und einem Blatt „Anleitung“.</li>
      <li>Ein Tier pro Zeile eintragen. Die Karteinummer verbindet die Zeile mit dem Tier: Beim nächsten Import werden bestehende Tiere aktualisiert.</li>
      <li>Datei und Fotos zusammen hochladen. In der Spalte „Fotos“ stehen die Dateinamen, z. B. <code>bruno-1.jpg</code>.</li>
    </ol>
    <div class="drop" id="drop">
      <strong>Excel-Datei und Fotos hierher ziehen</strong>
      <span class="muted">oder</span>
      <label class="btn file-label">Dateien auswählen<input type="file" id="files" multiple accept=".xlsx,image/jpeg,image/png,image/webp"></label>
      <span class="muted" id="chosen">Noch nichts ausgewählt</span>
    </div>
    <button class="btn primary" id="preview" disabled>Vorschau anzeigen</button>
    <div id="result"></div>
  </div>`;
  const drop = document.getElementById('drop');
  const take = (list) => {
    for (const f of list) {
      if (/\.xlsx$/i.test(f.name)) file = f;
      else if (/^image\//.test(f.type)) photos.push(f);
    }
    document.getElementById('chosen').textContent = `${file ? file.name : 'keine Excel-Datei'} · ${photos.length} Fotos`;
    document.getElementById('preview').disabled = !file;
  };
  document.getElementById('files').addEventListener('change', (e) => take(e.target.files));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); take(e.dataTransfer.files); });
  document.getElementById('preview').addEventListener('click', async (e) => {
    const out = document.getElementById('result');
    e.target.disabled = true;
    out.innerHTML = '<p class="muted">Datei wird geprüft …</p>';
    const form = new FormData();
    form.append('file', file);
    photos.forEach((p) => form.append('photos', p));
    try {
      showPreview(await call('POST', `/portal/api/shelters/${shelter.id}/imports`, form, { form: true }));
    } catch (err) {
      out.innerHTML = `<p class="msg bad">${errorHtml(err)}</p>`;
    }
    e.target.disabled = false;
  });

  function showPreview(p) {
    const out = document.getElementById('result');
    const usable = p.summary.create + p.summary.update;
    const ACTION = { create: 'neu', update: 'aktualisieren', skip: 'übersprungen' };
    out.innerHTML = `<h2>Vorschau: ${esc(p.filename)}</h2>
      <div class="summary"><span class="chip create">${p.summary.create} neu</span><span class="chip update">${p.summary.update} aktualisieren</span><span class="chip skip">${p.summary.skip} mit Fehlern</span><span class="chip">${p.summary.photos} Fotos</span></div>
      ${p.unusedPhotos.length ? `<p class="msg bad">Diese Fotos stehen in keiner Zeile: ${p.unusedPhotos.map(esc).join(', ')}</p>` : ''}
      <div class="table-wrap"><table class="preview-table"><thead><tr><th>Zeile</th><th>Karteinr.</th><th>Name</th><th>Aktion</th><th>Fotos</th><th>Hinweise</th></tr></thead><tbody>
      ${p.rows.map((r) => `<tr><td>${r.row}</td><td>${esc(r.externalId ?? '–')}</td><td>${esc(r.name ?? '–')}</td><td><span class="chip ${r.action}">${ACTION[r.action]}</span></td>
        <td>${r.photosFound.length}${r.photosMissing.length ? ` <span class="muted">(fehlt: ${r.photosMissing.map(esc).join(', ')})</span>` : ''}</td>
        <td>${r.errors.length ? `<ul>${r.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '✓'}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="actions">${usable ? `<button class="btn primary" id="commit">${usable} ${usable === 1 ? 'Tier' : 'Tiere'} übernehmen</button>` : ''}<button class="btn ghost" id="discard">Verwerfen</button></div>
      <p class="msg" id="commit-msg" hidden></p>`;
    document.getElementById('discard').addEventListener('click', async () => {
      await call('DELETE', `/portal/api/shelters/${shelter.id}/imports/${p.id}`).catch(() => {});
      renderImport();
    });
    document.getElementById('commit')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      const msg = document.getElementById('commit-msg');
      try {
        const r = await call('POST', `/portal/api/shelters/${shelter.id}/imports/${p.id}/commit`);
        msg.className = 'msg ok';
        msg.textContent = `Fertig: ${r.created} neu, ${r.updated} aktualisiert, ${r.photos} Fotos gespeichert${r.skipped ? `, ${r.skipped} Zeilen übersprungen` : ''}.${r.photoErrors.length ? ` Probleme mit Fotos: ${r.photoErrors.join('; ')}` : ''}`;
        msg.hidden = false;
        setTimeout(() => { tab = 'animals'; renderDashboard(); }, 1800);
      } catch (err) {
        msg.className = 'msg bad'; msg.innerHTML = errorHtml(err); msg.hidden = false;
        e.target.disabled = false;
      }
    });
  }
}

// --- Team & API ---
async function renderTeam() {
  const el = document.getElementById('tab');
  const isAdmin = shelter.role === 'admin';
  const { members } = await call('GET', `/portal/api/shelters/${shelter.id}/members`);
  el.innerHTML = `<div class="panel"><h2>Team</h2>
    <p class="muted">Alle hier eingetragenen Adressen können sich anmelden und Tiere pflegen. Admins dürfen zusätzlich Personen einladen.</p>
    <ul class="member-list">${members.map((m) => `<li><span><b>${esc(m.name || m.email)}</b>${m.name ? ` <span class="muted">${esc(m.email)}</span>` : ''}<br><span class="muted">${m.role === 'admin' ? 'Admin' : 'Mitglied'} · ${m.joined ? 'schon angemeldet' : 'noch nicht angemeldet'}</span></span>
      ${isAdmin && m.email !== me.user.email ? `<button class="btn ghost" data-remove="${esc(m.email)}">Entfernen</button>` : ''}</li>`).join('')}</ul>
    ${isAdmin ? `<form class="inline-form" id="invite" novalidate>
      <label class="field" for="i-email"><span>E-Mail-Adresse</span><input id="i-email" type="email" style="letter-spacing:0;font-family:var(--body)"></label>
      <label class="field" for="i-role" style="flex:0 1 160px"><span>Rolle</span><select id="i-role"><option value="member">Mitglied</option><option value="admin">Admin</option></select></label>
      <button class="btn primary" type="submit">Hinzufügen</button></form>
      <p class="muted">Die Person meldet sich einfach mit dieser Adresse an – per E-Mail-Link oder Google.</p>` : ''}
    <p class="msg" id="team-msg" hidden></p></div>
    ${isAdmin ? `<div class="panel"><h2>API-Schlüssel</h2>
      <p class="muted">Für die direkte Anbindung eurer Tierheim-Software. Die Schnittstelle ist in der <a href="/docs.html">API-Doku</a> beschrieben. Ein neuer Schlüssel ersetzt den alten.</p>
      <button class="btn" id="api-key" ${shelter.status !== 'active' ? 'disabled' : ''}>${shelter.hasApiKey ? 'Neuen Schlüssel erzeugen' : 'Schlüssel erzeugen'}</button>
      ${shelter.status !== 'active' ? '<p class="muted">Verfügbar nach der Freischaltung.</p>' : ''}<div id="key-out"></div></div>` : ''}`;
  const msg = document.getElementById('team-msg');
  document.getElementById('invite')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await call('POST', `/portal/api/shelters/${shelter.id}/members`, { email: document.getElementById('i-email').value, role: document.getElementById('i-role').value });
      renderTeam();
    } catch (err) { msg.className = 'msg bad'; msg.innerHTML = errorHtml(err); msg.hidden = false; }
  });
  el.onclick = async (e) => {
    const rm = e.target.closest('[data-remove]');
    try {
      if (rm) { await call('DELETE', `/portal/api/shelters/${shelter.id}/members/${encodeURIComponent(rm.dataset.remove)}`); renderTeam(); }
      if (e.target.id === 'api-key') {
        const { apiKey } = await call('POST', `/portal/api/shelters/${shelter.id}/api-key`);
        shelter.hasApiKey = true;
        document.getElementById('key-out').innerHTML = `<p class="muted">Wird nur jetzt angezeigt – bitte sicher speichern:</p><p class="key-box">${esc(apiKey)}</p>`;
      }
    } catch (err) { msg.className = 'msg bad'; msg.innerHTML = errorHtml(err); msg.hidden = false; }
  };
}

start();
