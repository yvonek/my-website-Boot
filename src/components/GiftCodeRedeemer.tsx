import { Button, Field, Input } from '@fluentui/react-components';
import { GiftRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { api } from '../api';
import { formatCurrencyAmount } from '../api/money';
import type { GiftCodeRedemption } from '../api/types';

export function GiftCodeRedeemer({ mode, onRedeemed }: { mode: 'action' | 'panel'; onRedeemed: (result: GiftCodeRedemption) => void }) {
  const [open, setOpen] = useState(mode === 'panel');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const redeem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await api.redeemGiftCode(code);
      onRedeemed(result);
      setCode('');
      setMessage(`Gift code received ${formatCurrencyAmount(result.displayAmount, result.currencyCode)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gift code could not be redeemed.');
    } finally {
      setBusy(false);
    }
  };

  return <>
    {mode === 'action' && <button className="home-gift-code-action" type="button" aria-expanded={open} onClick={() => { setOpen((current) => !current); setMessage(''); }}><GiftRegular /> Gift Code</button>}
    {open && <form className={mode === 'action' ? 'home-gift-code-form' : 'gift-code-redemption-form'} onSubmit={(event) => void redeem(event)}><Field label="Gift code"><Input autoComplete="off" maxLength={32} value={code} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setCode(value.value)} placeholder="Enter your code" /></Field><Button appearance="primary" type="submit" disabled={busy || !code.trim()}>{busy ? 'Redeeming...' : 'Redeem'}</Button>{message && <span className="gift-code-redemption-message" role="status">{message}</span>}</form>}
  </>;
}