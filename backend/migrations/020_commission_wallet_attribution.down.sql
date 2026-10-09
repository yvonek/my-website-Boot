DROP INDEX IF EXISTS commission_ledger_credit_status_idx;
ALTER TABLE wallet_transactions DROP COLUMN commission_amount;
ALTER TABLE commission_ledger DROP COLUMN credited_at;
