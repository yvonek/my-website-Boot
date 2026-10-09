DROP INDEX IF EXISTS product_purchases_idempotency_idx;
DROP INDEX IF EXISTS referral_relationships_sponsor_idx;
ALTER TABLE product_purchases DROP COLUMN idempotency_key;
ALTER TABLE users DROP COLUMN welcome_bonus_unlocked_at;
