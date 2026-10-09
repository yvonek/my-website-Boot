import type { CountryCode, CurrencyCode } from './types';

const phoneRules: Record<CountryCode, { prefix: string; nationalPhone: RegExp }> = {
  RW: { prefix: '250', nationalPhone: /^7\d{8}$/ },
  BI: { prefix: '257', nationalPhone: /^[67]\d{7}$/ },
  UG: { prefix: '256', nationalPhone: /^7\d{8}$/ },
};

export function formatCurrencyAmount(amount: number, currencyCode: CurrencyCode = 'RWF') {
  return `${Number(amount ?? 0).toLocaleString()} ${currencyCode}`;
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