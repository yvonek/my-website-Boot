-- USDT (TRC20) withdrawals and deposits.
-- units_per_usdt = local currency units per 1 USDT (0 means not configured).

ALTER TABLE country_settings ADD COLUMN units_per_usdt REAL NOT NULL DEFAULT 0 CHECK (units_per_usdt >= 0);

ALTER TABLE deposit_methods ADD COLUMN crypto_network TEXT NOT NULL DEFAULT '' CHECK (crypto_network IN ('', 'TRC20'));

ALTER TABLE wallet_transactions ADD COLUMN crypto_network TEXT NOT NULL DEFAULT '' CHECK (crypto_network IN ('', 'TRC20'));
ALTER TABLE wallet_transactions ADD COLUMN crypto_amount REAL CHECK (crypto_amount IS NULL OR crypto_amount >= 0);
ALTER TABLE wallet_transactions ADD COLUMN crypto_units_per_usdt REAL CHECK (crypto_units_per_usdt IS NULL OR crypto_units_per_usdt > 0);
ALTER TABLE wallet_transactions ADD COLUMN crypto_address TEXT;

INSERT OR IGNORE INTO withdrawal_methods (code, name, enabled, provider) VALUES ('USDT_TRC20', 'USDT (TRC20)', 0, 'ADMIN_REVIEW');
INSERT OR IGNORE INTO country_withdrawal_methods (country_code, method_code, enabled)
SELECT country_code, 'USDT_TRC20', 0 FROM country_settings;

-- Rebuild withdrawal_accounts: phone is optional for USDT, wallet_address is required for USDT.
CREATE TABLE withdrawal_accounts_next (
  user_id TEXT PRIMARY KEY NOT NULL,
  account_holder_name TEXT NOT NULL,
  phone_number TEXT NOT NULL DEFAULT '',
  wallet_address TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('MTN_MOMO', 'AIRTEL_MONEY', 'USDT_TRC20')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (payment_method = 'USDT_TRC20' AND wallet_address <> '')
    OR (payment_method <> 'USDT_TRC20' AND phone_number <> '')
  ),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO withdrawal_accounts_next (user_id, account_holder_name, phone_number, wallet_address, payment_method, created_at, updated_at)
SELECT user_id, account_holder_name, phone_number, '', payment_method, created_at, updated_at FROM withdrawal_accounts;

DROP TABLE withdrawal_accounts;
ALTER TABLE withdrawal_accounts_next RENAME TO withdrawal_accounts;
