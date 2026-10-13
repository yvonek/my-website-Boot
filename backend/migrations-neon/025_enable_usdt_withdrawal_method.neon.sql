-- USDT (TRC20) withdrawal method global switch for the Neon (Postgres) database.
-- Mirrors backend/migrations/025_enable_usdt_withdrawal_method.up.sql. NOT applied automatically.
-- Apply manually to Neon after review. Per-country enablement stays in country_withdrawal_methods.

BEGIN;

UPDATE withdrawal_methods SET enabled = 1 WHERE code = 'USDT_TRC20';

COMMIT;
