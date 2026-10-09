DROP INDEX IF EXISTS auth_sessions_presence_idx;
ALTER TABLE auth_sessions DROP COLUMN current_page;
ALTER TABLE auth_sessions DROP COLUMN last_seen_at;
