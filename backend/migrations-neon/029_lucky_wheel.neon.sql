BEGIN;

CREATE TABLE IF NOT EXISTS lucky_wheel_prizes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_data TEXT,
  value_rwf INTEGER NOT NULL CHECK (value_rwf >= 0),
  weight INTEGER NOT NULL DEFAULT 1 CHECK (weight > 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lucky_wheel_spins (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referral_user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  prize_id TEXT NOT NULL,
  prize_name TEXT NOT NULL,
  prize_description TEXT NOT NULL DEFAULT '',
  prize_image_data TEXT,
  prize_value_rwf INTEGER NOT NULL CHECK (prize_value_rwf >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lucky_wheel_spins_user_idx ON lucky_wheel_spins(user_id, created_at);

INSERT INTO app_schema_migrations (version, source)
VALUES (29, 'manual-neon-029_lucky_wheel')
ON CONFLICT (version) DO NOTHING;

COMMIT;