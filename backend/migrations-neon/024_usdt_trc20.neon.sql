-- USDT (TRC20) withdrawals and deposits for the Neon (Postgres) database.
-- Mirrors backend/migrations/024_usdt_trc20.up.sql. NOT applied automatically.
-- Apply manually to Neon after review. Idempotent where practical.
-- units_per_usdt = local currency units per 1 USDT (0 means not configured).

BEGIN;

ALTER TABLE country_settings ADD COLUMN IF NOT EXISTS units_per_usdt NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE country_settings DROP CONSTRAINT IF EXISTS country_settings_units_per_usdt_check;
ALTER TABLE country_settings ADD CONSTRAINT country_settings_units_per_usdt_check CHECK (units_per_usdt >= 0);

ALTER TABLE deposit_methods ADD COLUMN IF NOT EXISTS crypto_network TEXT NOT NULL DEFAULT '';
ALTER TABLE deposit_methods DROP CONSTRAINT IF EXISTS deposit_methods_crypto_network_check;
ALTER TABLE deposit_methods ADD CONSTRAINT deposit_methods_crypto_network_check CHECK (crypto_network IN ('', 'TRC20'));

ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS crypto_network TEXT NOT NULL DEFAULT '';
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS crypto_amount NUMERIC;
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS crypto_units_per_usdt NUMERIC;
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS crypto_address TEXT;
ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_crypto_network_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_crypto_network_check CHECK (crypto_network IN ('', 'TRC20'));
ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_crypto_amount_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_crypto_amount_check CHECK (crypto_amount IS NULL OR crypto_amount >= 0);
ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_crypto_units_per_usdt_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_crypto_units_per_usdt_check CHECK (crypto_units_per_usdt IS NULL OR crypto_units_per_usdt > 0);

-- Fractional deposit amounts (local currency converted at the receiving rate) need NUMERIC.
ALTER TABLE wallet_transactions ALTER COLUMN deposit_payment_amount TYPE NUMERIC USING deposit_payment_amount::numeric;

INSERT INTO withdrawal_methods (code, name, enabled, provider)
VALUES ('USDT_TRC20', 'USDT (TRC20)', 0, 'ADMIN_REVIEW')
ON CONFLICT (code) DO NOTHING;

INSERT INTO country_withdrawal_methods (country_code, method_code, enabled)
SELECT country_code, 'USDT_TRC20', 0 FROM country_settings
ON CONFLICT (country_code, method_code) DO NOTHING;

-- withdrawal_accounts: wallet_address for USDT, phone for mobile money.
-- Constraint names on this table are not known in advance, so drop every CHECK constraint first.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'withdrawal_accounts'::regclass AND contype = 'c' LOOP
    EXECUTE format('ALTER TABLE withdrawal_accounts DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE withdrawal_accounts ADD COLUMN IF NOT EXISTS wallet_address TEXT NOT NULL DEFAULT '';
ALTER TABLE withdrawal_accounts ADD CONSTRAINT withdrawal_accounts_payment_method_check
  CHECK (payment_method IN ('MTN_MOMO', 'AIRTEL_MONEY', 'USDT_TRC20'));
ALTER TABLE withdrawal_accounts ADD CONSTRAINT withdrawal_accounts_details_check
  CHECK (
    (payment_method = 'USDT_TRC20' AND wallet_address <> '')
    OR (payment_method <> 'USDT_TRC20' AND phone_number <> '')
  );

INSERT INTO app_schema_migrations (version, source)
VALUES (24, 'manual-neon-024_usdt_trc20')
ON CONFLICT (version) DO NOTHING;

COMMIT;
