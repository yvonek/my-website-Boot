ALTER TABLE wallet_transactions ADD COLUMN withdrawal_fee INTEGER NOT NULL DEFAULT 0 CHECK (withdrawal_fee >= 0);
ALTER TABLE wallet_transactions ADD COLUMN amount_received INTEGER NOT NULL DEFAULT 0 CHECK (amount_received >= 0);
