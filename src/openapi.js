// OpenAPI-Beschreibung der Petify-API (wird unter /openapi.json und /docs ausgeliefert)
import { animalSchema } from './validate.js';

const { $schema, $id, $defs, ...animal } = animalSchema;
// $defs-Verweise auf OpenAPI-Komponenten umbiegen
const animalComponent = JSON.parse(JSON.stringify(animal).replaceAll('#/$defs/', '#/components/schemas/'));

const json = (schema) => ({ 'application/json': { schema } });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const err = (description) => ({ description, content: json(ref('Error')) });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };

export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Petify – Tierheim-API',
    version: '0.1.0',
    description: 'Einheitliche Schnittstelle, über die Tierheime vermittelbare Tiere erfassen. '
      + 'Lesende Endpunkte sind öffentlich. Schreibende Endpunkte brauchen den API-Schlüssel des Tierheims als Bearer-Token. '
      + 'Alle Tierprofile werden gegen das Schema „Animal“ geprüft.',
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'Öffentlich', description: 'Tiere und Tierheime suchen, Persönlichkeitstest auswerten' },
    { name: 'Tierheime', description: 'Eigene Tiere erfassen und pflegen (API-Schlüssel nötig)' },
    { name: 'Verwaltung', description: 'Tierheime anlegen (X-Admin-Token)' },
  ],
  components: {
    securitySchemes: {
      shelterKey: { type: 'http', scheme: 'bearer', description: 'API-Schlüssel des Tierheims, z. B. pm_…' },
      adminToken: { type: 'apiKey', in: 'header', name: 'X-Admin-Token' },
    },
    schemas: {
      scale: $defs.scale,
      compat: $defs.compat,
      Animal: animalComponent,
      AnimalOut: {
        allOf: [ref('Animal'), {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            shelter: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, city: { type: 'string' }, postalCode: { type: 'string' }, website: { type: ['string', 'null'] }, isExample: { type: 'boolean' } } },
            distanceKm: { type: ['number', 'null'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        }],
      },
      Shelter: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, street: { type: ['string', 'null'] }, postalCode: { type: 'string' }, city: { type: 'string' },
          location: { type: ['object', 'null'], properties: { lat: { type: 'number' }, lng: { type: 'number' } } },
          website: { type: ['string', 'null'] }, email: { type: ['string', 'null'] }, phone: { type: ['string', 'null'] }, isExample: { type: 'boolean' },
        },
      },
      MatchRequest: {
        type: 'object', required: ['profile'],
        properties: {
          location: { type: 'object', description: 'Entweder Koordinaten (Luftlinie) oder Postleitzahl (gleiche Leitregion)', properties: { lat: { type: 'number' }, lng: { type: 'number' }, postalCode: { type: 'string', pattern: '^\\d{5}$' }, radiusKm: { type: 'number', default: 25 } } },
          profile: {
            type: 'object',
            description: 'Ergebnis des Persönlichkeitstests. Persönlichkeitswerte von 0 bis 1.',
            required: ['activity', 'affection', 'patience', 'busyHome', 'routine', 'curiosity', 'space', 'timeAtHome', 'experience', 'children', 'allergy'],
            properties: {
              activity: { type: 'number' }, affection: { type: 'number' }, patience: { type: 'number' }, busyHome: { type: 'number' }, routine: { type: 'number' }, curiosity: { type: 'number' },
              space: { enum: ['apartment', 'balcony', 'garden'] }, timeAtHome: { enum: ['low', 'medium', 'high'] }, experience: { enum: ['beginner', 'some', 'experienced'] },
              children: { type: 'boolean' }, otherPets: { type: 'array', items: { enum: ['dog', 'cat', 'smallAnimal'] } }, allergy: { type: 'boolean' },
            },
          },
          species: { type: 'array', items: { type: 'string' } },
          limit: { type: 'integer', default: 3, maximum: 50 },
        },
        example: {
          location: { postalCode: '10115', radiusKm: 25 },
          profile: { activity: 0.4, affection: 0.9, patience: 0.6, busyHome: 0.3, routine: 0.7, curiosity: 0.3, space: 'apartment', timeAtHome: 'medium', experience: 'beginner', children: false, otherPets: [], allergy: false },
        },
      },
      Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: { type: 'array', items: { type: 'string' } } } } } },
    },
  },
  paths: {
    '/v1/animals': {
      get: {
        tags: ['Öffentlich'], summary: 'Vermittelbare Tiere suchen',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', default: 'available' } },
          { name: 'species', in: 'query', description: 'Kommagetrennt, z. B. dog,cat', schema: { type: 'string' } },
          { name: 'lat', in: 'query', schema: { type: 'number' } }, { name: 'lng', in: 'query', schema: { type: 'number' } },
          { name: 'postalCode', in: 'query', schema: { type: 'string' } }, { name: 'radiusKm', in: 'query', schema: { type: 'number', default: 25 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }, { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { 200: { description: 'Trefferliste', content: json({ type: 'object', properties: { total: { type: 'integer' }, animals: { type: 'array', items: ref('AnimalOut') } } }) } },
      },
      post: {
        tags: ['Tierheime'], summary: 'Tier anlegen', security: [{ shelterKey: [] }],
        requestBody: { required: true, content: json(ref('Animal')) },
        responses: { 201: { description: 'Angelegt', content: json(ref('AnimalOut')) }, 401: err('Kein oder falscher API-Schlüssel'), 409: err('externalId existiert bereits'), 422: err('Profil entspricht nicht dem Schema') },
      },
    },
    '/v1/animals/{id}': {
      get: { tags: ['Öffentlich'], summary: 'Ein Tier', parameters: [idParam], responses: { 200: { description: 'Tierprofil', content: json(ref('AnimalOut')) }, 404: err('Nicht gefunden') } },
      put: { tags: ['Tierheime'], summary: 'Tierprofil ersetzen', security: [{ shelterKey: [] }], parameters: [idParam], requestBody: { required: true, content: json(ref('Animal')) }, responses: { 200: { description: 'Aktualisiert', content: json(ref('AnimalOut')) }, 403: err('Gehört einem anderen Tierheim'), 422: err('Ungültig') } },
      delete: { tags: ['Tierheime'], summary: 'Tier löschen', security: [{ shelterKey: [] }], parameters: [idParam], responses: { 204: { description: 'Gelöscht' }, 403: err('Gehört einem anderen Tierheim') } },
    },
    '/v1/animals/{id}/status': {
      patch: { tags: ['Tierheime'], summary: 'Status ändern (z. B. reserviert, vermittelt)', security: [{ shelterKey: [] }], parameters: [idParam], requestBody: { required: true, content: json({ type: 'object', required: ['status'], properties: { status: { enum: animalSchema.properties.status.enum } } }) }, responses: { 200: { description: 'Geändert', content: json(ref('AnimalOut')) } } },
    },
    '/v1/animals/import': {
      post: {
        tags: ['Tierheime'], summary: 'Sammelimport (anlegen oder aktualisieren per externalId)', security: [{ shelterKey: [] }],
        requestBody: { required: true, content: json({ type: 'object', required: ['animals'], properties: { animals: { type: 'array', maxItems: 500, items: ref('Animal') } } }) },
        responses: { 200: { description: 'Ergebnis je Tier', content: json({ type: 'object', properties: { created: { type: 'integer' }, updated: { type: 'integer' }, invalid: { type: 'integer' }, results: { type: 'array', items: { type: 'object' } } } }) } },
      },
    },
    '/v1/me': { get: { tags: ['Tierheime'], summary: 'Eigenes Tierheim', security: [{ shelterKey: [] }], responses: { 200: { description: 'Tierheim', content: json(ref('Shelter')) } } } },
    '/v1/me/animals': { get: { tags: ['Tierheime'], summary: 'Alle eigenen Tiere (jeder Status)', security: [{ shelterKey: [] }], responses: { 200: { description: 'Liste', content: json({ type: 'object', properties: { animals: { type: 'array', items: ref('AnimalOut') } } }) } } } },
    '/v1/validate': { post: { tags: ['Tierheime'], summary: 'Tierprofil prüfen, ohne zu speichern', requestBody: { content: json(ref('Animal')) }, responses: { 200: { description: 'Gültig' }, 422: { description: 'Fehlerliste' } } } },
    '/v1/schema/animal': { get: { tags: ['Öffentlich'], summary: 'JSON-Schema des Tierprofils', responses: { 200: { description: 'JSON-Schema (Draft 2020-12)' } } } },
    '/v1/match': { post: { tags: ['Öffentlich'], summary: 'Persönlichkeitstest auswerten: passende Tiere in der Umgebung', requestBody: { required: true, content: json(ref('MatchRequest')) }, responses: { 200: { description: 'Passende Tiere mit Begründung und ausgeschlossene Tiere mit Grund' }, 400: err('Profil ungültig') } } },
    '/v1/shelters': {
      get: { tags: ['Öffentlich'], summary: 'Alle Tierheime', responses: { 200: { description: 'Liste', content: json({ type: 'object', properties: { shelters: { type: 'array', items: ref('Shelter') } } }) } } },
      post: { tags: ['Verwaltung'], summary: 'Tierheim anlegen – gibt den API-Schlüssel einmalig zurück', security: [{ adminToken: [] }], requestBody: { required: true, content: json({ type: 'object', required: ['name', 'postalCode', 'city'], properties: { name: { type: 'string' }, street: { type: 'string' }, postalCode: { type: 'string' }, city: { type: 'string' }, location: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } }, website: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' } } }) }, responses: { 201: { description: 'Angelegt', content: json({ type: 'object', properties: { shelter: ref('Shelter'), apiKey: { type: 'string' } } }) }, 403: err('Kein Verwaltungszugang') } },
    },
    '/v1/shelters/{id}': { get: { tags: ['Öffentlich'], summary: 'Ein Tierheim', parameters: [idParam], responses: { 200: { description: 'Tierheim', content: json(ref('Shelter')) } } } },
    '/v1/shelters/{id}/rotate-key': { post: { tags: ['Verwaltung'], summary: 'Neuen API-Schlüssel ausstellen', security: [{ adminToken: [] }], parameters: [idParam], responses: { 200: { description: 'Neuer Schlüssel' } } } },
  },
};
