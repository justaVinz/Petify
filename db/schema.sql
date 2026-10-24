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

-- --- Zugang für Tierheime: Login per E-Mail-Link oder Google ---

-- Neu registrierte Tierheime sind erst nach Prüfung öffentlich sichtbar
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'suspended'));
ALTER TABLE shelters ALTER COLUMN api_key_hash DROP NOT NULL;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  name          TEXT,
  google_sub    TEXT UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- Wer zu einem Tierheim gehört, wird über die E-Mail-Adresse festgelegt (auch vor dem ersten Login)
CREATE TABLE IF NOT EXISTS shelter_members (
  shelter_id UUID NOT NULL REFERENCES shelters(id) ON DELETE CASCADE,
  email      TEXT NOT NULL CHECK (email = lower(email)),
  role       TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shelter_id, email)
);

CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash    TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  animal_id  UUID NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
  shelter_id UUID NOT NULL REFERENCES shelters(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  alt        TEXT,
  source_name TEXT,          -- ursprünglicher Dateiname, verhindert Duplikate bei erneutem Import
  width      INTEGER,
  height     INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photos_animal ON photos (animal_id, position);

-- Excel-Import: erst Vorschau, dann Übernahme
CREATE TABLE IF NOT EXISTS imports (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shelter_id UUID NOT NULL REFERENCES shelters(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  filename   TEXT NOT NULL,
  rows       JSONB NOT NULL,
  photos     JSONB NOT NULL DEFAULT '[]',
  status     TEXT NOT NULL DEFAULT 'preview' CHECK (status IN ('preview', 'committed', 'discarded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migration für bestehende Datenbanken
ALTER TABLE photos ADD COLUMN IF NOT EXISTS source_name TEXT;
