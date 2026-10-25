-- Petify: Tierheime und ihre Tiere

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

-- --- Privatpersonen, Moderation und Vermittlungsanfragen ---

-- Anbieter sind Tierheime oder Privatpersonen (je Person ein Eintrag mit kind = 'private')
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'shelter' CHECK (kind IN ('shelter', 'private'));
-- Schutz vor Überlastung: so viele Anfragen gehen pro Tier gleichzeitig bzw. pro Tag an den Anbieter
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS per_animal_limit INTEGER NOT NULL DEFAULT 5 CHECK (per_animal_limit BETWEEN 1 AND 50);
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS daily_request_limit INTEGER NOT NULL DEFAULT 25 CHECK (daily_request_limit BETWEEN 1 AND 500);

-- Tiere von Privatpersonen werden vor der Veröffentlichung geprüft
ALTER TABLE animals ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'approved' CHECK (review_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE animals ADD COLUMN IF NOT EXISTS review_note TEXT;

-- Ergebnis des Persönlichkeitstests je Person
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  profile    JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS adoption_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  animal_id   UUID NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
  shelter_id  UUID NOT NULL REFERENCES shelters(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- declined_auto: Vorprüfung; waitlist: Kapazität erreicht; sent: beim Anbieter; accepted: Kontakt freigegeben
  status      TEXT NOT NULL CHECK (status IN ('declined_auto', 'waitlist', 'sent', 'accepted', 'declined', 'withdrawn', 'expired', 'closed')),
  message     TEXT NOT NULL,
  profile     JSONB NOT NULL,
  score       INTEGER NOT NULL,
  screening   JSONB NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ,
  decided_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS requests_animal_status ON adoption_requests (animal_id, status);
CREATE INDEX IF NOT EXISTS requests_user ON adoption_requests (user_id, created_at);
-- Nur eine offene Anfrage pro Person und Tier
CREATE UNIQUE INDEX IF NOT EXISTS requests_one_open ON adoption_requests (animal_id, user_id) WHERE status IN ('waitlist', 'sent', 'accepted');
