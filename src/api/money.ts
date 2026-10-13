import type { CountryCode, CurrencyCode } from './types';

const phoneRules: Record<CountryCode, { prefix: string; nationalPhone: RegExp }> = {
  RW: { prefix: '250', nationalPhone: /^7\d{8}$/ },
  BI: { prefix: '257', nationalPhone: /^[67]\d{7}$/ },
  UG: { prefix: '256', nationalPhone: /^7\d{8}$/ },
};

export function formatCurrencyAmount(amount: number, currencyCode: CurrencyCode = 'RWF') {
  return `${Number(amount ?? 0).toLocaleString()} ${currencyCode}`;
}

const trc20AddressPattern = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

export function isValidTrc20Address(value: string) {
  return trc20AddressPattern.test(String(value ?? '').trim());
}

// unitsPerUsdt = local currency units per 1 USDT. Returns 0 when the rate is not configured.
export function usdtAmount(localAmount: number, unitsPerUsdt: number) {
  if (!Number.isFinite(unitsPerUsdt) || unitsPerUsdt <= 0 || !Number.isFinite(localAmount)) return 0;
  return Math.round((Number(localAmount) / unitsPerUsdt) * 100) / 100;
}

// Admin USDT fee: deposits pay more USDT, withdrawals send less USDT.
export function applyUsdtFee(usdt: number, feePercent: number, direction: 'deposit' | 'withdrawal') {
  if (!Number.isFinite(usdt)) return 0;
  const pct = Number.isFinite(feePercent) ? feePercent : 0;
  const factor = direction === 'deposit' ? 1 + pct / 100 : 1 - pct / 100;
  return Math.max(0, Math.round(usdt * factor * 100) / 100);
}

export function convertCurrencyAmount(amount: number, sourceUnitsPerRwf: number, targetUnitsPerRwf: number) {
  if (!Number.isFinite(sourceUnitsPerRwf) || sourceUnitsPerRwf <= 0 || !Number.isFinite(targetUnitsPerRwf) || targetUnitsPerRwf <= 0) throw new Error('Positive exchange rates are required.');
  return Math.round(Math.round(Number(amount) / sourceUnitsPerRwf) * targetUnitsPerRwf);
}

export function isValidCountryPhone(value: string, countryCode: CountryCode = 'RW') {
  const rules = phoneRules[countryCode];
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith(rules.prefix)) digits = digits.slice(rules.prefix.length);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  return rules.nationalPhone.test(digits);
}