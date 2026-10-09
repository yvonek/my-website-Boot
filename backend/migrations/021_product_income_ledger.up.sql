CREATE TABLE product_income_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  purchase_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  income_day INTEGER NOT NULL CHECK (income_day > 0),
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (purchase_id, income_day),
  FOREIGN KEY (purchase_id) REFERENCES product_purchases(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES wallet_accounts(user_id) ON DELETE CASCADE
);

CREATE INDEX product_income_ledger_user_created_idx
ON product_income_ledger(user_id, created_at DESC);