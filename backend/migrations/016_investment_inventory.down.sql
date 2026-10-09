UPDATE plans SET sold_slots = 0;

ALTER TABLE product_purchases DROP COLUMN total_slots_snapshot;
ALTER TABLE product_purchases DROP COLUMN purchase_bonus_snapshot;
ALTER TABLE product_purchases DROP COLUMN duration_days_snapshot;
ALTER TABLE product_purchases DROP COLUMN daily_income_snapshot;
ALTER TABLE product_purchases DROP COLUMN image_snapshot;
ALTER TABLE product_purchases DROP COLUMN description_snapshot;
ALTER TABLE product_purchases DROP COLUMN product_id;

ALTER TABLE plans DROP COLUMN sold_slots;
ALTER TABLE plans DROP COLUMN total_slots;
ALTER TABLE plans DROP COLUMN purchase_bonus;
ALTER TABLE plans DROP COLUMN duration_days;
ALTER TABLE plans DROP COLUMN daily_income;
ALTER TABLE plans DROP COLUMN price;
ALTER TABLE plans DROP COLUMN image_data;
ALTER TABLE plans DROP COLUMN description;
