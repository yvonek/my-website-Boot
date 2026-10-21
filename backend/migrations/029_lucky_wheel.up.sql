CREATE TABLE lucky_wheel_prizes (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_data TEXT,
  value_rwf INTEGER NOT NULL CHECK (value_rwf >= 0),
  weight INTEGER NOT NULL DEFAULT 1 CHECK (weight > 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE lucky_wheel_spins (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  referral_user_id TEXT NOT NULL UNIQUE,
  prize_id TEXT NOT NULL,
  prize_name TEXT NOT NULL,
  prize_description TEXT NOT NULL DEFAULT '',
  prize_image_data TEXT,
  prize_value_rwf INTEGER NOT NULL CHECK (prize_value_rwf >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (referral_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX lucky_wheel_spins_user_idx ON lucky_wheel_spins(user_id, created_at);