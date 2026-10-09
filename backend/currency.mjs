export const supportedCountries = [
  { countryCode: 'RW', countryName: 'Rwanda', phonePrefix: '+250', currencyCode: 'RWF' },
  { countryCode: 'BI', countryName: 'Burundi', phonePrefix: '+257', currencyCode: 'BIF' },
  { countryCode: 'UG', countryName: 'Uganda', phonePrefix: '+256', currencyCode: 'UGX' },
];

const countryByCode = new Map(supportedCountries.map((country) => [country.countryCode, country]));
const localMobilePattern = {
  RW: /^7\d{8}$/,
  BI: /^[67]\d{7}$/,
  UG: /^7\d{8}$/,
};

export function normalizeCountryPhone(value, defaultCountryCode = 'RW') {
  const raw = String(value ?? '').trim().replace(/[\s()-]/g, '');
  if (!raw) return null;
  const hasInternationalPrefix = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  let country = null;
  let national = '';

  for (const candidate of supportedCountries) {
    const prefix = candidate.phonePrefix.slice(1);
    if ((hasInternationalPrefix || digits.startsWith(prefix)) && digits.startsWith(prefix)) {
      country = candidate;
      national = digits.slice(prefix.length);
      break;
    }
  }

  if (!country) {
    country = countryByCode.get(defaultCountryCode);
    if (!country) return null;
    national = digits.startsWith('0') ? digits.slice(1) : digits;
  }

  if (!localMobilePattern[country.countryCode].test(national)) return null;
  return { phoneNumber: `${country.phonePrefix}${national}`, countryCode: country.countryCode, currencyCode: country.currencyCode };
}

export function convertRwfToLocal(amountRwf, unitsPerRwf) {
  if (!Number.isFinite(unitsPerRwf) || unitsPerRwf <= 0) throw new Error('A positive exchange rate is required.');
  return Math.round(Number(amountRwf) * unitsPerRwf);
}

export function convertLocalToRwf(amountLocal, unitsPerRwf) {
  if (!Number.isFinite(unitsPerRwf) || unitsPerRwf <= 0) throw new Error('A positive exchange rate is required.');
  return Math.round(Number(amountLocal) / unitsPerRwf);
}