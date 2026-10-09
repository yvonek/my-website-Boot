import { Button, Card, Field, Input, MessageBar, MessageBarBody, Text, Title1 } from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';

type CountryCode = 'RW' | 'BI' | 'UG';
interface CountryMethod { code: string; name: string; enabled: boolean; }
interface CountrySetting { countryCode: CountryCode; countryName: string; phonePrefix: string; currencyCode: 'RWF' | 'BIF' | 'UGX'; enabled: boolean; unitsPerRwf: number; depositMethods: CountryMethod[]; withdrawalMethods: CountryMethod[]; }

export function AdminCountrySettingsPage() {
  const [countries, setCountries] = useState<CountrySetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<CountryCode | null>(null);
  const [message, setMessage] = useState('');

  const loadCountries = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/countries');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Country settings could not be loaded.');
      setCountries(body.countries.map((country: CountrySetting) => ({ ...country, enabled: Boolean(country.enabled), withdrawalMethods: country.withdrawalMethods.map((method) => ({ ...method, enabled: Boolean(method.enabled) })) })));
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Country settings could not be loaded.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadCountries(); }, []);

  const updateCountry = (countryCode: CountryCode, update: Partial<CountrySetting>) => {
    setCountries((current) => current.map((country) => country.countryCode === countryCode ? { ...country, ...update } : country));
  };

  const updateWithdrawalMethod = (countryCode: CountryCode, methodCode: string, enabled: boolean) => {
    setCountries((current) => current.map((country) => country.countryCode === countryCode ? { ...country, withdrawalMethods: country.withdrawalMethods.map((method) => method.code === methodCode ? { ...method, enabled } : method) } : country));
  };

  const saveCountry = async (country: CountrySetting) => {
    const unitsPerRwf = Number(country.unitsPerRwf);
    if (!Number.isFinite(unitsPerRwf) || country.enabled && unitsPerRwf <= 0 || country.countryCode === 'RW' && unitsPerRwf !== 1) {
      setMessage(country.countryCode === 'RW' ? 'Rwanda must remain exactly 1 RWF per RWF.' : 'Set a positive exchange rate before enabling this country.');
      return;
    }
    setSaving(country.countryCode);
    setMessage('');
    try {
      const response = await fetch(`/api/admin/countries/${country.countryCode}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: country.enabled, unitsPerRwf: Number(country.unitsPerRwf), withdrawalMethods: country.withdrawalMethods.filter((method) => method.enabled).map((method) => method.code) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Country settings could not be saved.');
      setMessage(`${country.countryName} settings saved.`);
      await loadCountries();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Country settings could not be saved.'); }
    finally { setSaving(null); }
  };

  return <section className="admin-console-section admin-country-settings">
    <div className="admin-console-heading"><div><Text className="home-kicker">LOCALIZATION</Text><Title1>Countries and currencies</Title1></div><Text className="admin-console-greeting">Three supported countries</Text></div>
    <Text className="muted">Enabled countries appear on Create Account. Existing account countries remain available on Login.</Text>
    {message && <MessageBar intent="info"><MessageBarBody>{message}</MessageBarBody></MessageBar>}
    {loading ? <Text className="muted">Loading country settings...</Text> : <div className="admin-country-grid">{countries.map((country) => <Card className="admin-country-card" key={country.countryCode}>
      <div className="admin-country-card__heading"><div><strong>{country.countryName}</strong><span>{country.countryCode} · {country.phonePrefix} · {country.currencyCode}</span></div><label className="deposit-admin-status"><input type="checkbox" checked={country.enabled} onChange={(event) => updateCountry(country.countryCode, { enabled: event.currentTarget.checked })} /><span>{country.enabled ? 'Enabled' : 'Disabled'}</span></label></div>
      <Field label={`Currency units per 1 RWF (${country.currencyCode})`}><Input type="number" min={country.countryCode === 'RW' ? 1 : country.enabled ? 0.000001 : 0} step="0.000001" value={String(country.unitsPerRwf)} disabled={country.countryCode === 'RW'} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => updateCountry(country.countryCode, { unitsPerRwf: Number(value.value || 0) })} /></Field>
      <div className="admin-country-deposits"><strong>Deposit methods</strong>{country.depositMethods.length ? country.depositMethods.map((method) => <span key={method.code}>{method.name} · {method.enabled ? 'Active' : 'Inactive'}</span>) : <span>None configured</span>}<a href="/admin/settings">Manage Deposit methods</a></div>
      <div className="admin-country-withdrawals"><strong>Withdrawal methods</strong>{country.withdrawalMethods.map((method) => <label className="admin-toggle" key={method.code}><input type="checkbox" checked={method.enabled} onChange={(event) => updateWithdrawalMethod(country.countryCode, method.code, event.currentTarget.checked)} /><span>{method.name}</span></label>)}</div>
      <Button appearance="primary" disabled={saving === country.countryCode} onClick={() => void saveCountry(country)}>{saving === country.countryCode ? 'Saving...' : 'Save country settings'}</Button>
    </Card>)}</div>}
  </section>;
}
