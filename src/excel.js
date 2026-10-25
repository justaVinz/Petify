// Excel-Vorlage erzeugen und ausgefüllte Tabellen ins einheitliche Tierprofil übersetzen.
import ExcelJS from 'exceljs';
import { validateAnimal } from './validate.js';

const YES_NO = { ja: true, nein: false };
const YES_NO_UNKNOWN = { ja: 'yes', nein: 'no', unbekannt: 'unknown' };

// Spalten der Vorlage: Überschrift, Feldpfad im Tierprofil, Typ, erlaubte Werte, Erklärung
export const COLUMNS = [
  { header: 'Karteinummer', path: 'externalId', type: 'text', required: true, width: 16, hint: 'Eure eigene Nummer für das Tier. Über sie werden Tiere beim nächsten Import aktualisiert.' },
  { header: 'Status', path: 'status', type: 'enum', required: true, width: 18, values: { vermittelbar: 'available', reserviert: 'reserved', vermittelt: 'adopted', 'nicht vermittelbar': 'not_available' }, hint: 'Nur „vermittelbar“ erscheint öffentlich.' },
  { header: 'Name', path: 'name', type: 'text', required: true, width: 18, hint: 'Bei Gruppen alle Namen, z. B. „Flocke & Bolle“.' },
  { header: 'Tierart', path: 'species', type: 'enum', required: true, width: 16, values: { hund: 'dog', katze: 'cat', kaninchen: 'rabbit', meerschweinchen: 'guinea_pig', nagetier: 'rodent', vogel: 'bird', reptil: 'reptile', fisch: 'fish', pferd: 'horse', sonstiges: 'other' } },
  { header: 'Rasse', path: 'breed', type: 'text', width: 22, hint: 'z. B. „Labrador-Mischling“' },
  { header: 'Geschlecht', path: 'sex', type: 'enum', required: true, width: 13, values: { 'männlich': 'male', weiblich: 'female', gemischt: 'mixed', unbekannt: 'unknown' } },
  { header: 'Kastriert', path: 'neutered', type: 'bool', width: 11, values: YES_NO },
  { header: 'Geburtsdatum', path: 'age.birthDate', type: 'birth', width: 14, hint: 'Jahr (2019), Monat (03.2019) oder Datum. Alternativ das geschätzte Alter angeben.' },
  { header: 'Alter geschätzt (Jahre)', path: 'age.estimatedYears', type: 'number', width: 12 },
  { header: 'Im Tierheim seit', path: 'intakeDate', type: 'date', width: 14 },
  { header: 'Anzahl Tiere', path: 'groupSize', type: 'int', width: 10, hint: 'Nur ausfüllen, wenn mehrere Tiere zusammen vermittelt werden.' },
  { header: 'Aktivität (1–5)', path: 'character.activity', type: 'scale', required: true, width: 11, hint: '1 = sehr ruhig, 5 = sehr bewegungsfreudig' },
  { header: 'Verschmust (1–5)', path: 'character.affection', type: 'scale', required: true, width: 11, hint: '1 = eher distanziert, 5 = sucht ständig Nähe' },
  { header: 'Ängstlich (1–5)', path: 'character.anxiety', type: 'scale', required: true, width: 11, hint: '1 = selbstsicher, 5 = sehr ängstlich, braucht viel Geduld' },
  { header: 'Verträgt Trubel (1–5)', path: 'character.noiseTolerance', type: 'scale', required: true, width: 11, hint: '1 = braucht Ruhe, 5 = Kinder, Besuch und Lärm kein Problem' },
  { header: 'Braucht Routine (1–5)', path: 'character.routineNeed', type: 'scale', required: true, width: 11 },
  { header: 'Verspielt (1–5)', path: 'character.playfulness', type: 'scale', required: true, width: 11 },
  { header: 'Wohnsituation', path: 'requirements.space', type: 'enum', required: true, width: 14, values: { wohnung: 'apartment', balkon: 'balcony', garten: 'garden' }, hint: 'Mindestens nötig: Wohnung, Balkon oder Garten' },
  { header: 'Erfahrung nötig', path: 'requirements.experience', type: 'enum', required: true, width: 14, values: { 'anfänger': 'beginner', etwas: 'some', erfahren: 'experienced' } },
  { header: 'Zeitbedarf (1–5)', path: 'requirements.timeNeed', type: 'scale', required: true, width: 11, hint: '1 = kommt gut allein klar, 5 = braucht fast ständig Gesellschaft' },
  { header: 'Max. Stunden allein', path: 'requirements.maxHoursAlone', type: 'number', width: 12 },
  { header: 'Braucht Freigang', path: 'requirements.outdoorAccess', type: 'bool', width: 12, values: YES_NO },
  { header: 'Kinder', path: 'compatibility.children', type: 'enum', required: true, width: 12, values: { ja: 'yes', nein: 'no', 'ab alter': 'from_age', unbekannt: 'unknown' } },
  { header: 'Kinder ab (Jahre)', path: 'compatibility.childrenMinAge', type: 'int', width: 11, hint: 'Nur bei Kinder = „ab Alter“' },
  { header: 'Hunde', path: 'compatibility.dogs', type: 'enum', required: true, width: 11, values: YES_NO_UNKNOWN },
  { header: 'Katzen', path: 'compatibility.cats', type: 'enum', required: true, width: 11, values: YES_NO_UNKNOWN },
  { header: 'Kleintiere', path: 'compatibility.smallAnimals', type: 'enum', required: true, width: 11, values: YES_NO_UNKNOWN },
  { header: 'Hat Fell', path: 'hasFur', type: 'bool', required: true, width: 9, values: YES_NO, hint: 'Wichtig für Menschen mit Tierhaarallergie' },
  { header: 'Gesundheit', path: 'health.notes', type: 'text', width: 30 },
  { header: 'Beschreibung', path: 'description', type: 'text', required: true, width: 50, hint: 'Mindestens 20 Zeichen über Wesen und Eigenheiten' },
  { header: 'Wunsch-Zuhause', path: 'idealHome', type: 'text', width: 40 },
  { header: 'Link zur Tierseite', path: 'url', type: 'text', required: true, width: 40, hint: 'Die Seite des Tieres auf eurer Website' },
  { header: 'Schutzgebühr (€)', path: 'adoptionFee.amount', type: 'number', width: 12 },
  { header: 'Fotos', path: '$photos', type: 'photos', width: 34, hint: 'Dateinamen der Fotos, die ihr beim Import mit hochladet (z. B. bruno-1.jpg, bruno-2.jpg), oder https-Links. Mehrere mit Komma trennen.' },
];

const EXAMPLE = ['BEISPIEL-1', 'vermittelbar', 'Bruno', 'Hund', 'Labrador-Mischling', 'männlich', 'ja', '', 9, new Date('2026-02-10'), '',
  2, 5, 2, 4, 3, 1, 'Balkon', 'Anfänger', 3, 4, 'nein', 'ja', '', 'ja', 'unbekannt', 'unbekannt', 'ja', 'Leichte Hüftarthrose',
  'Bruno liebt lange Mittagsschläfe und kurze Runden um den Block. Er läuft gut an der Leine.', 'Ein ruhiges Zuhause, gern ebenerdig.',
  'https://euer-tierheim.de/tiere/bruno', 180, 'bruno-1.jpg, bruno-2.jpg'];

const labelOf = (col, code) => Object.entries(col.values ?? {}).find(([, v]) => v === code)?.[0];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export async function buildTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Petify';
  const ws = wb.addWorksheet('Tiere', { views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ header: c.required ? `${c.header} *` : c.header, width: c.width }));
  const head = ws.getRow(1);
  head.height = 34;
  head.eachCell((cell, i) => {
    const col = COLUMNS[i - 1];
    cell.font = { bold: true, color: { argb: 'FF3B2412' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col.required ? 'FFF2C14E' : 'FFF8E3A8' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    if (col.hint) cell.note = col.hint;
  });
  ws.addRow(EXAMPLE).eachCell((cell) => { cell.font = { italic: true, color: { argb: 'FF7A5A3A' } }; });
  ws.getCell('J2').numFmt = 'dd.mm.yyyy';
  // Auswahllisten und Zahlenbereiche direkt in Excel prüfen
  COLUMNS.forEach((c, i) => {
    let rule = null;
    if (c.values) rule = { type: 'list', allowBlank: !c.required, formulae: [`"${Object.keys(c.values).map(cap).join(',')}"`], showErrorMessage: true, errorTitle: c.header, error: `Bitte einen Wert aus der Liste wählen.` };
    if (c.type === 'scale') rule = { type: 'whole', operator: 'between', allowBlank: !c.required, formulae: [1, 5], showErrorMessage: true, errorTitle: c.header, error: 'Bitte eine ganze Zahl von 1 bis 5.' };
    if (!rule) return;
    const letter = ws.getColumn(i + 1).letter;
    for (let r = 2; r <= 501; r++) ws.dataValidations.add(`${letter}${r}`, rule);
  });

  const help = wb.addWorksheet('Anleitung');
  help.columns = [{ header: 'Spalte', width: 26 }, { header: 'Pflicht', width: 9 }, { header: 'Erlaubte Werte', width: 42 }, { header: 'Erklärung', width: 70 }];
  help.getRow(1).font = { bold: true };
  help.addRow([]);
  help.addRow(['So geht’s: Pro Zeile ein Tier (oder eine Gruppe, die zusammen vermittelt wird). Die Beispielzeile „BEISPIEL-1“ wird beim Import ignoriert und darf gelöscht werden.']);
  help.addRow(['Fotos ladet ihr beim Import zusammen mit dieser Datei hoch; in der Spalte „Fotos“ stehen nur die Dateinamen.']);
  help.addRow([]);
  for (const c of COLUMNS) {
    const allowed = c.values ? Object.keys(c.values).map(cap).join(', ') : c.type === 'scale' ? '1 bis 5' : c.type === 'date' ? 'Datum' : c.type === 'number' || c.type === 'int' ? 'Zahl' : '';
    help.addRow([c.header, c.required ? 'ja' : '', allowed, c.hint ?? '']);
  }
  return wb.xlsx.writeBuffer();
}

// --- Einlesen ---

function plain(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return plain(v.result);
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return plain(v.text);
    if (v.hyperlink) return v.hyperlink;
    return null;
  }
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  return v;
}

const isoDate = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

function parseDate(v) {
  if (v instanceof Date) return isoDate(v);
  const s = String(v);
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  throw new Error('kein gültiges Datum (z. B. 10.02.2026)');
}

function parseBirth(v) {
  if (v instanceof Date) return isoDate(v);
  const s = String(v);
  if (/^\d{4}$/.test(s)) return s;
  let m = s.match(/^(\d{1,2})[./](\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return s;
  return parseDate(s);
}

function convert(col, raw) {
  const v = plain(raw);
  if (v === null) return undefined;
  switch (col.type) {
    case 'text': return String(v);
    case 'enum': case 'bool': {
      const key = String(v).trim().toLowerCase();
      if (key in col.values) return col.values[key];
      if (Object.values(col.values).includes(key)) return key;
      throw new Error(`„${v}“ ist nicht erlaubt – möglich: ${Object.keys(col.values).map(cap).join(', ')}`);
    }
    case 'scale': case 'int': {
      const n = Number(String(v).replace(',', '.'));
      if (!Number.isInteger(n)) throw new Error(col.type === 'scale' ? 'bitte eine ganze Zahl von 1 bis 5' : 'bitte eine ganze Zahl');
      return n;
    }
    case 'number': {
      const n = Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n)) throw new Error('bitte eine Zahl');
      return n;
    }
    case 'date': return parseDate(v);
    case 'birth': return parseBirth(v);
    case 'photos': return String(v).split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
    default: return v;
  }
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  keys.slice(0, -1).forEach((k) => { o = o[k] ??= {}; });
  o[keys.at(-1)] = value;
}

const normHeader = (s) => String(s ?? '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// Fehlermeldungen des Schemas auf Spaltennamen übersetzen
function friendly(msg) {
  const [path, ...rest] = msg.split(': ');
  const col = COLUMNS.find((c) => c.path === path) ?? COLUMNS.find((c) => path.startsWith(`${c.path}.`));
  if (path.startsWith('adoptionFee')) return `Schutzgebühr: ${rest.join(': ')}`;
  return col ? `${col.header}: ${rest.join(': ')}` : msg;
}

// Liefert je Zeile das Tierprofil, die genannten Fotos und alle Fehler
export async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    return { error: 'Die Datei konnte nicht gelesen werden. Bitte als Excel-Datei (.xlsx) speichern.' };
  }
  const ws = wb.getWorksheet('Tiere') ?? wb.worksheets[0];
  if (!ws) return { error: 'Die Datei enthält kein Tabellenblatt.' };
  const headerMap = new Map();
  ws.getRow(1).eachCell((cell, i) => headerMap.set(normHeader(plain(cell.value)), i));
  const missing = COLUMNS.filter((c) => c.required && !headerMap.has(normHeader(c.header)));
  if (missing.length) return { error: `Es fehlen Pflichtspalten: ${missing.map((c) => c.header).join(', ')}. Bitte nutzt die Vorlage.` };

  const rows = [];
  const seen = new Map();
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cells = COLUMNS.map((c) => (headerMap.has(normHeader(c.header)) ? row.getCell(headerMap.get(normHeader(c.header))).value : null));
    if (cells.every((v) => plain(v) === null)) return;
    const doc = {};
    const errors = [];
    let photoNames = [];
    COLUMNS.forEach((c, i) => {
      try {
        const value = convert(c, cells[i]);
        if (value === undefined) return;
        if (c.path === '$photos') {
          const urls = value.filter((s) => /^https:\/\//.test(s));
          photoNames = value.filter((s) => !/^https?:\/\//.test(s));
          if (urls.length) doc.photos = urls.map((url) => ({ url }));
          if (value.some((s) => /^http:\/\//.test(s))) errors.push('Fotos: Links müssen mit https:// beginnen');
        } else {
          setPath(doc, c.path, value);
        }
      } catch (err) {
        errors.push(`${c.header}: ${err.message}`);
      }
    });
    if (doc.adoptionFee) doc.adoptionFee.currency = 'EUR';
    if (doc.health && !doc.health.notes) delete doc.health;
    if (String(doc.externalId ?? '').toUpperCase().startsWith('BEISPIEL')) return;
    if (doc.externalId && seen.has(doc.externalId)) errors.push(`Karteinummer: „${doc.externalId}“ kommt schon in Zeile ${seen.get(doc.externalId)} vor`);
    if (doc.externalId) seen.set(doc.externalId, rowNumber);
    // Alle Fehler einer Zeile auf einmal melden; Spalten mit Umwandlungsfehler nicht doppelt
    if (!doc.url && !errors.some((e) => e.startsWith('Link zur Tierseite'))) errors.push('Link zur Tierseite: Pflichtfeld fehlt');
    doc.assessment = { method: 'import' };
    const v = validateAnimal(doc);
    if (!v.ok) {
      const already = new Set(errors.map((e) => e.split(':')[0]));
      errors.push(...v.errors.map(friendly).filter((e) => !already.has(e.split(':')[0])));
    } else if (!errors.length) {
      Object.assign(doc, v.value);
    }
    rows.push({ row: rowNumber, externalId: doc.externalId ?? null, name: doc.name ?? null, species: doc.species ?? null, doc, photoNames, errors });
  });
  if (!rows.length) return { error: 'In der Tabelle stehen keine Tiere. Tragt ab Zeile 2 ein Tier pro Zeile ein.' };
  return { rows };
}

export { labelOf };
