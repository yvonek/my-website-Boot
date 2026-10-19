BEGIN;

ALTER TABLE gift_codes ADD COLUMN IF NOT EXISTS reward_tiers JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE gift_code_redemptions ADD COLUMN IF NOT EXISTS reward_amount INTEGER NOT NULL DEFAULT 0 CHECK (reward_amount >= 0);

UPDATE gift_codes
SET reward_tiers = jsonb_build_array(jsonb_build_object('users', max_uses, 'rewardAmount', amount))
WHERE reward_tiers = '[]'::jsonb;

UPDATE gift_code_redemptions r
SET reward_amount = c.amount
FROM gift_codes c
WHERE c.id = r.code_id AND r.reward_amount = 0;

INSERT INTO app_schema_migrations (version, source)
VALUES (27, 'manual-neon-027_gift_code_tiers')
ON CONFLICT (version) DO NOTHING;

COMMIT;