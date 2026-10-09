ALTER TABLE auth_sessions ADD COLUMN token_hash TEXT;
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'USER';
CREATE UNIQUE INDEX auth_sessions_token_hash_idx ON auth_sessions(token_hash) WHERE token_hash IS NOT NULL;
