ALTER TABLE users ADD COLUMN country_code TEXT NOT NULL DEFAULT 'RW' CHECK (country_code IN ('RW', 'BI', 'UG'));
ALTER TABLE users ADD COLUMN currency_code TEXT NOT NULL DEFAULT 'RWF' CHECK (currency_code IN ('RWF', 'BIF', 'UGX'));

UPDATE users
SET country_code = CASE
      WHEN phone_number LIKE '+257%' THEN 'BI'
      WHEN phone_number LIKE '+256%' THEN 'UG'
      ELSE 'RW'
    END,
    currency_code = CASE
      WHEN phone_number LIKE '+257%' THEN 'BIF'
      WHEN phone_number LIKE '+256%' THEN 'UGX'
      ELSE 'RWF'
    END;

CREATE TABLE country_settings (
  country_code TEXT PRIMARY KEY NOT NULL CHECK (country_code IN ('RW', 'BI', 'UG')),
  country_name TEXT NOT NULL,
  phone_prefix TEXT NOT NULL,
  currency_code TEXT NOT NULL CHECK (currency_code IN ('RWF', 'BIF', 'UGX')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  units_per_rwf REAL NOT NULL DEFAULT 0 CHECK (units_per_rwf >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO country_settings (country_code, country_name, phone_prefix, currency_code, enabled, units_per_rwf)
VALUES ('RW', 'Rwanda', '+250', 'RWF', 1, 1),
       ('BI', 'Burundi', '+257', 'BIF', 0, 0),
       ('UG', 'Uganda', '+256', 'UGX', 0, 0);

ALTER TABLE deposit_methods ADD COLUMN country_code TEXT NOT NULL DEFAULT 'RW' CHECK (country_code IN ('RW', 'BI', 'UG'));

CREATE TABLE country_withdrawal_methods (
  country_code TEXT NOT NULL CHECK (country_code IN ('RW', 'BI', 'UG')),
  method_code TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (country_code, method_code),
  FOREIGN KEY (country_code) REFERENCES country_settings(country_code) ON DELETE CASCADE,
  FOREIGN KEY (method_code) REFERENCES withdrawal_methods(code) ON DELETE CASCADE
);

INSERT INTO country_withdrawal_methods (country_code, method_code, enabled)
SELECT 'RW', code, enabled FROM withdrawal_methods;

ALTER TABLE wallet_transactions ADD COLUMN country_code TEXT NOT NULL DEFAULT 'RW' CHECK (country_code IN ('RW', 'BI', 'UG'));
ALTER TABLE wallet_transactions ADD COLUMN currency_code TEXT NOT NULL DEFAULT 'RWF' CHECK (currency_code IN ('RWF', 'BIF', 'UGX'));
ALTER TABLE wallet_transactions ADD COLUMN exchange_rate REAL NOT NULL DEFAULT 1 CHECK (exchange_rate > 0);
ALTER TABLE wallet_transactions ADD COLUMN display_amount INTEGER NOT NULL DEFAULT 0 CHECK (display_amount >= 0);
ALTER TABLE wallet_transactions ADD COLUMN display_fee INTEGER NOT NULL DEFAULT 0 CHECK (display_fee >= 0);
ALTER TABLE wallet_transactions ADD COLUMN display_amount_received INTEGER NOT NULL DEFAULT 0 CHECK (display_amount_received >= 0);

UPDATE wallet_transactions
SET country_code = coalesce((SELECT country_code FROM users WHERE users.id = wallet_transactions.user_id), 'RW'),
    currency_code = coalesce((SELECT currency_code FROM users WHERE users.id = wallet_transactions.user_id), 'RWF'),
    display_amount = amount,
    display_fee = withdrawal_fee,
    display_amount_received = amount_received;

ALTER TABLE product_purchases ADD COLUMN country_code TEXT NOT NULL DEFAULT 'RW' CHECK (country_code IN ('RW', 'BI', 'UG'));
ALTER TABLE product_purchases ADD COLUMN currency_code TEXT NOT NULL DEFAULT 'RWF' CHECK (currency_code IN ('RWF', 'BIF', 'UGX'));
ALTER TABLE product_purchases ADD COLUMN exchange_rate REAL NOT NULL DEFAULT 1 CHECK (exchange_rate > 0);
ALTER TABLE product_purchases ADD COLUMN display_amount INTEGER NOT NULL DEFAULT 0 CHECK (display_amount >= 0);

UPDATE product_purchases
SET country_code = coalesce((SELECT country_code FROM users WHERE users.id = product_purchases.user_id), 'RW'),
    currency_code = coalesce((SELECT currency_code FROM users WHERE users.id = product_purchases.user_id), 'RWF'),
    display_amount = qualifying_amount;

ALTER TABLE commission_ledger ADD COLUMN country_code TEXT NOT NULL DEFAULT 'RW' CHECK (country_code IN ('RW', 'BI', 'UG'));
ALTER TABLE commission_ledger ADD COLUMN currency_code TEXT NOT NULL DEFAULT 'RWF' CHECK (currency_code IN ('RWF', 'BIF', 'UGX'));
ALTER TABLE commission_ledger ADD COLUMN exchange_rate REAL NOT NULL DEFAULT 1 CHECK (exchange_rate > 0);
ALTER TABLE commission_ledger ADD COLUMN display_qualifying_amount INTEGER NOT NULL DEFAULT 0 CHECK (display_qualifying_amount >= 0);
ALTER TABLE commission_ledger ADD COLUMN display_commission_amount INTEGER NOT NULL DEFAULT 0 CHECK (display_commission_amount >= 0);

UPDATE commission_ledger
SET country_code = coalesce((SELECT country_code FROM users WHERE users.id = commission_ledger.beneficiary_user_id), 'RW'),
    currency_code = coalesce((SELECT currency_code FROM users WHERE users.id = commission_ledger.beneficiary_user_id), 'RWF'),
    display_qualifying_amount = qualifying_amount,
    display_commission_amount = commission_amount;

ALTER TABLE product_income_ledger ADD COLUMN country_code TEXT NOT NULL DEFAULT 'RW' CHECK (country_code IN ('RW', 'BI', 'UG'));
ALTER TABLE product_income_ledger ADD COLUMN currency_code TEXT NOT NULL DEFAULT 'RWF' CHECK (currency_code IN ('RWF', 'BIF', 'UGX'));
ALTER TABLE product_income_ledger ADD COLUMN exchange_rate REAL NOT NULL DEFAULT 1 CHECK (exchange_rate > 0);
ALTER TABLE product_income_ledger ADD COLUMN display_amount INTEGER NOT NULL DEFAULT 0 CHECK (display_amount >= 0);

UPDATE product_income_ledger
SET country_code = coalesce((SELECT country_code FROM users WHERE users.id = product_income_ledger.user_id), 'RW'),
    currency_code = coalesce((SELECT currency_code FROM users WHERE users.id = product_income_ledger.user_id), 'RWF'),
    display_amount = amount;

UPDATE support_settings SET value = '7500', updated_at = CURRENT_TIMESTAMP WHERE key = 'welcome_bonus_amount' AND value = '7000';

CREATE TRIGGER wallet_transactions_currency_snapshot
AFTER INSERT ON wallet_transactions
BEGIN
  UPDATE wallet_transactions
  SET country_code = coalesce((SELECT country_code FROM users WHERE id = NEW.user_id), 'RW'),
      currency_code = coalesce((SELECT currency_code FROM users WHERE id = NEW.user_id), 'RWF'),
      exchange_rate = coalesce((SELECT units_per_rwf FROM country_settings WHERE country_code = (SELECT country_code FROM users WHERE id = NEW.user_id)), 1),
      display_amount = round(NEW.amount * coalesce((SELECT units_per_rwf FROM country_settings WHERE country_code = (SELECT country_code FROM users WHERE id = NEW.user_id)), 1)),
      display_fee = round(NEW.withdrawal_fee * coalesce((SELECT units_per_rwf FROM country_settings WHERE country_code = (SELECT country_code FROM users WHERE id = NEW.user_id)), 1)),
      display_amount_received = round(NEW.amount_received * coalesce((SELECT units_per_rwf FROM country_settings WHERE country_code = (SELECT country_code FROM users WHERE id = NEW.user_id)), 1))
  WHERE id = NEW.id;
END;

CREATE TRIGGER commission_ledger_currency_snapshot
AFTER INSERT ON commission_ledger
BEGIN
  UPDATE commission_ledger
  SET country_code = coalesce((SELECT country_code FROM users WHERE id = NEW.beneficiary_user_id), 'RW'),
      currency_code = coalesce((SELECT currency_code FROM users WHERE id = NEW.beneficiary_user_id), 'RWF'),
      exchange_rate = coalesce((SELECT units_per_rwf FROM country_settings WHERE country_code = (SELECT country_code FROM users WHERE id = NEW.beneficiary_user_id)), 1),
      display_qualifying_amount = round(NEW.qualifying_amount * coalesce((SELECT units_per_rwf FROM country_settings WHERE country_code = (SELECT country_code FROM users WHERE id = NEW.beneficiary_user_id)), 1)),
      display_commission_amount = round(NEW.commission_amount * coalesce((SELECT units_per_rwf FROM country_settings WHERE country_code = (SELECT country_code FROM users WHERE id = NEW.beneficiary_user_id)), 1))
  WHERE id = NEW.id;
END;

CREATE TRIGGER product_income_ledger_currency_snapshot
AFTER INSERT ON product_income_ledger
BEGIN
  UPDATE product_income_ledger
  SET country_code = coalesce((SELECT country_code FROM users WHERE id = NEW.user_id), 'RW'),
      currency_code = coalesce((SELECT currency_code FROM users WHERE id = NEW.user_id), 'RWF'),
      exchange_rate = coalesce((SELECT units_per_rwf FROM country_settings WHERE country_code = (SELECT country_code FROM users WHERE id = NEW.user_id)), 1),
      display_amount = round(NEW.amount * coalesce((SELECT units_per_rwf FROM country_settings WHERE country_code = (SELECT country_code FROM users WHERE id = NEW.user_id)), 1))
  WHERE id = NEW.id;
END;