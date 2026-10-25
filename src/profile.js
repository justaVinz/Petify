// Persönlichkeitsprofil aus dem Quiz – Grundlage für Matching und Vermittlungsanfragen
import Ajv2020 from 'ajv/dist/2020.js';

const unit = { type: 'number', minimum: 0, maximum: 1 };

export const profileSchema = {
  type: 'object', additionalProperties: false,
  required: ['activity', 'affection', 'patience', 'busyHome', 'routine', 'curiosity', 'space', 'timeAtHome', 'experience', 'children', 'allergy'],
  properties: {
    activity: unit, affection: unit, patience: unit, busyHome: unit, routine: unit, curiosity: unit,
    space: { enum: ['apartment', 'balcony', 'garden'] },
    timeAtHome: { enum: ['low', 'medium', 'high'] },
    experience: { enum: ['beginner', 'some', 'experienced'] },
    children: { type: 'boolean' },
    otherPets: { type: 'array', items: { enum: ['dog', 'cat', 'smallAnimal'] }, uniqueItems: true, default: [] },
    allergy: { type: 'boolean' },
  },
};

const ajv = new Ajv2020({ allErrors: true, useDefaults: true });
const check = ajv.compile(profileSchema);

export function validateProfile(input) {
  const copy = structuredClone(input ?? null);
  return check(copy) ? { ok: true, value: copy } : { ok: false, errors: check.errors.map((e) => `${e.instancePath || 'profile'} ${e.message}`) };
}
