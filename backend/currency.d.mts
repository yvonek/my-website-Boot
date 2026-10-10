export interface SupportedCountry {
  countryCode: 'RW' | 'BI' | 'UG';
  countryName: string;
  phonePrefix: string;
  currencyCode: 'RWF' | 'BIF' | 'UGX';
}

export const supportedCountries: SupportedCountry[];

export function normalizeCountryPhone(
  value: unknown,
  defaultCountryCode?: string,
): { phoneNumber: string; countryCode: string; currencyCode: string } | null;

export function convertRwfToLocal(amountRwf: number, unitsPerRwf: number): number;

export function convertLocalToRwf(amountLocal: number, unitsPerRwf: number): number;