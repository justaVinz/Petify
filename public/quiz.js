// Persönlichkeitstest – fragt am Ende /v1/match nach passenden Tieren in der Umgebung.
const LIKERT = ['Stimmt gar nicht', 'Stimmt eher nicht', 'Teils, teils', 'Stimmt eher', 'Stimmt genau'];
const QUESTIONS = [
  { id: 'outdoor', kind: 'Persönlichkeit', text: 'Am Wochenende bin ich am liebsten draußen unterwegs.', dim: 'activity' },
  { id: 'rest', kind: 'Persönlichkeit', text: 'Nach einem langen Tag brauche ich vor allem Ruhe.', dim: 'activity', reverse: true },
  { id: 'cuddle', kind: 'Persönlichkeit', text: 'Körperliche Nähe und Kuscheln sind mir wichtig.', dim: 'affection' },
  { id: 'independent', kind: 'Persönlichkeit', text: 'Ich mag es, wenn jemand auch mal sein eigenes Ding macht.', dim: 'affection', reverse: true },
  { id: 'patience', kind: 'Persönlichkeit', text: 'Ich bleibe geduldig, wenn etwas nicht sofort klappt.', dim: 'patience' },
  { id: 'busy', kind: 'Persönlichkeit', text: 'Bei mir zu Hause ist oft Trubel – Besuch, Kinder, Musik.', dim: 'busyHome' },
  { id: 'routine', kind: 'Persönlichkeit', text: 'Ich plane gern und halte feste Routinen ein.', dim: 'routine' },
  { id: 'challenge', kind: 'Persönlichkeit', text: 'Neue Herausforderungen reizen mich mehr als Bewährtes.', dim: 'curiosity' },
  { id: 'space', kind: 'Lebensumstände', text: 'Wie wohnst du?', options: [['Wohnung ohne Balkon', '', 'apartment'], ['Wohnung mit Balkon', '', 'balcony'], ['Haus mit Garten', 'oder Wohnung mit gesichertem Garten', 'garden']] },
  { id: 'timeAtHome', kind: 'Lebensumstände', text: 'Wie viel Zeit ist an einem normalen Tag jemand zu Hause?', options: [['Weniger als 4 Stunden', 'ich pendle oder bin viel unterwegs', 'low'], ['4 bis 8 Stunden', '', 'medium'], ['Fast den ganzen Tag', 'Homeoffice, Rente, Familie', 'high']] },
  { id: 'experience', kind: 'Lebensumstände', text: 'Wie viel Erfahrung hast du mit Haustieren?', options: [['Noch keine', 'es wäre mein erstes Tier', 'beginner'], ['Etwas', 'in der Familie oder bei Freunden', 'some'], ['Viel', 'eigene Tiere, auch schwierige', 'experienced']] },
  { id: 'household', kind: 'Lebensumstände', text: 'Wer lebt sonst noch bei dir?', options: [['Niemand weiteres', '', 'none'], ['Kinder', '', 'kids'], ['Ein Hund', '', 'dog'], ['Eine Katze', '', 'cat'], ['Kleintiere', 'z. B. Kaninchen oder Vögel', 'small'], ['Kinder und Haustiere', '', 'both']] },
  { id: 'allergy', kind: 'Lebensumstände', text: 'Hat jemand im Haushalt eine Tierhaarallergie?', options: [['Nein', '', false], ['Ja', 'dann kommen nur Tiere ohne Fell infrage', true]] },
];
const DIMS = [['activity', 'Aktivität'], ['affection', 'Nähe'], ['patience', 'Geduld'], ['busyHome', 'Trubel'], ['routine', 'Struktur'], ['curiosity', 'Neugier']];

const SPECIES = { dog: ['Hund', '🐕'], cat: ['Katze', '🐈'], rabbit: ['Kaninchen', '🐇'], guinea_pig: ['Meerschweinchen', '🐹'], rodent: ['Nagetier', '🐀'], bird: ['Vogel', '🦜'], reptile: ['Reptil', '🐢'], fish: ['Fisch', '🐟'], horse: ['Pferd', '🐎'], other: ['Tier', '🐾'] };
const SEX = { male: 'männlich', female: 'weiblich', mixed: 'gemischt', unknown: 'unbekannt' };
const COMPAT = { yes: 'ja', no: 'nein', unknown: 'unbekannt' };

const STORE = 'pfotenmatch-app-v1';
const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; } };
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* privater Modus */ } };
let state = load() || { step: 'intro', plz: '', radius: 25, coords: null, answers: {}, index: 0 };
const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function profile(a) {
  const p = {};
  for (const [key] of DIMS) {
    const vals = QUESTIONS.filter((q) => q.dim === key).map((q) => (q.reverse ? 1 - a[q.id] / 4 : a[q.id] / 4));
    p[key] = vals.reduce((s, v) => s + v, 0) / vals.length;
  }
  const hh = a.household;
  return {
    ...p, space: a.space, timeAtHome: a.timeAtHome, experience: a.experience, allergy: a.allergy,
    children: hh === 'kids' || hh === 'both',
    otherPets: { dog: ['dog'], cat: ['cat'], small: ['smallAnimal'], both: ['dog', 'cat'] }[hh] ?? [],
  };
}

function render() {
  save();
  if (state.step === 'intro') return renderIntro();
  if (state.step === 'quiz') return renderQuiz();
  return renderResult();
}

function renderIntro() {
  app.innerHTML = `<section class="wrap intro">
    <h1>Welches Tier aus dem Tierheim <em>passt zu dir?</em></h1>
    <p>Beantworte 13 kurze Fragen zu deiner Persönlichkeit und deinem Alltag. Am Ende bekommst du Tiere aus Tierheimen in deiner Nähe, die zu dir passen – mit Charakterbogen und Link zur Vermittlungsseite.</p>
    <form class="place" id="place" novalidate>
      <div class="place-row">
        <label class="field" for="plz"><span>Postleitzahl</span><input id="plz" inputmode="numeric" autocomplete="postal-code" maxlength="5" placeholder="z. B. 10115" value="${esc(state.plz)}"></label>
        <label class="field" for="radius"><span>Umkreis</span><select id="radius">${[10, 25, 50, 100].map((r) => `<option value="${r}"${+state.radius === r ? ' selected' : ''}>${r} km</option>`).join('')}</select></label>
      </div>
      <button type="button" class="btn ghost locate" id="locate">${state.coords ? 'Standort übernommen ✓' : 'Stattdessen meinen Standort verwenden'}</button>
      <p class="err" id="plz-err" role="alert"></p>
      <button class="btn primary" type="submit">${Object.keys(state.answers).length ? 'Test fortsetzen' : 'Test starten'}</button>
    </form>
  </section>`;
  document.getElementById('locate').addEventListener('click', () => {
    const err = document.getElementById('plz-err');
    if (!navigator.geolocation) { err.textContent = 'Dein Browser kann den Standort nicht ermitteln. Bitte Postleitzahl eingeben.'; return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      state.coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      render();
    }, () => { err.textContent = 'Standort nicht freigegeben. Bitte Postleitzahl eingeben.'; }, { timeout: 8000 });
  });
  document.getElementById('place').addEventListener('submit', (e) => {
    e.preventDefault();
    const plz = document.getElementById('plz').value.trim();
    if (!state.coords && !/^\d{5}$/.test(plz)) { document.getElementById('plz-err').textContent = 'Bitte gib eine fünfstellige Postleitzahl ein oder nutze deinen Standort.'; return; }
    Object.assign(state, { plz, radius: +document.getElementById('radius').value, step: 'quiz', index: Math.min(state.index, QUESTIONS.length - 1) });
    render();
  });
}

function renderQuiz() {
  const q = QUESTIONS[state.index];
  const answered = QUESTIONS.filter((x) => state.answers[x.id] !== undefined).length;
  const current = state.answers[q.id];
  const opts = q.options ? q.options.map(([label, sub, value]) => ({ label, sub, value })) : LIKERT.map((label, value) => ({ label, sub: '', value }));
  app.innerHTML = `<section class="wrap quiz">
    <div class="progress"><div class="progress-head"><span>Frage ${state.index + 1} von ${QUESTIONS.length}</span><span>${answered} beantwortet</span></div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${QUESTIONS.length}" aria-valuenow="${answered}"><i style="width:${(answered / QUESTIONS.length) * 100}%"></i></div></div>
    <div class="question"><span class="q-kind">${q.kind}</span><h2 id="q-text">${esc(q.text)}</h2></div>
    <div class="options" role="radiogroup" aria-labelledby="q-text">
      ${opts.map((o, i) => `<button class="opt" role="radio" aria-checked="${current === o.value}" data-i="${i}"><span class="dot"></span><span>${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span></button>`).join('')}
    </div>
    <div class="nav"><button class="btn ghost" id="back">${state.index === 0 ? 'Ort ändern' : 'Zurück'}</button>
      <button class="btn primary" id="next" ${current === undefined ? 'disabled' : ''}>${state.index === QUESTIONS.length - 1 ? 'Ergebnis anzeigen' : 'Weiter'}</button></div>
  </section>`;
  const go = () => {
    const missing = QUESTIONS.findIndex((x) => state.answers[x.id] === undefined);
    if (state.index < QUESTIONS.length - 1) state.index++;
    else if (missing === -1) { state.step = 'result'; window.scrollTo(0, 0); }
    else state.index = missing;
    render();
  };
  app.querySelector('.options').addEventListener('click', (e) => {
    const b = e.target.closest('.opt');
    if (!b) return;
    state.answers[q.id] = opts[+b.dataset.i].value;
    app.querySelectorAll('.opt').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    document.getElementById('next').disabled = false;
    save();
    setTimeout(go, 220);
  });
  document.getElementById('next').addEventListener('click', go);
  document.getElementById('back').addEventListener('click', () => { if (state.index === 0) state.step = 'intro'; else state.index--; render(); });
}

const pips = (v) => `<span class="pips" aria-label="${v} von 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= v ? 'on' : ''}"></i>`).join('')}</span>`;
const ageText = (age) => {
  if (!age) return 'unbekannt';
  if (age.estimatedYears !== undefined) return `ca. ${age.estimatedYears} ${age.estimatedYears === 1 ? 'Jahr' : 'Jahre'}`;
  const [y, m = 1] = age.birthDate.split('-').map(Number);
  const months = (new Date().getFullYear() - y) * 12 + (new Date().getMonth() + 1 - m);
  return months < 24 ? `${months} Monate` : `${Math.floor(months / 12)} Jahre`;
};
const monthYear = (d) => (d ? new Date(d).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) : 'unbekannt');

// Tier-Typ aus dem besten Treffer: Wesenszug + Tierart
function typeOf(a) {
  const c = a.character;
  const trait = c.anxiety >= 4 ? 'sanfte, scheue' : c.activity >= 4 ? 'unternehmungslustige' : c.affection >= 4 ? 'verschmuste' : c.activity <= 2 ? 'gemütliche' : 'ausgeglichene';
  if (a.groupSize > 1) return `die ${trait} ${SPECIES[a.species][0]}-Gruppe`;
  const article = { dog: 'der', bird: 'der', fish: 'der', cat: 'die' }[a.species] ?? 'das';
  return `${article} ${trait} ${SPECIES[a.species][0]}`;
}

async function renderResult() {
  app.innerHTML = '<section class="wrap loading" aria-busy="true">Suche passende Tiere …</section>';
  const p = profile(state.answers);
  const location = state.coords ? { ...state.coords, radiusKm: state.radius } : { postalCode: state.plz, radiusKm: state.radius };
  let data;
  try {
    const res = await fetch('/v1/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location, profile: p, limit: 3 }) });
    data = await res.json();
    if (!res.ok) throw new Error(data.error?.message ?? `Fehler ${res.status}`);
  } catch (err) {
    app.innerHTML = `<section class="wrap result"><div class="notice"><b>Fehler</b>Die Suche hat nicht geklappt: ${esc(err.message)}</div><button class="btn" id="retry">Nochmal versuchen</button></section>`;
    document.getElementById('retry').addEventListener('click', render);
    return;
  }
  const best = data.matches[0]?.animal;
  const where = state.coords ? 'deinem Standort' : `PLZ ${state.plz}`;
  const osm = `https://www.openstreetmap.org/search?query=${encodeURIComponent(`Tierheim ${state.plz || ''}`.trim())}`;
  const anyExample = data.matches.some((m) => m.animal.shelter.isExample);

  const sheet = ({ score, reasons, caveats, animal: x }, i) => {
    const [label, emoji] = SPECIES[x.species] ?? SPECIES.other;
    const comp = x.compatibility;
    const kids = comp.children === 'from_age' ? `ab ${comp.childrenMinAge} Jahren` : COMPAT[comp.children];
    const others = `Hunde ${COMPAT[comp.dogs]}, Katzen ${COMPAT[comp.cats]}, Kleintiere ${COMPAT[comp.smallAnimals]}`;
    const alone = x.requirements.maxHoursAlone !== undefined && x.requirements.maxHoursAlone !== null ? `bis ${x.requirements.maxHoursAlone} Stunden` : 'keine Angabe';
    return `<article class="sheet${i === 0 ? ' first' : ''}">
      ${i === 0 ? '<span class="stamp">Bestes Match</span>' : ''}
      <div class="sheet-head"><span class="avatar" aria-hidden="true">${emoji}</span>
        <div><h3>${esc(x.name)}</h3><small>${esc(label)}${x.breed ? ` · ${esc(x.breed)}` : ''}${x.groupSize > 1 ? ` · ${x.groupSize} Tiere, nur zusammen` : ''}</small></div>
        <div class="match" aria-label="${score} Prozent Passung"><b>${score}%</b><span>Passung</span></div></div>
      <dl class="form">
        <div><dt>Alter</dt><dd>${esc(ageText(x.age))}</dd></div><div><dt>Geschlecht</dt><dd>${esc(SEX[x.sex])}${x.neutered ? ', kastriert' : ''}</dd></div>
        <div><dt>Im Tierheim seit</dt><dd>${esc(monthYear(x.intakeDate))}</dd></div><div><dt>Allein bleiben</dt><dd>${esc(alone)}</dd></div>
        <div><dt>Kinder</dt><dd>${esc(kids)}</dd></div><div><dt>Andere Tiere</dt><dd>${esc(others)}</dd></div>
      </dl>
      <div class="scales">
        <div class="scale"><span>Aktivität</span>${pips(x.character.activity)}</div>
        <div class="scale"><span>Verschmust</span>${pips(x.character.affection)}</div>
        <div class="scale"><span>Braucht Geduld</span>${pips(x.character.anxiety)}</div>
        <div class="scale"><span>Verträgt Trubel</span>${pips(x.character.noiseTolerance)}</div>
      </div>
      <p class="about">${esc(x.description)}${x.idealHome ? ` <strong>Wunsch-Zuhause:</strong> ${esc(x.idealHome)}` : ''}</p>
      <div class="why"><h4>Warum ${esc(x.name)} zu dir passt</h4><ul>${reasons.map((r) => `<li>${esc(r)}</li>`).join('')}${caveats.map((c) => `<li class="caveat">Achtung: ${esc(c)}</li>`).join('')}</ul></div>
      <div class="sheet-foot"><span class="shelter"><b>${esc(x.shelter.name)}</b> · ${x.distanceKm !== null ? `${String(x.distanceKm).replace('.', ',')} km` : esc(x.shelter.city)}</span>
        <a class="btn primary" href="${esc(x.url)}" target="_blank" rel="noopener">Zum Tier auf der Tierheim-Seite</a></div>
    </article>`;
  };

  app.innerHTML = `<section class="wide result">
    <div class="result-top">
      <div class="headline"><span class="eyebrow">Dein Ergebnis · ${esc(where)} · ${state.radius} km</span>
        <h1>${best ? `Dein Tier-Typ: ${esc(typeOf(best))}` : 'Gerade kein passendes Tier in deiner Nähe'}</h1>
        <p>${best ? `${data.considered} vermittelbare Tiere in deiner Umgebung, ${data.fitting} davon passen zu deinen Lebensumständen.` : 'Vergrößere den Umkreis oder sprich direkt mit einem Tierheim – oft kommen neue Tiere dazu.'}</p></div>
      <div class="profile"><h2>Dein Persönlichkeitsprofil</h2>
        ${DIMS.map(([k, l]) => `<div class="trait-row"><span>${l}</span><span class="track"><i style="width:${Math.round(p[k] * 100)}%"></i></span><b>${Math.round(p[k] * 100)}</b></div>`).join('')}</div>
    </div>
    ${anyExample ? '<div class="notice"><b>Beispieldaten</b>Die gezeigten Tierheime und Tiere sind Beispiele zum Testen. Echte Tierheime tragen ihre Tiere über die API ein.</div>' : ''}
    <div class="sheets">${data.matches.map(sheet).join('')}</div>
    ${data.excluded.length ? `<details class="excluded"><summary>${data.excluded.length} Tiere passen gerade nicht zu deinen Lebensumständen</summary><ul>${data.excluded.map((x) => `<li><b>${esc(x.name)}</b>: ${esc(x.reasons.join(', '))}</li>`).join('')}</ul></details>` : ''}
    <div class="nearby"><h2>Weitere Tierheime in deiner Nähe</h2>
      <p>Nicht jedes Tierheim ist schon angebunden. Auf der Karte findest du alle Tierheime in deiner Umgebung.</p>
      <div class="actions"><a class="btn" href="${osm}" target="_blank" rel="noopener">Tierheime auf der Karte</a><button class="btn ghost" id="restart">Test neu starten</button></div></div>
  </section>`;
  document.getElementById('restart').addEventListener('click', () => {
    state = { step: 'intro', plz: state.plz, radius: state.radius, coords: state.coords, answers: {}, index: 0 };
    render();
    window.scrollTo(0, 0);
  });
}

render();
