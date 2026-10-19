CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  subscription_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX push_subscriptions_user_idx ON push_subscriptions(user_id);
