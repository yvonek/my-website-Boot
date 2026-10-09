import { Button, Card, Field, Input, MessageBar, MessageBarBody, Text, Title1 } from '@fluentui/react-components';
import { ArrowUpRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { TransactionHistory } from '../components/TransactionHistory';
import { api } from '../api';
import { formatCurrencyAmount, isValidCountryPhone } from '../api/money';
import type { PaymentMethod, WalletBalance, WalletTransaction, WithdrawalAccount, WithdrawalPreview } from '../api/types';

export function WithdrawPage() {
  const [account, setAccount] = useState<WithdrawalAccount | null>(null);
  const [accountName, setAccountName] = useState('');
  const [accountPhone, setAccountPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('MTN_MOMO');
  const [withdrawalMethods, setWithdrawalMethods] = useState<{ code: PaymentMethod; name: string }[]>([]);
  const [methodsLoading, setMethodsLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [withdrawBalance, setWithdrawBalance] = useState<WalletBalance | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [status, setStatus] = useState<'idle' | 'submitting'>('idle');
  const [error, setError] = useState('');
  const [accountMessage, setAccountMessage] = useState('');
  const [success, setSuccess] = useState<WalletTransaction | null>(null);
  const [preview, setPreview] = useState<WithdrawalPreview | null>(null);
  const currencyCode = withdrawBalance?.currencyCode ?? 'RWF';
  const countryCode = withdrawBalance?.countryCode ?? 'RW';

  useEffect(() => {
    api.getBalance().then(setWithdrawBalance).catch((reason) => setError(reason instanceof Error ? reason.message : 'Available balance could not be loaded.')).finally(() => setBalanceLoading(false));
    api.getPaymentMethods('withdrawal').then(({ methods }) => { setWithdrawalMethods(methods); if (methods.length) setPaymentMethod((current) => methods.some((method) => method.code === current) ? current : methods[0].code); }).catch((reason) => setAccountMessage(reason instanceof Error ? reason.message : 'Withdrawal methods could not be loaded.')).finally(() => setMethodsLoading(false));
    api.getWithdrawalAccount().then(({ account: saved }) => {
      setAccount(saved);
      if (saved) { setAccountName(saved.accountHolderName); setAccountPhone(saved.phoneNumber); }
    }).catch((reason) => setAccountMessage(reason instanceof Error ? reason.message : 'Withdrawal account could not be loaded.')).finally(() => setAccountLoading(false));
  }, []);

  async function bindAccount() {
    if (methodsLoading || !withdrawalMethods.some((method) => method.code === paymentMethod)) { setAccountMessage('No withdrawal method is enabled for your country. Contact support.'); return; }
    if (!accountName.trim()) { setAccountMessage('Enter the name registered on the mobile money account.'); return; }
    if (!isValidCountryPhone(accountPhone, countryCode)) { setAccountMessage(`Enter a valid ${countryCode} phone number.`); return; }
    setStatus('submitting'); setAccountMessage('');
    try { const { account: saved } = await api.saveWithdrawalAccount({ accountHolderName: accountName.trim(), phoneNumber: accountPhone, paymentMethod }); setAccount(saved); setAccountMessage('Account bound successfully.'); }
    catch (reason) { setAccountMessage(reason instanceof Error ? reason.message : 'Account could not be bound.'); }
    finally { setStatus('idle'); }
  }

  async function reviewWithdrawal() {
    const numericAmount = Number(amount);
    if (!account) { setError('Bind a withdrawal account before continuing.'); return; }
    if (!Number.isSafeInteger(numericAmount) || numericAmount <= 0) { setError('Enter an amount greater than zero.'); return; }
    setStatus('submitting'); setError('');
    try { setPreview(await api.previewWithdrawal({ amount: numericAmount, phoneNumber: '', paymentMethod: account.paymentMethod, receiverName: '' })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Withdrawal validation failed.'); }
    finally { setStatus('idle'); }
  }

  async function confirmWithdrawal() {
    if (!preview || !account) return;
    setStatus('submitting'); setError('');
    try { const result = await api.createWithdrawal({ amount: preview.displayWithdrawalAmount ?? preview.withdrawalAmount, phoneNumber: '', paymentMethod: account.paymentMethod, receiverName: '' }); setSuccess(result.transaction); setPreview(null); setAmount(''); api.getBalance().then(setWithdrawBalance); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Withdrawal request failed.'); }
    finally { setStatus('idle'); }
  }

  return <div className="money-page page-stack withdraw-page">
    <div className="page-intro"><Text className="hero-eyebrow">Payment request</Text><Title1>Withdraw</Title1><Text className="muted">Bind your mobile money account once, then use it securely for every withdrawal.</Text></div>
    <Card className="bind-account-card"><div className="money-card__header"><span className="money-card__icon"><ArrowUpRegular /></span><div><Text weight="semibold">{accountLoading ? 'Loading withdrawal account...' : account ? 'Bound withdrawal account' : 'Bind Account'}</Text><Text className="muted">Your withdrawals are sent only to this account.</Text></div></div>
      {accountLoading ? <Text className="muted">Checking your saved mobile money account...</Text> : account ? <div className="bound-account-summary"><div><span>Provider</span><strong>{withdrawalMethods.find((method) => method.code === account.paymentMethod)?.name ?? account.paymentMethod}</strong></div><div><span>Account holder</span><strong>{account.accountHolderName}</strong></div><div><span>Phone number</span><strong>{account.phoneNumber}</strong></div></div> : <div className="bind-account-form"><div><Text className="bind-account-label">Provider</Text><div className="provider-toggle">{methodsLoading ? <Text className="muted">Loading methods...</Text> : withdrawalMethods.map((method) => <button type="button" key={method.code} className={paymentMethod === method.code ? 'is-selected' : ''} onClick={() => setPaymentMethod(method.code)}>{method.name}</button>)}</div>{!methodsLoading && withdrawalMethods.length === 0 && <Text className="muted">No withdrawal methods are enabled for your country.</Text>}</div><Field label="Full Name (as on ID)"><Input value={accountName} onChange={(_: unknown, data: { value: string }) => setAccountName(data.value)} placeholder="Account holder name" /></Field><Field label="Phone Number"><Input value={accountPhone} onChange={(_: unknown, data: { value: string }) => setAccountPhone(data.value)} placeholder={countryCode === 'RW' ? '07XXXXXXXX' : `+${countryCode === 'BI' ? '257' : '256'}XXXXXXXXX`} /></Field>{accountMessage && <MessageBar className="withdraw-error-message" intent="error"><MessageBarBody>{accountMessage}</MessageBarBody></MessageBar>}<Button appearance="primary" disabled={status === 'submitting' || methodsLoading || withdrawalMethods.length === 0} onClick={bindAccount}>{status === 'submitting' ? 'Binding Account...' : 'Bind Account'}</Button><Text className="bind-account-note">Make sure the name and number match your mobile money account.</Text></div>}
    </Card>
    {account && <Card className="money-card"><div className="money-card__header"><span className="money-card__icon"><ArrowUpRegular /></span><div><Text weight="semibold">Withdraw funds</Text><Text className="muted">Available balance: {balanceLoading ? 'Loading...' : withdrawBalance ? formatCurrencyAmount(withdrawBalance.displayAvailableBalance ?? withdrawBalance.availableBalance, currencyCode) : 'Unavailable'}</Text></div></div><Field label={`Amount (${currencyCode})`}><Input type="number" min="1" value={amount} onChange={(_: unknown, data: { value: string }) => setAmount(data.value)} placeholder="Enter amount" /></Field>{error && <MessageBar className="withdraw-error-message" intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}{success && <MessageBar intent="success"><MessageBarBody>Withdrawal request submitted for {formatCurrencyAmount(success.displayAmount ?? success.amount, success.currencyCode ?? currencyCode)}. Reference: {success.internalReference}</MessageBarBody></MessageBar>}<Button appearance="primary" disabled={status === 'submitting' || balanceLoading || !withdrawBalance} onClick={reviewWithdrawal}>{status === 'submitting' ? 'Checking Withdrawal...' : 'Withdraw'}</Button></Card>}
    {preview && <div className="withdrawal-modal__backdrop"><section className="withdrawal-modal" role="dialog" aria-modal="true" aria-labelledby="withdrawal-information-title"><div className="withdrawal-modal__eyebrow">Review</div><h2 id="withdrawal-information-title">Withdrawal Information</h2><div className="withdrawal-modal__rows"><div><span>Receiver Name</span><strong>{preview.receiverName}</strong></div><div><span>Channel</span><strong>{preview.channel}</strong></div><div><span>Account</span><strong>{preview.phoneNumber}</strong></div><div><span>Withdrawal Amount</span><strong>{formatCurrencyAmount(preview.displayWithdrawalAmount ?? preview.withdrawalAmount, preview.currencyCode ?? currencyCode)}</strong></div><div><span>Fee</span><strong>{formatCurrencyAmount(preview.displayWithdrawalFee ?? preview.withdrawalFee, preview.currencyCode ?? currencyCode)}</strong></div><div><span>You Receive</span><strong>{formatCurrencyAmount(preview.displayAmountReceived ?? preview.amountReceived, preview.currencyCode ?? currencyCode)}</strong></div></div><div className="withdrawal-modal__actions"><Button appearance="secondary" disabled={status === 'submitting'} onClick={() => setPreview(null)}>Cancel</Button><Button appearance="primary" disabled={status === 'submitting'} onClick={confirmWithdrawal}>{status === 'submitting' ? 'Submitting Withdrawal...' : 'Confirm'}</Button></div></section></div>}
    <TransactionHistory typeFilter="WITHDRAWAL" showHeading refreshKey={success?.id ?? ''} />
  </div>;
}
