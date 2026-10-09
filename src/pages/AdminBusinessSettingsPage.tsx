import { Button, Card, Field, Input, MessageBar, MessageBarBody, Text, Textarea, Title1, Title2 } from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { DepositPaymentMethod } from '../api/types';

const maximumMethods = 4;
type DepositMethodDraft = Omit<DepositPaymentMethod, 'id'> & { id: string };
interface CountrySetting { countryCode: 'RW' | 'BI' | 'UG'; countryName: string; phonePrefix: string; currencyCode: 'RWF' | 'BIF' | 'UGX'; enabled: boolean; unitsPerRwf: number; depositMethods: { code: string; name: string; enabled: boolean }[]; withdrawalMethods: { code: string; name: string; enabled: boolean }[]; }

const emptyMethod = (countryCode: 'RW' | 'BI' | 'UG' = 'RW'): DepositMethodDraft => ({ id: '', name: '', accountName: '', accountNumber: '', instructions: '', ussdTemplate: '', minimumAmount: 1, maximumAmount: 1000000, logoData: null, enabled: false, position: 0, countryCode, crossBorderEnabled: false, receivingCountryCode: countryCode });
function readLogo(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read logo.')); reader.onerror = () => reject(new Error('Could not read logo.')); reader.readAsDataURL(file); }); }

export function AdminBusinessSettingsPage({ sessionAdmin = false, section = 'all' }: { sessionAdmin?: boolean; section?: 'all' | 'rewards' | 'promoters' | 'settings' }) {
  const [token, setToken] = useState('');
  const [levels, setLevels] = useState([1, 2, 3].map((level) => ({ level, percentage: '0' })));
  const [methods, setMethods] = useState<DepositMethodDraft[]>([]);
  const [draft, setDraft] = useState<DepositMethodDraft | null>(null);
  const [selectedDepositCountry, setSelectedDepositCountry] = useState<'RW' | 'BI' | 'UG'>('RW');
  const [countries, setCountries] = useState<CountrySetting[]>([]);
  const [countrySaving, setCountrySaving] = useState('');
  const [message, setMessage] = useState('');
  const [methodsLoading, setMethodsLoading] = useState(false);
  const [checkinEnabled, setCheckinEnabled] = useState(false);
  const [checkinReward, setCheckinReward] = useState('');
  const [checkinSaving, setCheckinSaving] = useState(false);
  const [platformSettingsLoading, setPlatformSettingsLoading] = useState(false);
  const [platformSettingsSaving, setPlatformSettingsSaving] = useState(false);
  const [withdrawalFeeEnabled, setWithdrawalFeeEnabled] = useState(false);
  const [withdrawalFeeType, setWithdrawalFeeType] = useState<'PERCENTAGE' | 'FIXED'>('PERCENTAGE');
  const [withdrawalFeeValue, setWithdrawalFeeValue] = useState('0');
  const [welcomeBonusEnabled, setWelcomeBonusEnabled] = useState(false);
  const [welcomeBonusAmount, setWelcomeBonusAmount] = useState('0');
  const [telegramUrl, setTelegramUrl] = useState('');
  const [telegramPopupMessage, setTelegramPopupMessage] = useState('');
  const [supportEmail, setSupportEmail] = useState('');
  const [supportLiveChatEnabled, setSupportLiveChatEnabled] = useState(false);
  const [supportSettingsSaving, setSupportSettingsSaving] = useState(false);
  const [adminPhone, setAdminPhone] = useState('');
  const [adminRoleSaving, setAdminRoleSaving] = useState(false);
  const headers = () => ({ 'Content-Type': 'application/json', ...(!sessionAdmin && token ? { 'x-admin-token': token } : {}) });

  const load = async () => {
    const response = await fetch('/api/admin/referral-settings', { headers: headers() }); const body = await response.json();
    if (!response.ok) { setMessage(body.error ?? 'Admin request failed.'); return; }
    setLevels(body.settings.map((item: { level: number; percentage: number }) => ({ level: item.level, percentage: String(item.percentage) })));
    setMessage('');
  };

  const loadMethods = async () => {
    setMethodsLoading(true);
    try {
      const response = await fetch('/api/admin/deposit-methods', { headers: headers() }); const body = await response.json();
      if (!response.ok) { setMessage(body.error ?? 'Deposit payment methods could not be loaded.'); return; }
      setMethods(body.methods); setMessage('');
    } catch { setMessage('Deposit payment methods could not be loaded.'); }
    finally { setMethodsLoading(false); }
  };

  const loadCountries = async () => {
    try {
      const response = await fetch('/api/admin/countries', { headers: headers() });
      const body = await response.json();
      if (!response.ok) { setMessage(body.error ?? 'Country settings could not be loaded.'); return; }
      setCountries(body.countries.map((country: CountrySetting) => ({ ...country, enabled: Boolean(country.enabled), withdrawalMethods: country.withdrawalMethods.map((method) => ({ ...method, enabled: Boolean(method.enabled) })) })));
    } catch { setMessage('Country settings could not be loaded.'); }
  };

  const saveCountry = async (country: CountrySetting) => {
    setCountrySaving(country.countryCode);
    try {
      const response = await fetch(`/api/admin/countries/${country.countryCode}`, { method: 'PUT', headers: headers(), body: JSON.stringify({ enabled: country.enabled, unitsPerRwf: Number(country.unitsPerRwf), withdrawalMethods: country.withdrawalMethods.filter((method) => method.enabled).map((method) => method.code) }) });
      const body = await response.json();
      if (!response.ok) { setMessage(body.error ?? 'Country settings could not be saved.'); return; }
      setMessage(`${country.countryName} settings saved.`);
      await loadCountries();
    } catch { setMessage('Country settings could not be saved.'); }
    finally { setCountrySaving(''); }
  };

  const loadDailyCheckin = async () => {
    const response = await fetch('/api/admin/daily-checkin', { headers: headers() });
    const body = await response.json();
    if (!response.ok) { setMessage(body.error ?? 'Daily check-in settings could not be loaded.'); return; }
    setCheckinEnabled(body.enabled);
    setCheckinReward(String(body.rewardAmount));
  };

  const loadPlatformSettings = async () => {
    setPlatformSettingsLoading(true);
    try {
      const response = await fetch('/api/admin/platform-settings', { headers: headers() });
      const body = await response.json();
      if (!response.ok) { setMessage(body.error ?? 'Platform settings could not be loaded.'); return; }
      setWithdrawalFeeEnabled(body.withdrawalFeeEnabled);
      setWithdrawalFeeType(body.withdrawalFeeType);
      setWithdrawalFeeValue(String(body.withdrawalFeeValue));
      setWelcomeBonusEnabled(body.welcomeBonusEnabled);
      setWelcomeBonusAmount(String(body.welcomeBonusAmount));
    } catch { setMessage('Platform settings could not be loaded.'); }
    finally { setPlatformSettingsLoading(false); }
  };

  const loadSupportSettings = async () => {
    try {
      const response = await fetch('/api/admin/support/settings', { headers: headers() });
      const body = await response.json();
      if (!response.ok) { setMessage(body.error ?? 'Support settings could not be loaded.'); return; }
      setTelegramUrl(body.telegramUrl ?? '');
      setTelegramPopupMessage(body.telegramPopupMessage ?? '');
      setSupportEmail(body.supportEmail ?? '');
      setSupportLiveChatEnabled(Boolean(body.liveChatEnabled));
    } catch { setMessage('Support settings could not be loaded.'); }
  };

  const saveSupportSettings = async () => {
    setSupportSettingsSaving(true);
    try {
      const response = await fetch('/api/admin/support/settings', { method: 'PUT', headers: headers(), body: JSON.stringify({ telegramUrl, telegramPopupMessage, supportEmail, liveChatEnabled: supportLiveChatEnabled }) });
      const body = await response.json();
      if (!response.ok) { setMessage(body.error ?? 'Support settings could not be saved.'); return; }
      setTelegramUrl(body.telegramUrl);
      setTelegramPopupMessage(body.telegramPopupMessage);
      setSupportEmail(body.supportEmail);
      setMessage('Telegram and support contact settings saved.');
    } catch { setMessage('Support settings could not be saved.'); }
    finally { setSupportSettingsSaving(false); }
  };

  const savePlatformSettings = async () => {
    setPlatformSettingsSaving(true);
    try {
      const response = await fetch('/api/admin/platform-settings', {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({
          withdrawalFeeEnabled,
          withdrawalFeeType,
          withdrawalFeeValue: Number(withdrawalFeeValue || 0),
          welcomeBonusEnabled,
          welcomeBonusAmount: Number(welcomeBonusAmount || 0),
        }),
      });
      const body = await response.json();
      if (!response.ok) { setMessage(body.error ?? 'Platform settings could not be saved.'); return; }
      setMessage('Platform settings saved.');
      setWithdrawalFeeEnabled(body.withdrawalFeeEnabled);
      setWithdrawalFeeType(body.withdrawalFeeType);
      setWithdrawalFeeValue(String(body.withdrawalFeeValue));
      setWelcomeBonusEnabled(body.welcomeBonusEnabled);
      setWelcomeBonusAmount(String(body.welcomeBonusAmount));
    } catch { setMessage('Platform settings could not be saved.'); }
    finally { setPlatformSettingsSaving(false); }
  };

  const saveDailyCheckin = async () => {
    setCheckinSaving(true);
    try {
      const response = await fetch('/api/admin/daily-checkin', { method: 'PUT', headers: headers(), body: JSON.stringify({ enabled: checkinEnabled, rewardAmount: Number(checkinReward) }) });
      const body = await response.json();
      setMessage(response.ok ? 'Daily check-in settings saved.' : body.error ?? 'Daily check-in settings could not be saved.');
    } catch { setMessage('Daily check-in settings could not be saved.'); }
    finally { setCheckinSaving(false); }
  };

  const grantAdminRole = async () => {
    setAdminRoleSaving(true);
    try {
      const response = await fetch('/api/admin/members/role', { method: 'PUT', headers: headers(), body: JSON.stringify({ phoneNumber: adminPhone, role: 'ADMIN' }) });
      const body = await response.json();
      setMessage(response.ok ? 'Admin access granted. Sign out, then sign in with this phone number and password.' : body.error ?? 'Admin access could not be granted.');
      if (response.ok) setAdminPhone('');
    } catch { setMessage('Admin access could not be granted.'); }
    finally { setAdminRoleSaving(false); }
  };

  const saveLevel = async (level: number, percentage: string) => { const value = Number(percentage); if (!Number.isFinite(value) || value < 0 || value > 100) { setMessage('Commission percentage must be between 0 and 100.'); return; } const response = await fetch('/api/admin/referral-settings', { method: 'POST', headers: headers(), body: JSON.stringify({ level, percentage: value }) }); const body = await response.json(); setMessage(response.ok ? 'Referral setting saved.' : body.error); };

  const saveMethod = async (method: DepositMethodDraft, isNew: boolean) => {
    const response = await fetch(isNew ? '/api/admin/deposit-methods' : `/api/admin/deposit-methods/${encodeURIComponent(method.id)}`, { method: isNew ? 'POST' : 'PUT', headers: headers(), body: JSON.stringify(method) });
    const body = await response.json();
    if (!response.ok) { setMessage(body.error ?? 'Deposit method could not be saved.'); return; }
    setDraft(null); setMessage('Deposit payment method saved.'); await loadMethods();
  };

  const deleteMethod = async (method: DepositMethodDraft) => {
    const response = await fetch(`/api/admin/deposit-methods/${encodeURIComponent(method.id)}`, { method: 'DELETE', headers: headers() }); const body = await response.json();
    if (!response.ok) { setMessage(body.error ?? 'Deposit method could not be deleted.'); return; }
    setMessage('Deposit payment method deleted.'); await loadMethods();
  };

  useEffect(() => { if (token || sessionAdmin) { void load(); void loadMethods(); void loadDailyCheckin(); if (section === 'settings') { void loadPlatformSettings(); void loadSupportSettings(); void loadCountries(); } } else { setMethods([]); setCountries([]); setMessage(''); } }, [token, sessionAdmin]);

  const methodEditor = (method: DepositMethodDraft, isNew: boolean) => {
    const setField = <K extends keyof DepositMethodDraft>(key: K, value: DepositMethodDraft[K]) => {
      const next = { ...method, [key]: value };
      if (isNew) setDraft(next); else setMethods((current) => current.map((item) => item.id === method.id ? next : item));
    };
    return <Card className="deposit-admin-method" key={isNew ? 'new-method' : method.id}>
      <div className="deposit-admin-method__top"><div><Text weight="semibold">{isNew ? 'New payment method' : method.name || 'Payment method'}</Text><Text className="muted">Deposit methods only · separate from withdrawal providers</Text></div><label className="deposit-admin-status"><input type="checkbox" checked={method.enabled} onChange={(event) => setField('enabled', event.currentTarget.checked)} /><span>{method.enabled ? 'Active' : 'Inactive'}</span></label></div>
      <div className="deposit-admin-fields">
        <Field label="Available to users in"><select value={method.countryCode ?? 'RW'} onChange={(event) => { const countryCode = event.currentTarget.value as 'RW' | 'BI' | 'UG'; const next = { ...method, countryCode, ...(!method.crossBorderEnabled ? { receivingCountryCode: countryCode } : {}) }; if (isNew) setDraft(next); else setMethods((current) => current.map((item) => item.id === method.id ? next : item)); }}>{countries.map((country) => <option key={country.countryCode} value={country.countryCode}>{country.countryName} · {country.currencyCode}</option>)}</select></Field>
        <label className="admin-toggle"><input type="checkbox" checked={Boolean(method.crossBorderEnabled)} onChange={(event) => setField('crossBorderEnabled', event.currentTarget.checked)} /><span>Cross-border deposits (enable only when provider confirms support)</span></label>
        {method.crossBorderEnabled && <Field label="Receiving account country"><select value={method.receivingCountryCode ?? method.countryCode ?? 'RW'} onChange={(event) => setField('receivingCountryCode', event.currentTarget.value as 'RW' | 'BI' | 'UG')}>{countries.map((country) => <option key={country.countryCode} value={country.countryCode}>{country.countryName} · {country.currencyCode}</option>)}</select></Field>}
        <Field label="Payment method name"><Input value={method.name} onChange={(_: ChangeEvent<HTMLInputElement>, data: { value: string }) => setField('name', data.value)} placeholder="e.g. MTN Mobile Money" /></Field>
        <Field label="Account / merchant name"><Input value={method.accountName} onChange={(_: ChangeEvent<HTMLInputElement>, data: { value: string }) => setField('accountName', data.value)} placeholder="Business or account name" /></Field>
        <Field label="Account / merchant number"><Input value={method.accountNumber} onChange={(_: ChangeEvent<HTMLInputElement>, data: { value: string }) => setField('accountNumber', data.value)} placeholder="Payment account number" /></Field>
        <Field label="Minimum deposit (FRW)"><Input type="number" min="0" value={String(method.minimumAmount)} onChange={(_: ChangeEvent<HTMLInputElement>, data: { value: string }) => setField('minimumAmount', Number(data.value || 0))} /></Field>
        <Field label="Maximum deposit (FRW)"><Input type="number" min="1" value={String(method.maximumAmount)} onChange={(_: ChangeEvent<HTMLInputElement>, data: { value: string }) => setField('maximumAmount', Number(data.value || 0))} /></Field>
        <Field label="Instructions (optional)"><Textarea resize="vertical" value={method.instructions} onChange={(_: ChangeEvent<HTMLTextAreaElement>, data: { value: string }) => setField('instructions', data.value)} placeholder="Payment reference or other directions" /></Field>
        <Field label="USSD pay template (optional)"><Input value={method.ussdTemplate} onChange={(_: ChangeEvent<HTMLInputElement>, data: { value: string }) => setField('ussdTemplate', data.value)} placeholder="*182*1*1*{number}*{amount}#" /><Text className="muted">Use {'{number}'} for the merchant number and optionally {'{amount}'} or {'{frw}'} to include the entered deposit amount.</Text></Field>
        <Field label="Logo / icon (optional)"><input className="deposit-admin-logo-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => { const file = event.currentTarget.files?.[0]; if (!file) return; if (file.size > 128 * 1024) { setMessage('Logo must be 128 KB or smaller.'); return; } try { setField('logoData', await readLogo(file)); } catch { setMessage('Logo could not be read.'); } }} />{method.logoData && <div className="deposit-admin-logo-preview"><img src={method.logoData} alt="Payment method logo preview" /><Button appearance="subtle" onClick={() => setField('logoData', null)}>Remove logo</Button></div>}</Field>
      </div>
      <div className="deposit-admin-method__actions"><Button appearance="primary" onClick={() => void saveMethod(method, isNew)}>{isNew ? 'Add method' : 'Save changes'}</Button>{!isNew && <Button appearance="secondary" onClick={() => void deleteMethod(method)}>Delete</Button>}{isNew && <Button appearance="secondary" onClick={() => setDraft(null)}>Cancel</Button>}</div>
    </Card>;
  };

  const showMethods = section === 'all' || section === 'settings';
  const showCheckin = section === 'all' || section === 'rewards';
  const showReferrals = section === 'all' || section === 'promoters';
  const visibleMethods = methods.filter((method) => (method.countryCode ?? 'RW') === selectedDepositCountry);
  return <div className="page-stack admin-settings-page">{!sessionAdmin && <><div className="page-intro"><Text className="hero-eyebrow">Admin only</Text><Title1>Business settings</Title1><Text className="muted">Configure referral percentages and deposit payment methods independently from withdrawal providers.</Text><a className="admin-page-link" href="/admin/transactions">Open transaction review</a></div>
    <Card className="admin-auth-card"><Field label="Admin API token"><Input type="password" value={token} onChange={(_: ChangeEvent<HTMLInputElement>, data: { value: string }) => setToken(data.value)} placeholder="Enter admin token" /></Field><Button appearance="primary" onClick={() => { void load(); void loadMethods(); void loadDailyCheckin(); }}>Load settings</Button></Card><Card className="admin-bootstrap-card"><Title2>Phone login access</Title2><Text className="muted">Grant the Admin role to an existing account. That person will use their phone number and password to sign in to the Admin console.</Text><div><Field label="Account phone number"><Input type="tel" value={adminPhone} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setAdminPhone(value.value)} placeholder="07XXXXXXXX" /></Field><Button appearance="secondary" disabled={!token || !adminPhone || adminRoleSaving} onClick={() => void grantAdminRole()}>{adminRoleSaving ? 'Updating...' : 'Grant Admin role'}</Button></div></Card></>}
    {message && <MessageBar intent="info"><MessageBarBody>{message}</MessageBarBody></MessageBar>}
    {section === 'settings' && <section className="platform-settings-section"><div className="deposit-admin-section__heading"><div><Text className="home-kicker">GLOBAL CONFIGURATION</Text><Title2>Platform settings</Title2><Text className="muted">Changes apply to eligible new accounts and future withdrawal requests.</Text></div>{platformSettingsLoading && <Text className="muted">Loading settings...</Text>}</div><div className="platform-settings-grid"><Card className="settings-card platform-setting-card"><div><Text className="home-kicker">ACCOUNT</Text><Title2>Welcome bonus</Title2></div><label className="deposit-admin-status"><input type="checkbox" checked={welcomeBonusEnabled} onChange={(event) => setWelcomeBonusEnabled(event.currentTarget.checked)} /><span>{welcomeBonusEnabled ? 'Enabled for new accounts' : 'Disabled'}</span></label><Field label="Welcome bonus amount (RWF)"><Input type="number" min="0" step="1" value={welcomeBonusAmount} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setWelcomeBonusAmount(value.value)} /></Field><Text className="muted">Awarded once during registration. Existing accounts and product purchase bonuses are not changed.</Text><Button appearance="primary" disabled={platformSettingsLoading || platformSettingsSaving} onClick={() => void savePlatformSettings()}>{platformSettingsSaving ? 'Saving...' : 'Save settings'}</Button></Card><Card className="settings-card platform-setting-card"><div><Text className="home-kicker">PAYOUTS</Text><Title2>Withdrawal fee</Title2></div><label className="deposit-admin-status"><input type="checkbox" checked={withdrawalFeeEnabled} onChange={(event) => setWithdrawalFeeEnabled(event.currentTarget.checked)} /><span>{withdrawalFeeEnabled ? 'Fee enabled' : 'Fee disabled'}</span></label><Field label="Fee type"><select value={withdrawalFeeType} onChange={(event) => setWithdrawalFeeType(event.currentTarget.value as 'PERCENTAGE' | 'FIXED')}><option value="PERCENTAGE">Percentage</option><option value="FIXED">Fixed amount</option></select></Field><Field label={withdrawalFeeType === 'PERCENTAGE' ? 'Fee value (%)' : 'Fee value (RWF)'}><Input type="number" min="0" max={withdrawalFeeType === 'PERCENTAGE' ? '100' : undefined} step={withdrawalFeeType === 'PERCENTAGE' ? '0.01' : '1'} value={withdrawalFeeValue} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setWithdrawalFeeValue(value.value)} /></Field><Text className="muted">Applied by the backend to future withdrawals. Existing transaction fee snapshots remain unchanged.</Text><Button appearance="primary" disabled={platformSettingsLoading || platformSettingsSaving} onClick={() => void savePlatformSettings()}>{platformSettingsSaving ? 'Saving...' : 'Save settings'}</Button></Card></div></section>}
    {section === 'settings' && <Card className="settings-card platform-setting-card"><div><Text className="home-kicker">USER COMMUNICATION</Text><Title2>Telegram group and support email</Title2></div><Field label="Telegram group link"><Input type="url" value={telegramUrl} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setTelegramUrl(value.value)} placeholder="https://t.me/yourgroup" /></Field><Field label="Popup message (180 characters max)"><Textarea maxLength={180} resize="vertical" value={telegramPopupMessage} onChange={(_: ChangeEvent<HTMLTextAreaElement>, value: { value: string }) => setTelegramPopupMessage(value.value)} placeholder="Join our Telegram group for updates and support." /></Field><Field label="Support email"><Input type="email" value={supportEmail} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setSupportEmail(value.value)} placeholder="support@example.com" /></Field><Button appearance="primary" disabled={supportSettingsSaving} onClick={() => void saveSupportSettings()}>{supportSettingsSaving ? 'Saving...' : 'Save support settings'}</Button></Card>}
    {showMethods && <section className="deposit-admin-section"><div className="deposit-admin-section__heading"><div><Text className="home-kicker">Admin managed</Text><Title2>Deposit payment methods</Title2><Text className="muted">Only active methods with merchant details appear for their country. Maximum {maximumMethods} methods per country.</Text></div><Field label="Country"><select value={selectedDepositCountry} onChange={(event) => setSelectedDepositCountry(event.currentTarget.value as 'RW' | 'BI' | 'UG')}>{countries.map((country) => <option key={country.countryCode} value={country.countryCode}>{country.countryName} · {country.currencyCode}</option>)}</select></Field><Button appearance="primary" disabled={(!token && !sessionAdmin) || methodsLoading || visibleMethods.length >= maximumMethods || Boolean(draft)} onClick={() => setDraft(emptyMethod(selectedDepositCountry))}>Add payment method</Button></div>{methodsLoading ? <Text className="muted">Loading deposit methods...</Text> : visibleMethods.length ? visibleMethods.map((method) => methodEditor(method, false)) : token || sessionAdmin ? <Text className="muted">No deposit methods configured for {selectedDepositCountry}.</Text> : <Text className="muted">Enter the admin token to manage deposit methods.</Text>}{draft && methodEditor(draft, true)}</section>}
    {showCheckin && <Card className="settings-card"><Title2>Daily check-in</Title2><Text className="muted">Set the daily reward and enable or pause check-in claims for all users.</Text><div className="daily-checkin-admin"><label className="deposit-admin-status"><input type="checkbox" checked={checkinEnabled} onChange={(event) => setCheckinEnabled(event.currentTarget.checked)} /><span>{checkinEnabled ? 'Enabled for users' : 'Paused'}</span></label><Field label="Reward per day (RWF)"><Input type="number" min="1" step="1" value={checkinReward} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setCheckinReward(value.value)} /></Field><Button appearance="primary" disabled={checkinSaving || (!token && !sessionAdmin)} onClick={() => void saveDailyCheckin()}>{checkinSaving ? 'Saving...' : 'Save check-in'}</Button></div></Card>}
    {showReferrals && <Card className="settings-card"><Title2>Referral commission</Title2>{levels.map((item) => <div className="settings-row" key={item.level}><Field label={`Level ${item.level} percentage`}><Input type="number" min="0" max="100" value={item.percentage} onChange={(_: ChangeEvent<HTMLInputElement>, data: { value: string }) => setLevels((current) => current.map((level) => level.level === item.level ? { ...level, percentage: data.value } : level))} /></Field><Button onClick={() => void saveLevel(item.level, item.percentage)}>Save Level {item.level}</Button></div>)}</Card>}
  </div>;
}