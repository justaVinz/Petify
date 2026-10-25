// Öffentliche Tierseite mit Charakterbogen und Vermittlungsanfrage (mit Vorprüfung).
import { esc, call, errorHtml, showMsg, loginForm, confirmLogin, storedProfile, SPECIES, EMOJI, SEX, REQUEST_STATUS } from '/common.js';

const app = document.getElementById('app');
const id = new URLSearchParams(location.search).get('id') ?? '';
const COMPAT = { yes: 'ja', no: 'nein', unknown: 'unbekannt' };
const SPACE = { apartment: 'Wohnung reicht', balcony: 'Balkon oder gesicherter Außenbereich', garden: 'Haus mit Garten oder Freigang' };
const EXP = { beginner: 'auch für Anfänger geeignet', some: 'etwas Erfahrung nötig', experienced: 'viel Erfahrung nötig' };
const pips = (v) => `<span class="pips" aria-label="${v} von 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= v ? 'on' : ''}"></i>`).join('')}</span>`;

async function start() {
  const notice = await confirmLogin();
  let a;
  try {
    const res = await fetch(`/v1/animals/${encodeURIComponent(id)}`);
    a = await res.json();
    if (!res.ok) throw new Error(a.error?.message ?? 'Tier nicht gefunden.');
  } catch (err) {
    app.innerHTML = `<section class="portal"><h1>Tier nicht gefunden</h1><p class="muted">${esc(err.message)} Vielleicht hat es schon ein Zuhause gefunden.</p><a class="btn primary" href="/">Zum Persönlichkeitstest</a></section>`;
    return;
  }
  document.title = `${a.name} · Pfotenmatch`;
  const comp = a.compatibility;
  const kids = comp.children === 'from_age' ? `ab ${comp.childrenMinAge} Jahren` : COMPAT[comp.children];
  const isPrivate = a.shelter.kind === 'private';
  app.innerHTML = `<article class="animal-page">
    ${a.photos.length ? `<div class="gallery${a.photos.length === 1 ? ' single' : ''}">${a.photos.map((p) => `<img src="${esc(p.url)}" alt="${esc(p.alt ?? a.name)}" loading="lazy">`).join('')}</div>` : ''}
    <div class="sheet-head"><span class="avatar" aria-hidden="true">${EMOJI[a.species] ?? '🐾'}</span>
      <div><h1>${esc(a.name)}</h1><small class="muted">${esc(SPECIES[a.species])}${a.breed ? ` · ${esc(a.breed)}` : ''} · ${esc(SEX[a.sex])}${a.age?.estimatedYears !== undefined ? ` · ca. ${a.age.estimatedYears} J.` : ''}${a.groupSize > 1 ? ` · ${a.groupSize} Tiere, nur zusammen` : ''}</small></div></div>
    <p class="msg">${isPrivate ? `<b>Private Abgabe</b> aus ${esc(a.shelter.postalCode)} ${esc(a.shelter.city)}. Von uns vor der Veröffentlichung geprüft.` : `<b>${esc(a.shelter.name)}</b>, ${esc(a.shelter.city)}${a.url && !a.url.includes('/tier.html') ? ` · <a href="${esc(a.url)}" target="_blank" rel="noopener">Tier auf der Tierheim-Seite</a>` : ''}`}${a.adoptionFee ? ` · Schutzgebühr ${esc(a.adoptionFee.amount)} €` : ''}</p>
    ${a.shelter.isExample ? '<div class="notice"><b>Beispieldaten</b>Dieses Tier ist ein Beispiel zum Testen.</div>' : ''}
    <div class="panel"><h2>Charakter</h2>
      <div class="scales">
        <div class="scale"><span>Aktivität</span>${pips(a.character.activity)}</div>
        <div class="scale"><span>Verschmust</span>${pips(a.character.affection)}</div>
        <div class="scale"><span>Braucht Geduld</span>${pips(a.character.anxiety)}</div>
        <div class="scale"><span>Verträgt Trubel</span>${pips(a.character.noiseTolerance)}</div>
        <div class="scale"><span>Braucht Routine</span>${pips(a.character.routineNeed)}</div>
        <div class="scale"><span>Verspielt</span>${pips(a.character.playfulness)}</div>
      </div>
      ${a.assessment?.method === 'questionnaire' ? '<p class="muted">Eingeschätzt mit dem Pfotenmatch-Verhaltensfragebogen.</p>' : ''}
      <p class="about">${esc(a.description)}</p>
      ${a.idealHome ? `<p class="about"><strong>Wunsch-Zuhause:</strong> ${esc(a.idealHome)}</p>` : ''}
      <dl class="form">
        <div><dt>Wohnen</dt><dd>${esc(SPACE[a.requirements.space])}</dd></div><div><dt>Erfahrung</dt><dd>${esc(EXP[a.requirements.experience])}</dd></div>
        <div><dt>Allein bleiben</dt><dd>${a.requirements.maxHoursAlone !== undefined && a.requirements.maxHoursAlone !== null ? `bis ${a.requirements.maxHoursAlone} Std.` : 'keine Angabe'}</dd></div><div><dt>Kinder</dt><dd>${esc(kids)}</dd></div>
        <div><dt>Hunde / Katzen</dt><dd>${esc(COMPAT[comp.dogs])} / ${esc(COMPAT[comp.cats])}</dd></div><div><dt>Kleintiere</dt><dd>${esc(COMPAT[comp.smallAnimals])}</dd></div>
      </dl>
      ${a.health?.notes ? `<p class="about"><strong>Gesundheit:</strong> ${esc(a.health.notes)}</p>` : ''}
    </div>
    <section class="panel" id="anfrage"><h2>Anfrage stellen</h2><div id="req"><p class="muted">Lade …</p></div></section>
  </article>`;
  if (a.status !== 'available') {
    document.getElementById('req').innerHTML = '<p class="muted">Dieses Tier ist gerade reserviert oder nicht vermittelbar.</p>';
    return;
  }
  renderRequest(a, notice);
  if (location.hash === '#anfrage') document.getElementById('anfrage').scrollIntoView();
}

async function renderRequest(a, notice) {
  const el = document.getElementById('req');
  let me;
  try {
    me = await call('GET', '/portal/api/me');
  } catch (err) {
    if (err.status !== 401) { el.innerHTML = `<p class="msg bad">${errorHtml(err)}</p>`; return; }
    const box = document.createElement('div');
    el.replaceChildren(box);
    await loginForm(box, {
      title: `Für ${a.name} anfragen`, next: `tier/${a.id}`, notice,
      intro: 'Melde dich an, damit der Anbieter dir antworten kann. Deine E-Mail-Adresse geben wir erst weiter, wenn er dich kennenlernen möchte.',
    });
    box.querySelector('h1').outerHTML = '';
    return;
  }
  // Ergebnis des Tests aus diesem Browser übernehmen
  let profile = me.profile;
  const local = storedProfile();
  if (local && (!profile || JSON.stringify(local) !== JSON.stringify(profile))) {
    profile = (await call('PUT', '/portal/api/me/profile', local).catch(() => null))?.profile ?? profile;
  }
  if (!profile) {
    el.innerHTML = `<p class="muted">Jede Anfrage beruht auf deinem Persönlichkeitstest – so bekommt ${esc(a.name)} nur Anfragen, die wirklich passen könnten.</p>
      <a class="btn primary" href="/">Persönlichkeitstest machen (3 Minuten)</a>`;
    return;
  }
  const r = me.rules;
  el.innerHTML = `<form id="req-form" novalidate class="panel" style="padding:0;border:0;background:none">
    <p class="muted">Vor dem Absenden prüfen wir automatisch, ob ${esc(a.name)} zu deinen Lebensumständen passt. Damit Tierheime nicht überlastet werden, kannst du höchstens ${r.maxOpenPerUser} offene Anfragen gleichzeitig und ${r.maxPerWeek} pro Woche stellen.</p>
    <label class="field" for="msg"><span>Erzähl etwas über dich, dein Zuhause und deinen Alltag</span>
      <textarea id="msg" rows="6" maxlength="${r.maxMessage}" placeholder="Wer lebt bei dir? Wie sieht ein normaler Tag aus? Warum ${esc(a.name)}?"></textarea></label>
    <span class="counter" id="count">0 / mind. ${r.minMessage} Zeichen</span>
    <div class="checks" style="display:grid;gap:4px">
      <label><input type="checkbox" id="c-serious"> Meine Anfrage ist ernst gemeint und alle im Haushalt sind einverstanden.</label>
      <label><input type="checkbox" id="c-contact"> Der Anbieter darf mich kontaktieren, wenn er mich kennenlernen möchte.</label>
    </div>
    <p class="msg" id="req-msg" hidden></p>
    <div class="actions"><button class="btn primary" type="submit">Anfrage prüfen und senden</button><a class="btn ghost" href="/konto.html">Meine Anfragen (${me.requests.open} offen)</a></div>
  </form>`;
  const msg = document.getElementById('req-msg');
  const text = document.getElementById('msg');
  text.addEventListener('input', () => {
    const n = text.value.trim().length;
    document.getElementById('count').textContent = n >= r.minMessage ? `${n} Zeichen` : `${n} / mind. ${r.minMessage} Zeichen`;
  });
  document.getElementById('req-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    try {
      const q = await call('POST', '/portal/api/requests', {
        animalId: a.id, message: text.value,
        confirmations: { serious: document.getElementById('c-serious').checked, contact: document.getElementById('c-contact').checked },
      });
      const body = {
        sent: `Deine Anfrage ist beim Anbieter (Passung ${q.score} %). Du bekommst eine E-Mail, sobald er antwortet – spätestens nach 14 Tagen.`,
        waitlist: `Für ${esc(a.name)} liegen gerade viele Anfragen vor. Du stehst auf Platz ${q.position} der Warteliste und rückst automatisch nach (Passung ${q.score} %).`,
        declined_auto: `Wir haben die Anfrage nicht weitergeleitet. ${esc(q.note)}`,
      }[q.status];
      el.innerHTML = `<p class="msg ${q.status === 'declined_auto' ? 'bad' : 'ok'}"><b>${REQUEST_STATUS[q.status]}:</b> ${body}</p>
        <div class="actions"><a class="btn primary" href="/konto.html">Meine Anfragen</a><a class="btn ghost" href="/">Weitere Tiere finden</a></div>`;
    } catch (err) {
      showMsg(msg, 'bad', errorHtml(err));
      btn.disabled = false;
    }
  });
}

start();
