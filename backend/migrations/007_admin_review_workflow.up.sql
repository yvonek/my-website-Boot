CREATE TABLE wallet_transactions_admin_review (
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
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'AWAITING_PAYOUT', 'PROCESSING', 'SUCCESS', 'REJECTED', 'FAILED', 'CANCELLED')),
  provider TEXT NOT NULL DEFAULT 'ADMIN_REVIEW',
  provider_reference TEXT UNIQUE,
  internal_reference TEXT NOT NULL UNIQUE,
  failure_reason TEXT,
  approved_by TEXT,
  approved_at TEXT,
  rejected_by TEXT,
  rejected_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES wallet_accounts(user_id)
);
INSERT INTO wallet_transactions_admin_review SELECT id, user_id, type, amount, withdrawal_fee, amount_received, sender_name, receiver_name, phone_number, payment_method, CASE WHEN status = 'SUCCESS' THEN 'SUCCESS' WHEN status = 'REJECTED' THEN 'REJECTED' WHEN status = 'FAILED' THEN 'FAILED' ELSE 'PENDING' END, 'ADMIN_REVIEW', provider_reference, internal_reference, failure_reason, approved_by, approved_at, NULL, NULL, rejection_reason, created_at, updated_at, completed_at FROM wallet_transactions;
CREATE TABLE wallet_audit_logs_admin_review (id TEXT PRIMARY KEY NOT NULL, transaction_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, details TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
INSERT INTO wallet_audit_logs_admin_review SELECT id, transaction_id, actor_id, action, details, created_at FROM wallet_audit_logs;
DROP TABLE wallet_audit_logs;
DROP TABLE wallet_transactions;
ALTER TABLE wallet_transactions_admin_review RENAME TO wallet_transactions;
ALTER TABLE wallet_audit_logs_admin_review RENAME TO wallet_audit_logs;
CREATE TABLE wallet_audit_logs_fk (id TEXT PRIMARY KEY NOT NULL, transaction_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, details TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (transaction_id) REFERENCES wallet_transactions(id));
INSERT INTO wallet_audit_logs_fk SELECT id, transaction_id, actor_id, action, details, created_at FROM wallet_audit_logs;
DROP TABLE wallet_audit_logs;
ALTER TABLE wallet_audit_logs_fk RENAME TO wallet_audit_logs;
CREATE INDEX wallet_transactions_user_created_idx ON wallet_transactions(user_id, created_at DESC);
CREATE INDEX wallet_transactions_status_type_idx ON wallet_transactions(status, type);
CREATE INDEX wallet_transactions_provider_reference_idx ON wallet_transactions(provider_reference);
CREATE INDEX wallet_audit_logs_transaction_idx ON wallet_audit_logs(transaction_id);
