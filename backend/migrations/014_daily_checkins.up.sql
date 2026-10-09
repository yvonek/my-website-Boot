CREATE TABLE daily_checkins (
  user_id TEXT NOT NULL,
  checkin_date TEXT NOT NULL,
  reward_amount INTEGER NOT NULL CHECK (reward_amount > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, checkin_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX daily_checkins_date_idx ON daily_checkins(checkin_date);