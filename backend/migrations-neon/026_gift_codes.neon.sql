BEGIN;

CREATE TABLE IF NOT EXISTS gift_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  max_uses INTEGER NOT NULL CHECK (max_uses > 0),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gift_code_redemptions (
  id TEXT PRIMARY KEY,
  code_id TEXT NOT NULL REFERENCES gift_codes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code_id, user_id)
);

CREATE INDEX IF NOT EXISTS gift_code_redemptions_code_idx ON gift_code_redemptions(code_id, redeemed_at DESC);

INSERT INTO app_schema_migrations (version, source)
VALUES (26, 'manual-neon-026_gift_codes')
ON CONFLICT (version) DO NOTHING;

COMMIT;