// Charakter-Fragebogen: beobachtbares Verhalten → Skalen des Tierprofils.
// Ohne Abhängigkeiten, damit Server und Browser (/js/questionnaire.js) dieselbe Datei nutzen.

export const QUESTIONS = [
  {
    id: 'energy', section: 'Charakter', target: 'activity',
    text: 'Wie viel Bewegung und Beschäftigung braucht das Tier am Tag?',
    options: ['Kaum – es döst die meiste Zeit', 'Kurze Runden oder etwas Spiel', 'Ein bis zwei Stunden Beschäftigung', 'Mehrere Stunden, sonst wird es unruhig', 'Sehr viel – Sport, Auslauf, Aufgaben'],
  },
  {
    id: 'contact', section: 'Charakter', target: 'affection',
    text: 'Was passiert, wenn sich eine vertraute Person zu ihm setzt?',
    options: ['Es geht weg', 'Es bleibt, möchte aber nicht berührt werden', 'Es lässt sich gern streicheln', 'Es kommt von sich aus näher', 'Es sucht Körperkontakt und fordert Streicheln ein'],
  },
  {
    id: 'strangers', section: 'Charakter', target: 'anxiety',
    text: 'Wie reagiert es auf fremde Menschen?',
    options: ['Neugierig und offen', 'Kurz zurückhaltend, dann offen', 'Braucht mehrere Begegnungen', 'Versteckt sich oder weicht aus', 'Starke Angst, auch Abwehr'],
  },
  {
    id: 'noises', section: 'Charakter', target: 'anxiety',
    text: 'Und auf plötzliche Geräusche, z. B. Türknallen oder Staubsauger?',
    options: ['Bleibt gelassen', 'Schaut kurz auf', 'Erschrickt, beruhigt sich schnell', 'Flüchtet und braucht lange', 'Gerät in Panik'],
  },
  {
    id: 'bustle', section: 'Charakter', target: 'noiseTolerance',
    text: 'Wie geht es mit Trubel um – Besuch, Kinder, Lärm?',
    options: ['Gestresst, zieht sich zurück', 'Toleriert es kurz', 'Kommt gut zurecht', 'Ist gern mittendrin', 'Genießt jede Gesellschaft'],
  },
  {
    id: 'change', section: 'Charakter', target: 'routineNeed',
    text: 'Wie reagiert es, wenn sich der Tagesablauf ändert?',
    options: ['Steckt es locker weg', 'Merkt es kaum', 'Braucht etwas Eingewöhnung', 'Wird unruhig', 'Gerät deutlich aus dem Gleichgewicht'],
  },
  {
    id: 'play', section: 'Charakter', target: 'playfulness',
    text: 'Wie verspielt und lernfreudig ist es?',
    options: ['Gar nicht', 'Selten', 'Ab und zu', 'Gern und oft', 'Ständig, will Neues lernen'],
  },
  {
    id: 'alone', section: 'Anforderungen', target: 'alone',
    text: 'Wie lange kann es allein bleiben?',
    options: ['Gar nicht bzw. übt noch', 'Bis 2 Stunden', 'Bis 4 Stunden', 'Bis 6 Stunden', 'Länger, kein Problem'],
  },
  {
    id: 'handling', section: 'Anforderungen', target: 'experience',
    text: 'Gibt es Verhalten, das Erfahrung erfordert?',
    options: ['Nein, es ist unkompliziert', 'Kleinere Baustellen, z. B. zieht an der Leine', 'Ja, z. B. verteidigt Futter, schnappt, starke Jagd- oder Trennungsprobleme'],
  },
  {
    id: 'space', section: 'Anforderungen', target: 'space',
    text: 'Welche Wohnsituation braucht es mindestens?',
    options: ['Eine Wohnung reicht', 'Balkon oder gesicherter Außenbereich', 'Haus mit Garten oder Freigang'],
  },
];

const ALONE = [{ timeNeed: 5, hours: 0 }, { timeNeed: 4, hours: 2 }, { timeNeed: 3, hours: 4 }, { timeNeed: 2, hours: 6 }, { timeNeed: 1, hours: 8 }];

// answers: { frageId: Index der gewählten Antwort (0-basiert) }
export function scoreQuestionnaire(answers = {}) {
  const missing = QUESTIONS.filter((q) => !Number.isInteger(answers[q.id]) || answers[q.id] < 0 || answers[q.id] >= q.options.length).map((q) => q.id);
  const pick = (id) => (missing.includes(id) ? null : answers[id]);
  const scale = (...ids) => {
    const vals = ids.map(pick).filter((v) => v !== null);
    return vals.length ? Math.round(vals.reduce((s, v) => s + v + 1, 0) / vals.length) : null;
  };
  const alone = pick('alone') !== null ? ALONE[pick('alone')] : null;
  return {
    complete: missing.length === 0,
    missing,
    character: {
      activity: scale('energy'),
      affection: scale('contact'),
      anxiety: scale('strangers', 'noises'),
      noiseTolerance: scale('bustle'),
      routineNeed: scale('change'),
      playfulness: scale('play'),
    },
    requirements: {
      timeNeed: alone?.timeNeed ?? null,
      maxHoursAlone: alone ? alone.hours : null,
      experience: pick('handling') !== null ? ['beginner', 'some', 'experienced'][pick('handling')] : null,
      space: pick('space') !== null ? ['apartment', 'balcony', 'garden'][pick('space')] : null,
    },
  };
}
