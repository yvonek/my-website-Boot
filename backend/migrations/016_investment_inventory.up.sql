ALTER TABLE plans ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE plans ADD COLUMN image_data TEXT;
ALTER TABLE plans ADD COLUMN price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0);
ALTER TABLE plans ADD COLUMN daily_income INTEGER NOT NULL DEFAULT 0 CHECK (daily_income >= 0);
ALTER TABLE plans ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 0 CHECK (duration_days >= 0);
ALTER TABLE plans ADD COLUMN purchase_bonus INTEGER NOT NULL DEFAULT 0 CHECK (purchase_bonus >= 0);
ALTER TABLE plans ADD COLUMN total_slots INTEGER NOT NULL DEFAULT 0 CHECK (total_slots >= 0);
ALTER TABLE plans ADD COLUMN sold_slots INTEGER NOT NULL DEFAULT 0 CHECK (sold_slots >= 0);

UPDATE plans
SET description = note,
    price = CAST(REPLACE(REPLACE(REPLACE(deposited, ',', ''), ' RWF', ''), ' FRW', '') AS INTEGER),
    daily_income = CAST(REPLACE(REPLACE(REPLACE(income_per_day, ',', ''), ' RWF', ''), ' FRW', '') AS INTEGER),
    duration_days = CAST(term AS INTEGER);

ALTER TABLE product_purchases ADD COLUMN product_id TEXT;
ALTER TABLE product_purchases ADD COLUMN description_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE product_purchases ADD COLUMN image_snapshot TEXT;
ALTER TABLE product_purchases ADD COLUMN daily_income_snapshot INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_purchases ADD COLUMN duration_days_snapshot INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_purchases ADD COLUMN purchase_bonus_snapshot INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_purchases ADD COLUMN total_slots_snapshot INTEGER NOT NULL DEFAULT 0;

UPDATE product_purchases
SET product_id = product_name,
    description_snapshot = coalesce((SELECT description FROM plans WHERE plans.name = product_purchases.product_name), ''),
    image_snapshot = (SELECT image_data FROM plans WHERE plans.name = product_purchases.product_name),
    daily_income_snapshot = coalesce((SELECT daily_income FROM plans WHERE plans.name = product_purchases.product_name), 0),
    duration_days_snapshot = coalesce((SELECT duration_days FROM plans WHERE plans.name = product_purchases.product_name), 0),
    purchase_bonus_snapshot = coalesce((SELECT purchase_bonus FROM plans WHERE plans.name = product_purchases.product_name), 0),
    total_slots_snapshot = coalesce((SELECT total_slots FROM plans WHERE plans.name = product_purchases.product_name), 0);

UPDATE plans
SET sold_slots = (
  SELECT count(*) FROM product_purchases
  WHERE product_purchases.product_name = plans.name
    AND product_purchases.status IN ('PENDING', 'APPROVED', 'COMPLETED')
);