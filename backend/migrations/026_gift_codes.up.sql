CREATE TABLE gift_codes (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  max_uses INTEGER NOT NULL CHECK (max_uses > 0),
  expires_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE gift_code_redemptions (
  id TEXT PRIMARY KEY NOT NULL,
  code_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redeemed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (code_id, user_id),
  FOREIGN KEY (code_id) REFERENCES gift_codes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX gift_code_redemptions_code_idx ON gift_code_redemptions(code_id, redeemed_at DESC);