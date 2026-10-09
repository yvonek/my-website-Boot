UPDATE country_settings
SET units_per_rwf = CASE country_code
      WHEN 'BI' THEN 2.03
      WHEN 'UG' THEN 2.69
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE units_per_rwf = 0 AND country_code IN ('BI', 'UG');

CREATE TRIGGER country_settings_positive_rate_insert
BEFORE INSERT ON country_settings
WHEN NEW.enabled = 1 AND NEW.units_per_rwf <= 0
BEGIN
  SELECT RAISE(ABORT, 'Enabled countries require a positive exchange rate.');
END;

CREATE TRIGGER country_settings_positive_rate_update
BEFORE UPDATE OF enabled, units_per_rwf ON country_settings
WHEN NEW.enabled = 1 AND NEW.units_per_rwf <= 0
BEGIN
  SELECT RAISE(ABORT, 'Enabled countries require a positive exchange rate.');
END;

ALTER TABLE deposit_methods ADD COLUMN cross_border_enabled INTEGER NOT NULL DEFAULT 0 CHECK (cross_border_enabled IN (0, 1));
ALTER TABLE deposit_methods ADD COLUMN receiving_country_code TEXT NOT NULL DEFAULT 'RW' CHECK (receiving_country_code IN ('RW', 'BI', 'UG'));
UPDATE deposit_methods SET receiving_country_code = country_code;

CREATE TRIGGER deposit_method_receiving_rate_insert
BEFORE INSERT ON deposit_methods
WHEN NEW.cross_border_enabled = 1 AND NOT EXISTS (
  SELECT 1 FROM country_settings
  WHERE country_code = NEW.receiving_country_code AND units_per_rwf > 0
)
BEGIN
  SELECT RAISE(ABORT, 'Cross-border deposits require a configured receiving-country exchange rate.');
END;

CREATE TRIGGER deposit_method_receiving_rate_update
BEFORE UPDATE OF cross_border_enabled, receiving_country_code ON deposit_methods
WHEN NEW.cross_border_enabled = 1 AND NOT EXISTS (
  SELECT 1 FROM country_settings
  WHERE country_code = NEW.receiving_country_code AND units_per_rwf > 0
)
BEGIN
  SELECT RAISE(ABORT, 'Cross-border deposits require a configured receiving-country exchange rate.');
END;

CREATE TRIGGER country_settings_preserve_receiving_rate
BEFORE UPDATE OF units_per_rwf ON country_settings
WHEN NEW.units_per_rwf <= 0 AND EXISTS (
  SELECT 1 FROM deposit_methods
  WHERE enabled = 1 AND cross_border_enabled = 1 AND receiving_country_code = NEW.country_code
)
BEGIN
  SELECT RAISE(ABORT, 'An active cross-border deposit method requires a positive receiving-country exchange rate.');
END;

ALTER TABLE wallet_transactions ADD COLUMN deposit_receiving_country_code TEXT CHECK (deposit_receiving_country_code IN ('RW', 'BI', 'UG'));
ALTER TABLE wallet_transactions ADD COLUMN deposit_receiving_currency_code TEXT CHECK (deposit_receiving_currency_code IN ('RWF', 'BIF', 'UGX'));
ALTER TABLE wallet_transactions ADD COLUMN deposit_receiving_exchange_rate REAL CHECK (deposit_receiving_exchange_rate > 0);
ALTER TABLE wallet_transactions ADD COLUMN deposit_payment_amount INTEGER CHECK (deposit_payment_amount >= 0);