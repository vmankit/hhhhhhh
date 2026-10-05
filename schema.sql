-- Manual Health Logger — database schema
-- Works on Vercel Postgres, Neon, Supabase Postgres, or any Postgres 14+.

CREATE TABLE IF NOT EXISTS google_accounts (
  id              SERIAL PRIMARY KEY,
  -- Single-user app: there is exactly one row here, for the one Google
  -- account you connect. google_sub is Google's stable user id, kept
  -- so a second OAuth login overwrites the same row instead of duplicating.
  google_sub      TEXT UNIQUE NOT NULL,
  email           TEXT,
  -- Tokens are encrypted (AES-256-GCM) before storage. See lib/crypto.ts.
  -- They are NEVER sent to the browser.
  access_token_enc   TEXT NOT NULL,
  refresh_token_enc  TEXT,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  granted_scopes  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type   TEXT NOT NULL,           -- running | walking | cycling | hiking | swimming | strength_training | other
  distance_km     NUMERIC(8,3),            -- nullable: strength training has no distance
  duration_minutes INTEGER NOT NULL,
  calories        INTEGER,
  notes           TEXT,
  start_time      TIMESTAMPTZ NOT NULL,    -- derived from date + start time entered by the user
  end_time        TIMESTAMPTZ NOT NULL,    -- start_time + duration_minutes

  -- Deterministic idempotency key: sha256(activity_type|start_time|duration|distance),
  -- scoped to the single account in this app. Prevents accidental duplicate
  -- submissions (e.g. double-click on Save) from creating two records.
  idempotency_key TEXT UNIQUE NOT NULL,

  sync_status     TEXT NOT NULL DEFAULT 'pending', -- pending | synced | failed
  google_record_id TEXT,                  -- the Google Health API data point id, once synced
  sync_error      TEXT,                    -- human-readable error, if failed
  sync_attempts   INTEGER NOT NULL DEFAULT 0,
  last_synced_at  TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workouts_start_time ON workouts (start_time DESC);
CREATE INDEX IF NOT EXISTS idx_workouts_sync_status ON workouts (sync_status);

-- Needed for gen_random_uuid() on some Postgres providers:
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- --- HC Webhook (mcnaveen/health-connect-webhook) ingestion ---
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

-- Non-exercise records (steps, heart rate, sleep, ...) pushed by the webhook.
CREATE TABLE IF NOT EXISTS health_samples (
  id          BIGSERIAL PRIMARY KEY,
  data_type   TEXT NOT NULL,
  start_time  TIMESTAMPTZ,
  payload     JSONB NOT NULL,
  record_hash TEXT UNIQUE NOT NULL,   -- sha256(data_type|payload) for dedupe
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_health_samples_type_time ON health_samples (data_type, start_time DESC);
