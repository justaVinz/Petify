-- Pfotenmatch: Tierheime und ihre Tiere

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS shelters (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  street       TEXT,
  postal_code  TEXT NOT NULL CHECK (postal_code ~ '^\d{5}$'),
  city         TEXT NOT NULL,
  lat          DOUBLE PRECISION CHECK (lat BETWEEN -90 AND 90),
  lng          DOUBLE PRECISION CHECK (lng BETWEEN -180 AND 180),
  website      TEXT,
  email        TEXT,
  phone        TEXT,
  is_example   BOOLEAN NOT NULL DEFAULT false,
  -- Nur der Hash des API-Schlüssels wird gespeichert
  api_key_hash TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS animals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shelter_id  UUID NOT NULL REFERENCES shelters(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  status      TEXT NOT NULL,
  species     TEXT NOT NULL,
  name        TEXT NOT NULL,
  -- vollständiges, gegen das JSON-Schema geprüftes Tierprofil
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shelter_id, external_id)
);

CREATE INDEX IF NOT EXISTS animals_status_species ON animals (status, species);
CREATE INDEX IF NOT EXISTS shelters_postal_code ON shelters (postal_code);
