ALTER TABLE gift_codes ADD COLUMN reward_tiers TEXT NOT NULL DEFAULT '[]';
ALTER TABLE gift_code_redemptions ADD COLUMN reward_amount INTEGER NOT NULL DEFAULT 0 CHECK (reward_amount >= 0);

UPDATE gift_codes
SET reward_tiers = json_array(json_object('users', max_uses, 'rewardAmount', amount))
WHERE reward_tiers = '[]';

UPDATE gift_code_redemptions
SET reward_amount = (SELECT amount FROM gift_codes WHERE gift_codes.id = gift_code_redemptions.code_id)
WHERE reward_amount = 0;