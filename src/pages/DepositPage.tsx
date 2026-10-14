


























import { Button, Card, Field, Input, MessageBar, MessageBarBody, Text, Title1, Title2 } from '@fluentui/react-components';
import { ArrowDownRegular, CallRegular, CheckmarkRegular, ClipboardRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { TransactionHistory } from '../components/TransactionHistory';
import { api } from '../api';
import { convertCurrencyAmount, formatCurrencyAmount, isValidCountryPhone, usdtDepositAmount } from '../api/money';
import type { DepositPaymentMethod, WalletTransaction } from '../api/types';

const maxScreenshotBytes = 4 * 1024 * 1024;

// Converts an RWF amount (API and limits unit) into the method input currency (UGX, BIF, or USDT).
function rwfToInputAmount(method: DepositPaymentMethod, amountRwf: number) {
  if (method.cryptoNetwork === 'TRC20') return usdtDepositAmount(amountRwf, method.customerUnitsPerRwf ?? 1, Number(method.unitsPerUsdt ?? 0), method);
  return convertCurrencyAmount(amountRwf, 1, method.receivingUnitsPerRwf ?? method.customerUnitsPerRwf ?? 1);
}

// Inverse of rwfToInputAmount: converts a typed method-currency amount into RWF. Rounded to whole RWF.
function inputAmountToRwf(method: DepositPaymentMethod, amount: number) {
  if (method.cryptoNetwork === 'TRC20') {
    const unitsPerUsdt = Number(method.unitsPerUsdt ?? 0);
    const customerUnitsPerRwf = method.customerUnitsPerRwf ?? 1;
    if (!(unitsPerUsdt > 0) || !(customerUnitsPerRwf > 0)) return NaN;
    const feeValue = Number.isFinite(method.usdtDepositFeeValue) ? Number(method.usdtDepositFeeValue) : 0;
    if (method.usdtDepositFeeType === 'FIXED') return Math.round(amount * unitsPerUsdt / customerUnitsPerRwf) - feeValue;
    const usdtBeforeFee = method.usdtDepositFeeType === 'PERCENTAGE' ? amount / (1 + feeValue / 100) : amount;
    return Math.round(usdtBeforeFee * unitsPerUsdt / customerUnitsPerRwf);
  }
  return convertCurrencyAmount(amount, method.receivingUnitsPerRwf ?? method.customerUnitsPerRwf ?? 1, 1);
}

function buildUssd(template: string, merchantNumber: string, amount: number) { return template.replace(/\{\{?\s*number\s*\}\}?|\bnumber\b/gi, merchantNumber.replace(/[\s-]/g, '')).replace(/\{\{?\s*(?:amount|frw)\s*\}\}?|\b(?:amount|frw)\b/gi, String(amount)); }
function readFileAsDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read screenshot.')); reader.onerror = () => reject(new Error('Could not read screenshot.')); reader.readAsDataURL(file); }); }

export function DepositPage() {
  const [methods, setMethods] = useState<DepositPaymentMethod[]>([]);
  const [methodsLoading, setMethodsLoading] = useState(true);
  const [selectedMethodId, setSelectedMethodId] = useState('');
  const [senderName, setSenderName] = useState('');
  const [amount, setAmount] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [screenshotData, setScreenshotData] = useState('');
  const [screenshotName, setScreenshotName] = useState('');
  const [depositStatus, setDepositStatus] = useState<'idle' | 'submitting'>('idle');
  const [depositError, setDepositError] = useState('');
  const [depositSuccess, setDepositSuccess] = useState<WalletTransaction | null>(null);
  const [copied, setCopied] = useState('');

  const loadMethods = async () => {
    setMethodsLoading(true);
    setDepositError('');
    try {
      const { methods: activeMethods } = await api.getDepositMethods();
      setMethods(activeMethods);
      setSelectedMethodId((current) => activeMethods.some((method) => method.id === current) ? current : activeMethods[0]?.id ?? '');
    } catch (error) {
      setDepositError(error instanceof Error ? error.message : 'Deposit methods could not be loaded.');
    } finally {
      setMethodsLoading(false);
    }
  };

  useEffect(() => { void loadMethods(); }, []);

  const selectedMethod = methods.find((method) => method.id === selectedMethodId) ?? null;
  const currencyCode = selectedMethod?.currencyCode ?? methods[0]?.currencyCode ?? 'RWF';
  const countryCode = selectedMethod?.countryCode ?? methods[0]?.countryCode ?? 'RW';
  const showMerchantDetails = countryCode === 'RW' || countryCode === 'BI' || countryCode === 'UG';
  const phonePlaceholder = countryCode === 'BI' ? '06xxxxxxx' : countryCode === 'UG' ? '077xxxxxxx' : '078xxxxxxx';
  const receivingCurrencyCode = selectedMethod?.receivingCurrencyCode ?? currencyCode;
  const isCryptoMethod = selectedMethod?.cryptoNetwork === 'TRC20';
  const inputCurrencyCode = isCryptoMethod ? 'USDT' : receivingCurrencyCode;
  const formatInputAmount = (value: number) => isCryptoMethod ? `${value.toFixed(2)} USDT` : formatCurrencyAmount(value, receivingCurrencyCode);
  const inputMinimum = selectedMethod ? rwfToInputAmount(selectedMethod, selectedMethod.minimumAmount) : 0;
  const inputMaximum = selectedMethod ? rwfToInputAmount(selectedMethod, selectedMethod.maximumAmount) : 0;
  // The typed amount is in the method currency; numericAmount is the RWF value sent to the API.
  const inputNumber = Number(amount);
  const numericAmount = selectedMethod && inputNumber > 0 ? inputAmountToRwf(selectedMethod, inputNumber) : NaN;
  const amountIsValid = Boolean(selectedMethod && Number.isSafeInteger(numericAmount) && numericAmount >= selectedMethod.minimumAmount && numericAmount <= selectedMethod.maximumAmount);
  const customerUnitsPerRwf = selectedMethod?.customerUnitsPerRwf ?? 1;
  const paymentAmount = amountIsValid && selectedMethod ? (isCryptoMethod ? usdtDepositAmount(numericAmount, customerUnitsPerRwf, Number(selectedMethod.unitsPerUsdt ?? 0), selectedMethod) : convertCurrencyAmount(numericAmount, 1, selectedMethod.receivingUnitsPerRwf ?? customerUnitsPerRwf)) : 0;
  const paymentLabel = isCryptoMethod ? `${paymentAmount.toFixed(2)} USDT` : formatCurrencyAmount(paymentAmount, receivingCurrencyCode);
  const localEquivalent = amountIsValid ? formatCurrencyAmount(convertCurrencyAmount(numericAmount, 1, customerUnitsPerRwf), currencyCode) : '';
  const methodPaymentAmount = (method: (typeof methods)[number], amountRwf: number) => method.cryptoNetwork === 'TRC20'
    ? `${usdtDepositAmount(amountRwf, method.customerUnitsPerRwf ?? 1, Number(method.unitsPerUsdt ?? 0), method).toFixed(2)} USDT`
    : formatCurrencyAmount(convertCurrencyAmount(amountRwf, 1, method.receivingUnitsPerRwf ?? method.customerUnitsPerRwf ?? 1), method.receivingCurrencyCode ?? method.currencyCode);
  const ussdCode = selectedMethod?.ussdTemplate && amountIsValid ? buildUssd(selectedMethod.ussdTemplate, selectedMethod.accountNumber, paymentAmount) : '';
  const copyValue = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(label); window.setTimeout(() => setCopied(''), 1600); }
    catch { setDepositError('Clipboard access is unavailable.'); }
  };

  const chooseScreenshot = async (file?: File) => {
    setScreenshotData(''); setScreenshotName('');
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setDepositError('Upload a PNG, JPEG, or WebP payment screenshot.'); return; }
    if (file.size > maxScreenshotBytes) { setDepositError('Payment screenshot must be 4 MB or smaller.'); return; }
    try { setScreenshotData(await readFileAsDataUrl(file)); setScreenshotName(file.name); setDepositError(''); }
    catch (error) { setDepositError(error instanceof Error ? error.message : 'Could not read screenshot.'); }
  };

  const submitDeposit = async () => {
    if (!selectedMethod) { setDepositError('Select an active payment method.'); return; }
    if (!Number.isSafeInteger(numericAmount) || numericAmount < selectedMethod.minimumAmount || numericAmount > selectedMethod.maximumAmount) { setDepositError(`Enter an amount between ${formatInputAmount(inputMinimum)} and ${formatInputAmount(inputMaximum)}.`); return; }
    if (!senderName.trim()) { setDepositError('Enter the full name on the paying account.'); return; }
    if (!isValidCountryPhone(phoneNumber, countryCode)) { setDepositError(`Enter a valid ${selectedMethod.countryCode ?? countryCode} phone number.`); return; }
    if (!screenshotData) { setDepositError('Attach a screenshot of your payment.'); return; }
    setDepositError(''); setDepositStatus('submitting'); setDepositSuccess(null);
    try {
      const result = await api.createDeposit({ amount: numericAmount, phoneNumber, senderName: senderName.trim(), depositMethodId: selectedMethod.id, screenshotData });
      setDepositSuccess(result.transaction); setDepositStatus('idle');
    } catch (error) { setDepositStatus('idle'); setDepositError(error instanceof Error ? error.message : 'Deposit request failed.'); }
  };

  return <div className="money-page page-stack deposit-page">
    <div className="page-intro"><Text className="hero-eyebrow">Payment request</Text><Title1>Deposit</Title1><Text className="muted">Choose a payment method, send your payment, and submit it for admin review.</Text></div>

    <section className="deposit-method-section" aria-labelledby="deposit-method-title">
      <div className="deposit-section-heading"><Text className="home-kicker" id="deposit-method-title">Payment method</Text></div>
      {methodsLoading ? <Card className="deposit-empty-methods"><Text>Loading payment methods...</Text></Card> : methods.length ? <div className="deposit-method-grid" role="group" aria-label="Available payment methods">{methods.map((method) => <button className={`deposit-method-card${selectedMethodId === method.id ? ' is-selected' : ''}`} type="button" key={method.id} aria-pressed={selectedMethodId === method.id} onClick={() => { setSelectedMethodId(method.id); setDepositError(''); setDepositSuccess(null); }}>
        <span className="deposit-method-card__logo">{method.logoData ? <img src={method.logoData} alt="" /> : <span aria-hidden="true">{method.name.slice(0, 1).toUpperCase()}</span>}</span><span className="deposit-method-card__copy"><span className="deposit-method-card__name">{method.name}</span><span className="deposit-method-card__range">{methodPaymentAmount(method, method.minimumAmount)} – {methodPaymentAmount(method, method.maximumAmount)}</span></span><span className="deposit-method-card__check">{selectedMethodId === method.id && <CheckmarkRegular />}</span>
      </button>)}</div> : <Card className="deposit-empty-methods"><Text>{depositError || 'No active payment methods are currently available. Please contact support.'}</Text>{depositError && <Button appearance="secondary" onClick={() => void loadMethods()}>Retry</Button>}</Card>}
    </section>

    <div className="deposit-amount-field"><Field label={`Amount (${inputCurrencyCode})`}><Input type="number" min={inputMinimum} max={inputMaximum} step={isCryptoMethod ? '0.01' : '1'} value={amount} onChange={(_: ChangeEvent<HTMLInputElement>, data: { value: string }) => setAmount(data.value)} placeholder={selectedMethod ? `${formatInputAmount(inputMinimum)} – ${formatInputAmount(inputMaximum)}` : 'Enter amount'} /></Field></div>
    {showMerchantDetails && selectedMethod?.ussdTemplate && <div className="deposit-direct-action">{ussdCode ? <a className="deposit-pay-now" href={`tel:${encodeURIComponent(ussdCode)}`}><CallRegular /><span>PAY {paymentLabel} NOW</span></a> : <Button className="deposit-pay-now" appearance="primary" disabled icon={<CallRegular />}>Enter an amount in range</Button>}</div>}

    {selectedMethod && <Card className="deposit-details-card">
      {showMerchantDetails && <div className="deposit-detail-row"><div><span>Merchant name</span><strong>{selectedMethod.accountName}</strong></div><Button appearance="secondary" icon={copied === 'merchant' ? <CheckmarkRegular /> : <ClipboardRegular />} onClick={() => copyValue(selectedMethod.accountName, 'merchant')}>{copied === 'merchant' ? 'Copied' : 'Copy'}</Button></div>}
      {showMerchantDetails && <div className="deposit-detail-row"><div><span>{isCryptoMethod ? 'Merchant number (TRC20 USDT wallet)' : 'Merchant number'}</span><strong>{selectedMethod.accountNumber}</strong></div><Button appearance="secondary" icon={copied === 'number' ? <CheckmarkRegular /> : <ClipboardRegular />} onClick={() => copyValue(selectedMethod.accountNumber, 'number')}>{copied === 'number' ? 'Copied' : 'Copy'}</Button></div>}
      {isCryptoMethod && !showMerchantDetails && <div className="deposit-detail-row"><div><span>TRC20 USDT wallet address</span><strong>{selectedMethod.accountNumber}</strong></div><Button appearance="secondary" icon={copied === 'wallet' ? <CheckmarkRegular /> : <ClipboardRegular />} onClick={() => copyValue(selectedMethod.accountNumber, 'wallet')}>{copied === 'wallet' ? 'Copied' : 'Copy'}</Button></div>}
      {selectedMethod.instructions && <Text className="deposit-instructions">{selectedMethod.instructions}</Text>}
      {showMerchantDetails && amountIsValid && <div className="deposit-detail-row"><div><span>{isCryptoMethod ? 'Amount in USDT' : `Amount in ${currencyCode}`}</span><strong>{isCryptoMethod ? paymentLabel : localEquivalent}</strong></div></div>}
      {amountIsValid && <Text className="deposit-instructions">Send {paymentLabel} to {isCryptoMethod ? 'the TRC20 wallet address above' : 'the receiving account'}{!isCryptoMethod && selectedMethod.receivingCountryCode && selectedMethod.receivingCountryCode !== countryCode ? ` in ${selectedMethod.receivingCountryCode}` : ''}.</Text>}
      {showMerchantDetails && !selectedMethod.ussdTemplate && <Text className="deposit-instructions">A payment shortcut is not configured for this method. Use the merchant details above.</Text>}
    </Card>}

    <Card className="money-card deposit-form-card"><div className="money-card__header"><span className="money-card__icon"><ArrowDownRegular /></span><div><Text weight="semibold">Submit deposit</Text><Text className="muted">Your balance changes after admin approval.</Text></div></div>
      <Field label="Phone number used to pay"><Input type="tel" value={phoneNumber} onChange={(_: ChangeEvent<HTMLInputElement>, data: { value: string }) => setPhoneNumber(data.value)} placeholder={phonePlaceholder} /></Field>
      <Field label="Full name (name on the paying account)"><Input value={senderName} onChange={(_: ChangeEvent<HTMLInputElement>, data: { value: string }) => setSenderName(data.value)} placeholder="Enter payer's full name" /></Field>
      <Field label="Payment screenshot"><input className="deposit-screenshot-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseScreenshot(event.currentTarget.files?.[0])} /><span className="deposit-screenshot-note">PNG, JPEG, or WebP · up to 4 MB</span>{screenshotName && <span className="deposit-screenshot-name">{screenshotName}</span>}</Field>
      {depositError && <MessageBar className="deposit-error-message" intent="error"><MessageBarBody>{depositError}</MessageBarBody></MessageBar>}
      {depositSuccess && <MessageBar className="deposit-success-message" intent="success"><MessageBarBody>Deposit submitted: {formatCurrencyAmount(depositSuccess.displayAmount ?? depositSuccess.amount, depositSuccess.currencyCode ?? currencyCode)}{depositSuccess.cryptoNetwork === 'TRC20' && (depositSuccess.cryptoAmount ?? depositSuccess.depositPaymentAmount) != null ? ` · Send ${Number(depositSuccess.cryptoAmount ?? depositSuccess.depositPaymentAmount).toFixed(2)} USDT (TRC20)` : depositSuccess.depositPaymentAmount != null && depositSuccess.depositReceivingCurrencyCode ? ` · Pay ${formatCurrencyAmount(depositSuccess.depositPaymentAmount, depositSuccess.depositReceivingCurrencyCode)} to ${depositSuccess.depositReceivingCountryCode}` : ''}. Method: {depositSuccess.depositMethodName}. Reference: {depositSuccess.internalReference}</MessageBarBody></MessageBar>}
      <Button className="deposit-submit-button" appearance="primary" disabled={depositStatus === 'submitting' || !selectedMethod} onClick={submitDeposit}>{depositStatus === 'submitting' ? 'Submitting deposit...' : 'Submit deposit'}</Button>
    </Card>
    <TransactionHistory typeFilter="DEPOSIT" showHeading refreshKey={depositSuccess?.id ?? ''} />
  </div>;
}