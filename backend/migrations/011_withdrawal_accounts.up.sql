CREATE TABLE withdrawal_accounts (
  user_id TEXT PRIMARY KEY NOT NULL,
  account_holder_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('MTN_MOMO', 'AIRTEL_MONEY')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
