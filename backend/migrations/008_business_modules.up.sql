CREATE TABLE deposit_methods (
  code TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  provider TEXT NOT NULL,
  fee_fixed INTEGER NOT NULL DEFAULT 0 CHECK (fee_fixed >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE withdrawal_methods (
  code TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  provider TEXT NOT NULL,
  fee_percent REAL NOT NULL DEFAULT 0 CHECK (fee_percent >= 0),
  fee_fixed INTEGER NOT NULL DEFAULT 0 CHECK (fee_fixed >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE support_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE support_conversations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE support_messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES support_conversations(id)
);
CREATE TABLE referral_settings (
  level INTEGER PRIMARY KEY CHECK (level BETWEEN 1 AND 3),
  percentage REAL NOT NULL DEFAULT 0 CHECK (percentage >= 0 AND percentage <= 100),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE referral_relationships (
  user_id TEXT PRIMARY KEY NOT NULL,
  sponsor_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES wallet_accounts(user_id),
  FOREIGN KEY (sponsor_user_id) REFERENCES wallet_accounts(user_id)
);
CREATE TABLE product_purchases (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  qualifying_amount INTEGER NOT NULL CHECK (qualifying_amount > 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED')),
  reference TEXT NOT NULL UNIQUE,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES wallet_accounts(user_id)
);
CREATE TABLE commission_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  beneficiary_user_id TEXT NOT NULL,
  source_user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL,
  referral_level INTEGER NOT NULL CHECK (referral_level BETWEEN 1 AND 3),
  percentage REAL NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
  qualifying_amount INTEGER NOT NULL CHECK (qualifying_amount > 0),
  commission_amount INTEGER NOT NULL CHECK (commission_amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  reference TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  UNIQUE (purchase_id, beneficiary_user_id, referral_level)
);
CREATE INDEX support_messages_conversation_idx ON support_messages(conversation_id, created_at);
CREATE INDEX commission_ledger_beneficiary_idx ON commission_ledger(beneficiary_user_id, created_at);
CREATE INDEX product_purchases_user_idx ON product_purchases(user_id, created_at);

INSERT OR IGNORE INTO deposit_methods (code, name, enabled, provider) VALUES ('MTN_MOMO', 'MTN MoMo', 1, 'ADMIN_REVIEW');
INSERT OR IGNORE INTO deposit_methods (code, name, enabled, provider) VALUES ('AIRTEL_MONEY', 'Airtel Money', 0, 'ADMIN_REVIEW');
INSERT OR IGNORE INTO withdrawal_methods (code, name, enabled, provider) VALUES ('MTN_MOMO', 'MTN MoMo', 1, 'ADMIN_REVIEW');
INSERT OR IGNORE INTO withdrawal_methods (code, name, enabled, provider) VALUES ('AIRTEL_MONEY', 'Airtel Money', 1, 'ADMIN_REVIEW');
INSERT OR IGNORE INTO support_settings (key, value) VALUES ('telegram_url', ''), ('support_email', ''), ('live_chat_enabled', '1');
INSERT OR IGNORE INTO referral_settings (level, percentage) VALUES (1, 0), (2, 0), (3, 0);
