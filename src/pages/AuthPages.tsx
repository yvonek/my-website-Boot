import { Button, Field, Input, MessageBar, MessageBarBody } from '@fluentui/react-components';
import { EyeOffRegular, EyeRegular, GiftRegular, LockClosedRegular, PersonAddRegular, PersonRegular, PhoneRegular } from '@fluentui/react-icons';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api';
import { isValidCountryPhone } from '../api/money';
import type { AuthCountryOption, AuthUser, CountryCode } from '../api/types';

const countryFlags: Record<CountryCode, string> = { RW: '/assets/flags/rw.svg', BI: '/assets/flags/bi.svg', UG: '/assets/flags/ug.svg' };
const fallbackAuthCountries: AuthCountryOption[] = [
  { countryCode: 'RW', countryName: 'Rwanda', phonePrefix: '+250', currencyCode: 'RWF', enabled: true },
  { countryCode: 'BI', countryName: 'Burundi', phonePrefix: '+257', currencyCode: 'BIF', enabled: true },
  { countryCode: 'UG', countryName: 'Uganda', phonePrefix: '+256', currencyCode: 'UGX', enabled: true },
];

function useAuthCountries(mode: 'register' | 'login') {
  const [countries, setCountries] = useState<AuthCountryOption[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>('RW');
  const [loadingCountries, setLoadingCountries] = useState(true);
  const [countryError, setCountryError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/countries?mode=${mode}`).then(async (response) => {
      const body = await response.json() as { countries: AuthCountryOption[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Countries could not be loaded.');
      if (cancelled) return;
      setCountries(body.countries);
      setSelectedCountry((current) => body.countries.some((country) => country.countryCode === current) ? current : body.countries[0]?.countryCode ?? 'RW');
    }).catch(() => {
      if (cancelled) return;
      setCountries(fallbackAuthCountries);
      setCountryError('Live country settings are unavailable. Showing the supported countries.');
    })
      .finally(() => { if (!cancelled) setLoadingCountries(false); });
    return () => { cancelled = true; };
  }, [mode]);

  return { countries, selectedCountry, setSelectedCountry, loadingCountries, countryError };
}

function AuthFrame({ mode, children }: { mode: 'register' | 'login'; children: ReactNode }) {
  const registering = mode === 'register';
  return <main className="auth-page"><div className="auth-shade" /><section className="auth-card"><div className="auth-mark" aria-hidden="true"><span>✦</span></div><h1>{registering ? <>Create <em>Your Account</em></> : <>Welcome <em>Back</em></>}</h1><p className="auth-subtitle">{registering ? 'Join us and start your journey.' : 'Sign in to continue to your account.'}</p>{children}<p className="auth-switch">{registering ? 'Already have an account?' : "Don't have an account?"} <a href={registering ? '/login' : '/register'}>{registering ? 'Login' : 'Create Account'}</a></p></section></main>;
}

function IconField({ icon, children }: { icon: ReactNode; children: ReactNode }) { return <span className="auth-input-wrap"><span className="auth-input-icon">{icon}</span>{children}</span>; }

function CountryPhoneFields({ countries, selectedCountry, onCountryChange, phoneNumber, onPhoneChange }: { countries: AuthCountryOption[]; selectedCountry: CountryCode; onCountryChange: (countryCode: CountryCode) => void; phoneNumber: string; onPhoneChange: (phoneNumber: string) => void }) {
  const country = countries.find((option) => option.countryCode === selectedCountry);
  const placeholder = selectedCountry === 'BI' ? '06XXXXXXX or 07XXXXXXX' : '07XXXXXXXX';
  return <>
    <Field label="Country"><span className="auth-country-picker"><span className="auth-country-flag"><img src={countryFlags[country?.countryCode ?? 'RW']} alt="" /></span><select aria-label="Country" className="auth-country-select" value={selectedCountry} onChange={(event) => onCountryChange(event.currentTarget.value as CountryCode)}>{countries.map((option) => <option key={option.countryCode} value={option.countryCode}>{option.countryName} ({option.phonePrefix}){!option.enabled ? ' · Existing accounts' : ''}</option>)}</select></span></Field>
    <Field label="Phone Number"><IconField icon={<PhoneRegular />}><span className="auth-phone-prefix">{country?.phonePrefix ?? ''}</span><Input autoComplete="tel-national" inputMode="tel" value={phoneNumber} onChange={(_: unknown, data: { value: string }) => onPhoneChange(data.value)} placeholder={placeholder} /></IconField></Field>
  </>;
}

export function RegisterPage({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState(() => new URLSearchParams(window.location.search).get('ref') ?? '');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { countries, selectedCountry, setSelectedCountry, loadingCountries, countryError } = useAuthCountries('register');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('');
    if (!fullName.trim()) { setError('Enter your full name.'); return; }
    if (!isValidCountryPhone(phoneNumber, selectedCountry)) { setError(`Enter a valid ${selectedCountry} phone number.`); return; }
    if (!/^\d{6}$/.test(password)) { setError('Password must contain exactly 6 digits.'); return; }
    setLoading(true);
    try { const result = await api.register({ fullName: fullName.trim(), phoneNumber, countryCode: selectedCountry, password, referralCode: referralCode.trim() || undefined }); onAuthenticated(result.user); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Account creation failed.'); }
    finally { setLoading(false); }
  };

  return <AuthFrame mode="register"><form className="auth-form" onSubmit={submit}>
    <Field label="Full Name"><IconField icon={<PersonRegular />}><Input autoComplete="name" value={fullName} onChange={(_: unknown, data: { value: string }) => { setFullName(data.value); setError(''); }} placeholder="Your full name" /></IconField></Field>
    <CountryPhoneFields countries={countries} selectedCountry={selectedCountry} onCountryChange={(countryCode) => { setSelectedCountry(countryCode); setPhoneNumber(''); setError(''); }} phoneNumber={phoneNumber} onPhoneChange={(value) => { setPhoneNumber(value); setError(''); }} />
    <Field label="Password (6 digits)"><IconField icon={<LockClosedRegular />}><Input autoComplete="new-password" inputMode="numeric" type={showPassword ? 'text' : 'password'} maxLength={6} value={password} onChange={(_: unknown, data: { value: string }) => { setPassword(data.value.replace(/\D/g, '').slice(0, 6)); setError(''); }} placeholder="6-digit password" /><button className="auth-password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOffRegular /> : <EyeRegular />}</button></IconField></Field>
    <Field label="Referral Code (optional)"><IconField icon={<GiftRegular />}><Input autoComplete="off" value={referralCode} onChange={(_: unknown, data: { value: string }) => { setReferralCode(data.value); setError(''); }} placeholder="Referral code" /></IconField></Field>
    {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
    {countryError && <MessageBar intent="warning"><MessageBarBody>{countryError}</MessageBarBody></MessageBar>}
    {!loadingCountries && !countries.length && <MessageBar intent="error"><MessageBarBody>No countries are currently available for registration.</MessageBarBody></MessageBar>}
    <Button className="auth-submit" type="submit" appearance="primary" icon={<PersonAddRegular />} disabled={loading || loadingCountries || !countries.length}>{loading ? 'Creating Account...' : 'Create Account'}</Button>
  </form></AuthFrame>;
}

export function LoginPage({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { countries, selectedCountry, setSelectedCountry, loadingCountries, countryError } = useAuthCountries('login');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('');
    if (!isValidCountryPhone(phoneNumber, selectedCountry)) { setError(`Enter a valid ${selectedCountry} phone number.`); return; }
    if (!/^\d{6}$/.test(password)) { setError('Password must contain exactly 6 digits.'); return; }
    setLoading(true);
    try { const result = await api.login({ phoneNumber, countryCode: selectedCountry, password }); onAuthenticated(result.user); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Login failed.'); }
    finally { setLoading(false); }
  };

  return <AuthFrame mode="login"><form className="auth-form" onSubmit={submit}>
    <CountryPhoneFields countries={countries} selectedCountry={selectedCountry} onCountryChange={(countryCode) => { setSelectedCountry(countryCode); setPhoneNumber(''); setError(''); }} phoneNumber={phoneNumber} onPhoneChange={(value) => { setPhoneNumber(value); setError(''); }} />
    <Field label="Password"><IconField icon={<LockClosedRegular />}><Input autoComplete="current-password" inputMode="numeric" type={showPassword ? 'text' : 'password'} maxLength={6} value={password} onChange={(_: unknown, data: { value: string }) => { setPassword(data.value.replace(/\D/g, '').slice(0, 6)); setError(''); }} placeholder="6-digit password" /><button className="auth-password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOffRegular /> : <EyeRegular />}</button></IconField></Field>
    {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
    {countryError && <MessageBar intent="warning"><MessageBarBody>{countryError}</MessageBarBody></MessageBar>}
    {!loadingCountries && !countries.length && <MessageBar intent="error"><MessageBarBody>No country is available for sign-in.</MessageBarBody></MessageBar>}
    <Button className="auth-submit" type="submit" appearance="primary" disabled={loading || loadingCountries || !countries.length}>{loading ? 'Signing In...' : 'Login'}</Button>
  </form></AuthFrame>;
}
