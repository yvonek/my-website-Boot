import { describe, expect, it } from 'vitest';
import { isValidTrc20Address, usdtAmount } from '../api/money';

describe('isValidTrc20Address', () => {
  it('accepts a well-formed TRC20 address', () => {
    expect(isValidTrc20Address('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(true);
  });

  it('rejects addresses that do not start with T', () => {
    expect(isValidTrc20Address('AR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(false);
  });

  it('rejects addresses with the wrong length', () => {
    expect(isValidTrc20Address('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6')).toBe(false);
    expect(isValidTrc20Address('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6tX')).toBe(false);
  });

  it('rejects characters outside the base58 alphabet', () => {
    expect(isValidTrc20Address('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj0t')).toBe(false);
    expect(isValidTrc20Address('')).toBe(false);
  });
});

describe('usdtAmount', () => {
  it('converts local units into USDT rounded to 2 decimals', () => {
    expect(usdtAmount(10000, 2500)).toBe(4);
    expect(usdtAmount(1000, 3000)).toBe(0.33);
  });

  it('returns 0 for a missing or invalid rate', () => {
    expect(usdtAmount(1000, 0)).toBe(0);
    expect(usdtAmount(1000, -1)).toBe(0);
    expect(usdtAmount(1000, Number.NaN)).toBe(0);
  });

  it('returns 0 for a non-finite amount', () => {
    expect(usdtAmount(Number.NaN, 2500)).toBe(0);
  });
});
