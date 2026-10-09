ALTER TABLE users ADD COLUMN welcome_bonus_unlocked_at TEXT;
ALTER TABLE product_purchases ADD COLUMN idempotency_key TEXT;

UPDATE users
SET welcome_bonus_unlocked_at = welcome_bonus_awarded_at
WHERE welcome_bonus_awarded_at IS NOT NULL;

CREATE UNIQUE INDEX product_purchases_idempotency_idx
ON product_purchases(user_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;
CREATE INDEX referral_relationships_sponsor_idx
ON referral_relationships(sponsor_user_id);
