// Tierprofil anlegen oder bearbeiten: Grunddaten, Charakter per Fragebogen oder Handeinstufung, Verträglichkeit.
import { QUESTIONS, scoreQuestionnaire } from '/js/questionnaire.js';
import { esc, call, errorHtml, showMsg, SPECIES, STATUS, SEX } from '/common.js';

const SCALES = [
  ['activity', 'Aktivität', 'ruhig', 'sehr aktiv'],
  ['affection', 'Verschmust', 'eigenständig', 'sucht Nähe'],
  ['anxiety', 'Ängstlichkeit', 'gelassen', 'sehr ängstlich'],
  ['noiseTolerance', 'Verträgt Trubel', 'kaum', 'sehr gut'],
  ['routineNeed', 'Braucht feste Abläufe', 'kaum', 'sehr'],
  ['playfulness', 'Verspielt', 'kaum', 'sehr'],
];
const COMPAT = { yes: 'ja', no: 'nein', unknown: 'unbekannt' };
const SPACE = { apartment: 'Wohnung reicht', balcony: 'Balkon/Außenbereich', garden: 'Haus mit Garten' };
const EXPERIENCE = { beginner: 'auch für Anfänger', some: 'etwas Erfahrung', experienced: 'viel Erfahrung' };

const opts = (map, current) => Object.entries(map).map(([k, l]) => `<option value="${k}"${current === k ? ' selected' : ''}>${esc(l)}</option>`).join('');
const field = (id, label, input, hint = '') => `<label class="field" for="${id}"><span>${label}</span>${input}${hint ? `<small class="muted">${hint}</small>` : ''}</label>`;

export function animalForm(el, { provider, animal = null, onDone }) {
  const a = animal ?? {};
  const isPrivate = provider.kind === 'private';
  const prevAnswers = a.assessment?.method === 'questionnaire' ? a.assessment.answers ?? {} : {};
  let mode = a.character && a.assessment?.method !== 'questionnaire' ? 'manual' : 'questionnaire';
  const answers = { ...prevAnswers };
  const c = a.character ?? {};
  const r = a.requirements ?? {};
  const comp = a.compatibility ?? {};

  el.innerHTML = `<form class="panel animal-form" novalidate>
    <div class="form-head"><h2>${animal ? `${esc(a.name)} bearbeiten` : isPrivate ? 'Tier zur Vermittlung anbieten' : 'Tier eintragen'}</h2>
      <button type="button" class="btn ghost" data-cancel>Abbrechen</button></div>
    ${isPrivate ? `<p class="msg">Private Anzeigen prüfen wir vor der Veröffentlichung – meist innerhalb eines Tages. Nach jeder Änderung wird erneut geprüft. Deinen Namen und deine Adresse sieht niemand; Interessierte erfahren nur PLZ und Ort.</p>` : ''}

    <fieldset class="form-sec"><legend>Grunddaten</legend><div class="form-grid">
      ${field('f-name', 'Name *', `<input id="f-name" class="plain" maxlength="80" value="${esc(a.name)}">`)}
      ${field('f-species', 'Tierart *', `<select id="f-species">${opts(SPECIES, a.species ?? 'dog')}</select>`)}
      ${field('f-breed', 'Rasse oder Mix', `<input id="f-breed" class="plain" maxlength="120" value="${esc(a.breed)}">`)}
      ${field('f-sex', 'Geschlecht *', `<select id="f-sex">${opts(SEX, a.sex ?? 'unknown')}</select>`)}
      ${field('f-age', 'Alter in Jahren (geschätzt)', `<input id="f-age" inputmode="decimal" value="${esc(a.age?.estimatedYears ?? '')}">`)}
      ${field('f-neutered', 'Kastriert', `<select id="f-neutered">${opts({ '': 'unbekannt', yes: 'ja', no: 'nein' }, a.neutered === true ? 'yes' : a.neutered === false ? 'no' : '')}</select>`)}
      ${field('f-group', 'Anzahl Tiere (nur gemeinsam)', `<input id="f-group" inputmode="numeric" value="${esc(a.groupSize ?? 1)}">`)}
      ${field('f-status', 'Status', `<select id="f-status">${opts(STATUS, a.status ?? 'available')}</select>`)}
      ${isPrivate ? '' : `
      ${field('f-ext', 'Karteinummer *', `<input id="f-ext" class="plain" maxlength="64" value="${esc(a.externalId)}">`, 'Verbindet das Tier mit eurer Kartei und dem Excel-Import.')}
      ${field('f-intake', 'Im Tierheim seit', `<input id="f-intake" type="date" value="${esc(a.intakeDate)}">`)}
      ${field('f-url', 'Link zur Tierseite *', `<input id="f-url" type="url" class="plain" placeholder="https://" value="${esc(a.url?.includes('/tier.html?id=') ? '' : a.url)}">`)}`}
      ${field('f-fee', isPrivate ? 'Schutzgebühr in € (höchstens 300)' : 'Schutzgebühr in €', `<input id="f-fee" inputmode="decimal" value="${esc(a.adoptionFee?.amount ?? '')}">`)}
    </div></fieldset>

    <fieldset class="form-sec"><legend>Charakter und Anforderungen</legend>
      <div class="seg" role="radiogroup" aria-label="Wie einstufen?">
        <button type="button" role="radio" data-mode="questionnaire" aria-checked="${mode === 'questionnaire'}">Fragebogen <small>empfohlen</small></button>
        <button type="button" role="radio" data-mode="manual" aria-checked="${mode === 'manual'}">Selbst einstufen</button>
      </div>
      <div data-pane="questionnaire"${mode === 'questionnaire' ? '' : ' hidden'}>
        <p class="muted">Beschreibe, wie sich das Tier im Alltag verhält. Daraus berechnen wir die Werte für das Matching – so sind Profile verschiedener Anbieter vergleichbar.</p>
        ${QUESTIONS.map((q, qi) => `<div class="q-block" data-q="${q.id}"><p class="q-title"><span class="muted">${qi + 1}.</span> ${esc(q.text)}</p>
          <div class="q-opts" role="radiogroup">${q.options.map((o, i) => `<button type="button" role="radio" aria-checked="${answers[q.id] === i}" data-a="${i}">${esc(o)}</button>`).join('')}</div></div>`).join('')}
        <div class="scale-preview" data-preview></div>
      </div>
      <div data-pane="manual"${mode === 'manual' ? '' : ' hidden'}>
        <div class="range-list">${SCALES.map(([k, l, lo, hi]) => `<label class="range-row" for="s-${k}"><span>${l}</span>
          <input type="range" id="s-${k}" min="1" max="5" step="1" value="${c[k] ?? 3}"><small class="muted">${lo} – ${hi}</small></label>`).join('')}</div>
        <div class="form-grid">
          ${field('m-space', 'Wohnsituation mindestens', `<select id="m-space">${opts(SPACE, r.space ?? 'apartment')}</select>`)}
          ${field('m-exp', 'Erfahrung der Halter', `<select id="m-exp">${opts(EXPERIENCE, r.experience ?? 'beginner')}</select>`)}
          ${field('m-time', 'Zeitbedarf (1 wenig – 5 viel)', `<input id="m-time" inputmode="numeric" value="${esc(r.timeNeed ?? 3)}">`)}
          ${field('m-alone', 'Allein bleiben (Stunden)', `<input id="m-alone" inputmode="decimal" value="${esc(r.maxHoursAlone ?? '')}">`)}
        </div>
      </div>
    </fieldset>

    <fieldset class="form-sec"><legend>Verträglichkeit</legend><div class="form-grid">
      ${field('f-kids', 'Kinder', `<select id="f-kids">${opts({ ...COMPAT, from_age: 'ab einem Alter' }, comp.children ?? 'unknown')}</select>`)}
      ${field('f-kids-age', 'Kinder ab (Jahre)', `<input id="f-kids-age" inputmode="numeric" value="${esc(comp.childrenMinAge ?? '')}">`)}
      ${field('f-dogs', 'Hunde', `<select id="f-dogs">${opts(COMPAT, comp.dogs ?? 'unknown')}</select>`)}
      ${field('f-cats', 'Katzen', `<select id="f-cats">${opts(COMPAT, comp.cats ?? 'unknown')}</select>`)}
      ${field('f-small', 'Kleintiere', `<select id="f-small">${opts(COMPAT, comp.smallAnimals ?? 'unknown')}</select>`)}
      ${field('f-fur', 'Fell', `<select id="f-fur">${opts({ yes: 'hat Fell', no: 'kein Fell (Allergiker)' }, a.hasFur === false ? 'no' : 'yes')}</select>`)}
    </div></fieldset>

    <fieldset class="form-sec"><legend>Beschreibung</legend>
      ${field('f-desc', 'So ist das Tier *', `<textarea id="f-desc" rows="5" maxlength="3000">${esc(a.description)}</textarea>`, 'Mindestens 20 Zeichen. Was mag es, was nicht, wie ist der Alltag mit ihm?')}
      ${field('f-home', 'Wunsch-Zuhause', `<textarea id="f-home" rows="2" maxlength="1000">${esc(a.idealHome)}</textarea>`)}
      ${field('f-health', 'Gesundheit', `<textarea id="f-health" rows="2" maxlength="1000">${esc(a.health?.notes)}</textarea>`)}
      <div class="checks">
        <label><input type="checkbox" id="f-vacc"${a.health?.vaccinated ? ' checked' : ''}> geimpft</label>
        <label><input type="checkbox" id="f-chip"${a.health?.microchipped ? ' checked' : ''}> gechippt</label>
      </div>
    </fieldset>

    <p class="msg" data-msg hidden></p>
    <div class="actions"><button class="btn primary" type="submit">${animal ? 'Änderungen speichern' : isPrivate ? 'Zur Prüfung einreichen' : 'Tier speichern'}</button></div>
  </form>`;

  const form = el.querySelector('form');
  const $ = (id) => form.querySelector(`#${id}`);
  const msg = form.querySelector('[data-msg]');

  const preview = () => {
    const s = scoreQuestionnaire(answers);
    const done = QUESTIONS.length - s.missing.length;
    form.querySelector('[data-preview]').innerHTML = `<h3>Ergebnis ${done < QUESTIONS.length ? `<span class="muted">(${done} von ${QUESTIONS.length} beantwortet)</span>` : ''}</h3>
      <div class="scales">${SCALES.map(([k, l]) => `<div class="scale"><span>${l}</span><span class="pips">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= (s.character[k] ?? 0) ? 'on' : ''}"></i>`).join('')}</span></div>`).join('')}</div>
      <p class="muted">${s.requirements.space ? `${SPACE[s.requirements.space]} · ${EXPERIENCE[s.requirements.experience] ?? '–'} · allein ${s.requirements.maxHoursAlone ?? '–'} Std.` : 'Anforderungen folgen aus den letzten Fragen.'}</p>`;
  };
  preview();

  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-cancel]')) return onDone(null);
    const m = e.target.closest('[data-mode]');
    if (m) {
      mode = m.dataset.mode;
      form.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b === m)));
      form.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== mode; });
      return;
    }
    const opt = e.target.closest('[data-a]');
    if (opt) {
      const q = opt.closest('[data-q]');
      answers[q.dataset.q] = +opt.dataset.a;
      q.querySelectorAll('[data-a]').forEach((b) => b.setAttribute('aria-checked', String(b === opt)));
      preview();
    }
  });

  const num = (v) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')));
  const text = (id) => $(id).value.trim() || undefined;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const doc = {
      name: $('f-name').value.trim(), species: $('f-species').value, breed: text('f-breed'), sex: $('f-sex').value,
      status: $('f-status').value, hasFur: $('f-fur').value === 'yes', description: $('f-desc').value.trim(), idealHome: text('f-home'),
      compatibility: { children: $('f-kids').value, dogs: $('f-dogs').value, cats: $('f-cats').value, smallAnimals: $('f-small').value },
    };
    if ($('f-neutered').value) doc.neutered = $('f-neutered').value === 'yes';
    if (num($('f-age').value) !== undefined) doc.age = { estimatedYears: num($('f-age').value) };
    if (num($('f-group').value) !== undefined) doc.groupSize = num($('f-group').value);
    if (doc.compatibility.children === 'from_age' && num($('f-kids-age').value) !== undefined) doc.compatibility.childrenMinAge = num($('f-kids-age').value);
    if (num($('f-fee').value) !== undefined) doc.adoptionFee = { amount: num($('f-fee').value), currency: 'EUR' };
    const health = { notes: text('f-health'), vaccinated: $('f-vacc').checked || undefined, microchipped: $('f-chip').checked || undefined };
    if (Object.values(health).some((v) => v !== undefined)) doc.health = health;
    if (!isPrivate) Object.assign(doc, { externalId: $('f-ext').value.trim(), url: text('f-url'), intakeDate: text('f-intake') });
    else if (a.externalId) doc.externalId = a.externalId;
    // Extern verlinkte Fotos bleiben erhalten; hochgeladene Fotos hängen am Tier, nicht am Profil
    const external = (a.photos ?? []).filter((p) => !p.id);
    if (external.length) doc.photos = external;
    const today = new Date().toISOString().slice(0, 10);

    if (mode === 'questionnaire') {
      const s = scoreQuestionnaire(answers);
      if (!s.complete) {
        showMsg(msg, 'bad', `Bitte beantworte alle Fragen im Fragebogen (noch ${s.missing.length} offen).`);
        form.querySelector(`[data-q="${s.missing[0]}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      doc.assessment = { method: 'questionnaire', answers, assessedAt: today };
    } else {
      doc.character = Object.fromEntries(SCALES.map(([k]) => [k, +$(`s-${k}`).value]));
      doc.requirements = { space: $('m-space').value, experience: $('m-exp').value, timeNeed: num($('m-time').value) };
      if (num($('m-alone').value) !== undefined) doc.requirements.maxHoursAlone = num($('m-alone').value);
      doc.assessment = { method: 'manual', assessedAt: today };
    }
    for (const k of Object.keys(doc)) if (doc[k] === undefined) delete doc[k];

    const btn = e.submitter;
    btn.disabled = true;
    try {
      const base = `/portal/api/shelters/${provider.id}/animals`;
      const saved = animal ? await call('PUT', `${base}/${animal.id}`, doc) : await call('POST', base, doc);
      onDone(saved);
    } catch (err) {
      showMsg(msg, 'bad', errorHtml(err));
      msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
      btn.disabled = false;
    }
  });
}
