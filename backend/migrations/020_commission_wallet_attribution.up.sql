ALTER TABLE commission_ledger ADD COLUMN credited_at TEXT;
ALTER TABLE wallet_transactions ADD COLUMN commission_amount INTEGER NOT NULL DEFAULT 0 CHECK (commission_amount >= 0);

UPDATE wallet_accounts
SET available_balance = available_balance + coalesce((
  SELECT sum(commission_amount) FROM commission_ledger
  WHERE commission_ledger.beneficiary_user_id = wallet_accounts.user_id AND commission_ledger.status = 'APPROVED'
), 0), updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM commission_ledger
  WHERE commission_ledger.beneficiary_user_id = wallet_accounts.user_id AND commission_ledger.status = 'APPROVED'
);

UPDATE commission_ledger SET credited_at = CURRENT_TIMESTAMP WHERE status = 'APPROVED';
CREATE INDEX commission_ledger_credit_status_idx ON commission_ledger(beneficiary_user_id, status, credited_at);
