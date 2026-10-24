// Passung zwischen einem Persönlichkeitsprofil und einem Tierprofil.
// Profilwerte liegen zwischen 0 und 1, Tierskalen zwischen 1 und 5.

const SPACE = { apartment: 0, balcony: 0.5, garden: 1 };
const TIME = { low: 0.2, medium: 0.6, high: 1 };
const EXPERIENCE = { beginner: 0, some: 0.5, experienced: 1 };
const NEED_EXPERIENCE = { beginner: 0.1, some: 0.5, experienced: 0.9 };
const PET_COMPAT = { dog: 'dogs', cat: 'cats', smallAnimal: 'smallAnimals' };
const scale = (v) => (v - 1) / 4;

export function matchAnimal(p, a) {
  const excluded = [];
  const space = SPACE[p.space], time = TIME[p.timeAtHome], exp = EXPERIENCE[p.experience];
  if (p.allergy && a.hasFur) excluded.push('hat Fell – im Haushalt gibt es eine Tierhaarallergie');
  if (SPACE[a.requirements.space] > space + 0.26) excluded.push(a.requirements.space === 'garden' ? 'braucht ein Haus mit Garten' : 'braucht mindestens einen Balkon');
  if (scale(a.requirements.timeNeed) > time + 0.3) excluded.push('braucht mehr Zeit mit seinen Menschen');
  if (p.children && a.compatibility.children === 'no') excluded.push('fühlt sich mit Kindern nicht wohl');
  for (const pet of p.otherPets ?? []) {
    if (a.compatibility[PET_COMPAT[pet]] === 'no') excluded.push(`verträgt sich nicht mit ${{ dog: 'Hunden', cat: 'Katzen', smallAnimal: 'Kleintieren' }[pet]}`);
  }
  if (excluded.length) return { excluded };

  const c = a.character;
  const t = { e: scale(c.activity), n: scale(c.affection), a: scale(c.anxiety), u: scale(c.noiseTolerance), r: scale(c.routineNeed), j: scale(c.playfulness) };
  const needExp = NEED_EXPERIENCE[a.requirements.experience];
  // [Gewicht, Passung 0–1, Grund bei guter Passung, Hinweis bei schlechter Passung]
  const parts = [
    [2, 1 - Math.abs(p.activity - t.e), 'Ihr habt ein ähnliches Energielevel.', t.e > p.activity ? 'Braucht mehr Bewegung, als du gewohnt bist.' : 'Ist ruhiger, als du es vielleicht magst.'],
    [1.5, 1 - Math.abs(p.affection - t.n), t.n > 0.6 ? 'Sucht genauso viel Nähe wie du.' : 'Mag Freiraum – das passt zu dir.', t.n > p.affection ? 'Fordert mehr Nähe, als du vielleicht geben willst.' : 'Ist weniger kuschelig, als du es dir wünschst.'],
    [1.2, t.a > p.patience ? 1 - (t.a - p.patience) : 1, t.a > 0.6 ? 'Braucht Geduld – und die bringst du mit.' : 'Unkompliziert im Umgang.', 'Braucht mehr Geduld, als du vielleicht hast.'],
    [1, p.busyHome > t.u ? 1 - (p.busyHome - t.u) : 1, t.u > 0.7 ? 'Bleibt auch bei Trubel entspannt.' : 'Passt in deinen ruhigen Alltag.', 'Bei dir ist es vielleicht zu lebhaft.'],
    [0.8, t.r > p.routine ? 1 - (t.r - p.routine) : 1, t.r > 0.6 ? 'Mag feste Abläufe – genau wie du.' : 'Kommt auch mit spontanen Tagen klar.', 'Braucht mehr feste Abläufe.'],
    [0.6, 1 - Math.abs(p.curiosity - t.j) * 0.6, t.j > 0.6 ? 'Ist verspielt und lernfreudig wie du neugierig.' : 'Ist schon gefestigt und weiß, was es will.', null],
    [1.5, needExp > exp ? 1 - (needExp - exp) * 1.2 : 1, needExp < 0.3 ? 'Auch für Einsteiger gut geeignet.' : 'Deine Erfahrung ist hier genau richtig.', 'Braucht erfahrene Menschen – lass dich vom Tierheim beraten.'],
  ];
  const total = parts.reduce((s, x) => s + x[0], 0);
  const score = parts.reduce((s, x) => s + x[0] * Math.max(0, x[1]), 0) / total;
  const reasons = [...parts].sort((x, y) => y[0] * y[1] - x[0] * x[1]).filter((x) => x[1] > 0.75).slice(0, 3).map((x) => x[2]);
  const caveats = parts.filter((x) => x[1] < 0.65 && x[3]).map((x) => x[3]).slice(0, 2);
  return { score: Math.round(40 + 60 * score), reasons, caveats };
}

export function haversineKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
