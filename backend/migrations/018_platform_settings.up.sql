ALTER TABLE users ADD COLUMN welcome_bonus_amount INTEGER NOT NULL DEFAULT 0 CHECK (welcome_bonus_amount >= 0);
ALTER TABLE users ADD COLUMN welcome_bonus_awarded_at TEXT;
ALTER TABLE wallet_transactions ADD COLUMN reserved_amount INTEGER NOT NULL DEFAULT 0 CHECK (reserved_amount >= 0);

UPDATE wallet_transactions
SET reserved_amount = amount + withdrawal_fee
WHERE type = 'WITHDRAWAL' AND status = 'PENDING';

INSERT OR IGNORE INTO support_settings (key, value)
VALUES ('welcome_bonus_enabled', '1'), ('welcome_bonus_amount', '7000');
