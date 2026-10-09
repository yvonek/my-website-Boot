DROP TRIGGER IF EXISTS wallet_transactions_currency_snapshot;
DROP TRIGGER IF EXISTS commission_ledger_currency_snapshot;
DROP TRIGGER IF EXISTS product_income_ledger_currency_snapshot;
DROP TABLE IF EXISTS country_withdrawal_methods;
DROP TABLE IF EXISTS country_settings;

ALTER TABLE product_income_ledger DROP COLUMN display_amount;
ALTER TABLE product_income_ledger DROP COLUMN exchange_rate;
ALTER TABLE product_income_ledger DROP COLUMN currency_code;
ALTER TABLE product_income_ledger DROP COLUMN country_code;

ALTER TABLE commission_ledger DROP COLUMN display_commission_amount;
ALTER TABLE commission_ledger DROP COLUMN display_qualifying_amount;
ALTER TABLE commission_ledger DROP COLUMN exchange_rate;
ALTER TABLE commission_ledger DROP COLUMN currency_code;
ALTER TABLE commission_ledger DROP COLUMN country_code;

ALTER TABLE product_purchases DROP COLUMN display_amount;
ALTER TABLE product_purchases DROP COLUMN exchange_rate;
ALTER TABLE product_purchases DROP COLUMN currency_code;
ALTER TABLE product_purchases DROP COLUMN country_code;

ALTER TABLE wallet_transactions DROP COLUMN display_amount_received;
ALTER TABLE wallet_transactions DROP COLUMN display_fee;
ALTER TABLE wallet_transactions DROP COLUMN display_amount;
ALTER TABLE wallet_transactions DROP COLUMN exchange_rate;
ALTER TABLE wallet_transactions DROP COLUMN currency_code;
ALTER TABLE wallet_transactions DROP COLUMN country_code;

ALTER TABLE deposit_methods DROP COLUMN country_code;
ALTER TABLE users DROP COLUMN currency_code;
ALTER TABLE users DROP COLUMN country_code;