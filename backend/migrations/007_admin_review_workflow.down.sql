PRAGMA foreign_keys = OFF;

CREATE TABLE wallet_transactions_admin_review_down (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAWAL')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  withdrawal_fee INTEGER NOT NULL DEFAULT 0 CHECK (withdrawal_fee >= 0),
  amount_received INTEGER NOT NULL DEFAULT 0 CHECK (amount_received >= 0),
  sender_name TEXT NOT NULL DEFAULT '',
  receiver_name TEXT NOT NULL DEFAULT '',
  phone_number TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('MTN_MOMO', 'AIRTEL_MONEY')),
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
  FOREIGN KEY (user_id) REFERENCES wallet_accounts(user_id)
);

INSERT INTO wallet_transactions_admin_review_down SELECT id, user_id, type, amount, withdrawal_fee, amount_received, sender_name, receiver_name, phone_number, payment_method, CASE WHEN status IN ('APPROVED', 'AWAITING_PAYOUT', 'PROCESSING') THEN 'PENDING' ELSE status END, provider, provider_reference, internal_reference, failure_reason, approved_by, approved_at, rejection_reason, created_at, updated_at, completed_at FROM wallet_transactions;
DROP TABLE wallet_transactions;
ALTER TABLE wallet_transactions_admin_review_down RENAME TO wallet_transactions;
PRAGMA foreign_keys = ON;
