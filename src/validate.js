import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const animalSchema = JSON.parse(readFileSync(new URL('./schema/animal.schema.json', import.meta.url), 'utf8'));

const ajv = new Ajv2020({ allErrors: true, useDefaults: true, strict: false });
addFormats(ajv);
const check = ajv.compile(animalSchema);

// Verständliche Fehlermeldungen mit Feldpfad, z. B. "character.activity: muss zwischen 1 und 5 liegen"
function describe(err) {
  const path = err.instancePath.replace(/^\//, '').replaceAll('/', '.') || '(Tierprofil)';
  switch (err.keyword) {
    case 'required': return `${path === '(Tierprofil)' ? '' : `${path}.`}${err.params.missingProperty}: Pflichtfeld fehlt`;
    case 'additionalProperties': return `${path}: unbekanntes Feld „${err.params.additionalProperty}“`;
    case 'enum': return `${path}: erlaubt sind ${err.params.allowedValues.join(', ')}`;
    case 'minimum': return `${path}: muss mindestens ${err.params.limit} sein`;
    case 'maximum': return `${path}: darf höchstens ${err.params.limit} sein`;
    case 'minLength': return `${path}: zu kurz (mindestens ${err.params.limit} Zeichen)`;
    case 'maxLength': return `${path}: zu lang (höchstens ${err.params.limit} Zeichen)`;
    case 'pattern': case 'format': return `${path}: ungültiges Format`;
    case 'type': return `${path}: falscher Typ, erwartet ${err.params.type}`;
    default: return `${path}: ${err.message}`;
  }
}

export function validateAnimal(doc) {
  const copy = structuredClone(doc);
  if (check(copy)) {
    const extra = [];
    if (copy.compatibility.children === 'from_age' && copy.compatibility.childrenMinAge === undefined) {
      extra.push('compatibility.childrenMinAge: bei children = from_age bitte das Mindestalter angeben');
    }
    if (extra.length) return { ok: false, errors: extra };
    return { ok: true, value: copy };
  }
  return { ok: false, errors: [...new Set(check.errors.map(describe))] };
}
