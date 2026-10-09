ALTER TABLE auth_sessions ADD COLUMN last_seen_at TEXT;
ALTER TABLE auth_sessions ADD COLUMN current_page TEXT NOT NULL DEFAULT 'Other';

CREATE INDEX auth_sessions_presence_idx ON auth_sessions(last_seen_at, expires_at);
