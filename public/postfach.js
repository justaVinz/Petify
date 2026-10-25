// Postfach für Anbieter: nur vorgeprüfte Anfragen, sortiert nach Passung; Kontaktdaten erst nach Zusage.
import { esc, call, errorHtml, showMsg, date, SPECIES } from '/common.js';

const TABS = [['sent', 'Neu'], ['accepted', 'Kennenlernen'], ['declined', 'Abgesagt'], ['waitlist', 'Warteliste']];
const DIMS = [['activity', 'Aktivität'], ['affection', 'Nähe'], ['patience', 'Geduld'], ['busyHome', 'Trubel'], ['routine', 'Struktur']];
const SPACE = { apartment: 'Wohnung', balcony: 'Wohnung mit Balkon', garden: 'Haus mit Garten' };
const TIME = { low: 'unter 4 Std. zu Hause', medium: '4–8 Std. zu Hause', high: 'fast immer zu Hause' };
const EXP = { beginner: 'erstes Tier', some: 'etwas Erfahrung', experienced: 'viel Erfahrung' };
const PETS = { dog: 'Hund', cat: 'Katze', smallAnimal: 'Kleintiere' };

export async function inbox(el, provider, { isAdmin }) {
  let status = 'sent';
  const load = async () => {
    el.innerHTML = '<p class="muted">Lade Anfragen …</p>';
    let data;
    try {
      data = await call('GET', `/portal/api/shelters/${provider.id}/requests?status=${status}`);
    } catch (err) {
      el.innerHTML = `<p class="msg bad">${errorHtml(err)}</p>`;
      return;
    }
    const n = (k) => data.counts[k] ?? 0;
    el.innerHTML = `<div class="panel">
      <h2>Vermittlungsanfragen</h2>
      <p class="muted">Hier landen nur Anfragen, die unsere Vorprüfung bestanden haben: Persönlichkeitstest gemacht, Lebensumstände passen, Passung ab 55 %. Pro Tier kommen höchstens ${provider.limits.perAnimal} Anfragen gleichzeitig, pro Tag höchstens ${provider.limits.daily}. Weitere warten auf der Warteliste und rücken nach, wenn ihr absagt. Unbeantwortete Anfragen verfallen nach 14 Tagen.</p>
      <div class="tabs small" role="tablist">${TABS.map(([k, l]) => `<button role="tab" data-status="${k}" aria-selected="${status === k}">${l} <span class="count">${n(k)}</span></button>`).join('')}</div>
      ${data.requests.length ? `<div class="req-list">${data.requests.map(card).join('')}</div>` : `<p class="muted">${status === 'sent' ? 'Keine neuen Anfragen.' : 'Nichts in dieser Ansicht.'}</p>`}
    </div>
    ${isAdmin ? `<form class="panel" id="limits" novalidate><h2>Anfragen begrenzen</h2>
      <p class="muted">So viele Anfragen bekommt ihr höchstens. Wenn ihr die Grenzen erhöht, rücken Anfragen von der Warteliste nach.</p>
      <div class="form-grid">
        <label class="field" for="l-per"><span>Gleichzeitig offen pro Tier</span><input id="l-per" inputmode="numeric" value="${provider.limits.perAnimal}"></label>
        <label class="field" for="l-day"><span>Neue Anfragen pro Tag</span><input id="l-day" inputmode="numeric" value="${provider.limits.daily}"></label>
      </div>
      <button class="btn" type="submit">Speichern</button><p class="msg" id="l-msg" hidden></p></form>` : ''}`;
  };

  const card = (q) => `<article class="req" data-id="${q.id}">
    <div class="req-head"><div><h3>${esc(q.applicant.name || 'Interessent*in')} → ${esc(q.animal.name)}</h3>
      <small class="muted">${esc(SPECIES[q.animal.species] ?? '')} · ${date(q.status === 'waitlist' ? q.createdAt : q.sentAt ?? q.createdAt)}</small></div>
      <div class="match"><b>${q.score}%</b><span>Passung</span></div></div>
    ${q.profile ? `<ul class="facts">
      <li>${esc(SPACE[q.profile.space])}</li><li>${esc(TIME[q.profile.timeAtHome])}</li><li>${esc(EXP[q.profile.experience])}</li>
      <li>${q.profile.children ? 'Kinder im Haushalt' : 'keine Kinder'}</li>
      ${q.profile.otherPets?.length ? `<li>lebt mit: ${q.profile.otherPets.map((p) => PETS[p]).join(', ')}</li>` : ''}
    </ul>
    <div class="mini-traits">${DIMS.map(([k, l]) => `<span>${l} <i style="--v:${Math.round(q.profile[k] * 100)}%"></i></span>`).join('')}</div>` : ''}
    ${q.message ? `<blockquote>${esc(q.message)}</blockquote>` : '<p class="muted">Steht auf der Warteliste – Inhalt seht ihr, sobald die Anfrage nachrückt.</p>'}
    ${q.screening?.caveats?.length ? `<p class="caveat">Zu beachten: ${q.screening.caveats.map(esc).join(' · ')}</p>` : ''}
    ${q.status === 'accepted' ? `<p class="msg ok">Kontakt: <a href="mailto:${esc(q.applicant.email)}">${esc(q.applicant.email)}</a>${q.note ? ` · eure Nachricht: ${esc(q.note)}` : ''}</p>` : ''}
    ${q.status === 'declined' && q.note ? `<p class="muted">Begründung: ${esc(q.note)}</p>` : ''}
    ${q.status === 'sent' ? `<label class="field"><span>Nachricht an die Person (optional, bei Absage empfohlen)</span><textarea rows="2" maxlength="1000" data-note></textarea></label>
      <div class="actions"><button class="btn primary" data-decide="accepted">Kennenlernen vorschlagen</button><button class="btn ghost" data-decide="declined">Absagen</button></div>` : ''}
    <p class="msg" data-msg hidden></p>
  </article>`;

  el.onclick = async (e) => {
    const t = e.target.closest('[data-status]');
    if (t) { status = t.dataset.status; return load(); }
    const d = e.target.closest('[data-decide]');
    if (!d) return;
    const req = d.closest('.req');
    d.disabled = true;
    try {
      await call('POST', `/portal/api/shelters/${provider.id}/requests/${req.dataset.id}/decision`, { decision: d.dataset.decide, note: req.querySelector('[data-note]').value });
      load();
    } catch (err) {
      showMsg(req.querySelector('[data-msg]'), 'bad', errorHtml(err));
      d.disabled = false;
    }
  };
  el.onsubmit = async (e) => {
    if (e.target.id !== 'limits') return;
    e.preventDefault();
    const msg = el.querySelector('#l-msg');
    try {
      const r = await call('PATCH', `/portal/api/shelters/${provider.id}/settings`, { perAnimalLimit: +el.querySelector('#l-per').value, dailyRequestLimit: +el.querySelector('#l-day').value });
      provider.limits = { perAnimal: r.perAnimalLimit, daily: r.dailyRequestLimit };
      showMsg(msg, 'ok', `Gespeichert.${r.promoted ? ` ${r.promoted} Anfragen sind von der Warteliste nachgerückt.` : ''}`);
      if (r.promoted) setTimeout(load, 1200);
    } catch (err) {
      showMsg(msg, 'bad', errorHtml(err));
    }
  };
  await load();
}
