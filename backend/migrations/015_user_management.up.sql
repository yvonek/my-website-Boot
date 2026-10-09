CREATE TABLE user_access_controls (
  user_id TEXT PRIMARY KEY NOT NULL,
  account_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE', 'FROZEN', 'RESTRICTED', 'SUSPENDED')),
  allow_deposits INTEGER NOT NULL DEFAULT 1 CHECK (allow_deposits IN (0, 1)),
  allow_withdrawals INTEGER NOT NULL DEFAULT 1 CHECK (allow_withdrawals IN (0, 1)),
  deleted_at TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE user_permissions (
  user_id TEXT NOT NULL,
  feature TEXT NOT NULL CHECK (feature IN ('dashboard', 'products', 'wallet', 'deposit', 'withdraw', 'myTeam', 'support', 'telegram', 'messages')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, feature),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE user_messages (
  id TEXT PRIMARY KEY NOT NULL,
  sender_user_id TEXT,
  recipient_user_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('PRIVATE', 'BROADCAST')),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  notification_type TEXT NOT NULL DEFAULT 'INFO',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK ((kind = 'PRIVATE' AND recipient_user_id IS NOT NULL) OR (kind = 'BROADCAST' AND recipient_user_id IS NULL))
);

CREATE TABLE user_message_reads (
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id),
  FOREIGN KEY (message_id) REFERENCES user_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE admin_audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  admin_user_id TEXT,
  target_user_id TEXT,
  action TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX user_access_controls_status_idx ON user_access_controls(account_status);
CREATE INDEX user_permissions_user_idx ON user_permissions(user_id, feature);
CREATE INDEX user_messages_recipient_idx ON user_messages(recipient_user_id, created_at DESC);
CREATE INDEX user_messages_broadcast_idx ON user_messages(kind, created_at DESC);
CREATE INDEX user_message_reads_user_idx ON user_message_reads(user_id, read_at DESC);
CREATE INDEX admin_audit_log_target_idx ON admin_audit_log(target_user_id, created_at DESC);
CREATE INDEX admin_audit_log_created_idx ON admin_audit_log(created_at DESC);