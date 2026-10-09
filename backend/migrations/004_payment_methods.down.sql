PRAGMA foreign_keys = OFF;

CREATE TABLE wallet_transactions_payment_methods_down (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAWAL')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  phone_number TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method = 'MTN_MOMO'),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'REJECTED', 'CANCELLED')),
  provider TEXT NOT NULL,
  provider_reference TEXT UNIQUE,
  internal_reference TEXT NOT NULL UNIQUE,
  failure_reason TEXT,
  approved_by TEXT,
  approved_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  withdrawal_fee INTEGER NOT NULL DEFAULT 0 CHECK (withdrawal_fee >= 0),
  amount_received INTEGER NOT NULL DEFAULT 0 CHECK (amount_received >= 0),
  FOREIGN KEY (user_id) REFERENCES wallet_accounts(user_id)
);

INSERT INTO wallet_transactions_payment_methods_down SELECT id, user_id, type, amount, phone_number, payment_method, status, provider, provider_reference, internal_reference, failure_reason, approved_by, approved_at, rejection_reason, created_at, updated_at, completed_at, withdrawal_fee, amount_received FROM wallet_transactions;
DROP TABLE wallet_transactions;
ALTER TABLE wallet_transactions_payment_methods_down RENAME TO wallet_transactions;
CREATE INDEX wallet_transactions_user_created_idx ON wallet_transactions(user_id, created_at DESC);
CREATE INDEX wallet_transactions_status_type_idx ON wallet_transactions(status, type);
CREATE INDEX wallet_transactions_provider_reference_idx ON wallet_transactions(provider_reference);
PRAGMA foreign_keys = ON;
