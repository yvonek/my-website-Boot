DELETE FROM withdrawal_accounts WHERE payment_method = 'USDT_TRC20';
DELETE FROM country_withdrawal_methods WHERE method_code = 'USDT_TRC20';
DELETE FROM withdrawal_methods WHERE code = 'USDT_TRC20';

CREATE TABLE withdrawal_accounts_previous (
  user_id TEXT PRIMARY KEY NOT NULL,
  account_holder_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('MTN_MOMO', 'AIRTEL_MONEY')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO withdrawal_accounts_previous (user_id, account_holder_name, phone_number, payment_method, created_at, updated_at)
SELECT user_id, account_holder_name, phone_number, payment_method, created_at, updated_at FROM withdrawal_accounts;

DROP TABLE withdrawal_accounts;
ALTER TABLE withdrawal_accounts_previous RENAME TO withdrawal_accounts;

ALTER TABLE wallet_transactions DROP COLUMN crypto_address;
ALTER TABLE wallet_transactions DROP COLUMN crypto_units_per_usdt;
ALTER TABLE wallet_transactions DROP COLUMN crypto_amount;
ALTER TABLE wallet_transactions DROP COLUMN crypto_network;
ALTER TABLE deposit_methods DROP COLUMN crypto_network;
ALTER TABLE country_settings DROP COLUMN units_per_usdt;
