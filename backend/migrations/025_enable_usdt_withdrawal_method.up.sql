-- USDT (TRC20) was seeded with withdrawal_methods.enabled = 0, which hid it from every
-- customer and blocked wallet binding even when a country enabled it and set a USDT rate.
-- The per-country switch (country_withdrawal_methods.enabled) remains the real control.
UPDATE withdrawal_methods SET enabled = 1 WHERE code = 'USDT_TRC20';
