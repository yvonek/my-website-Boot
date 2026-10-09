import { Badge, Button, Card, MessageBar, MessageBarBody, Text, Title1, Title2 } from '@fluentui/react-components';
import { ArrowRightRegular, CheckmarkCircleRegular, GiftRegular, LockClosedRegular, PersonRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatCurrencyAmount } from '../api/money';
import type { AuthUser, DashboardData, WalletBalance, WalletTransaction, WithdrawalAccount } from '../api/types';

const icons = [CheckmarkCircleRegular, GiftRegular, LockClosedRegular, ArrowRightRegular];

function formatDate(value: string) { return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }

export function MePage({ user, data, state, onRetry }: { user: AuthUser; data: DashboardData | null; state: string; onRetry: () => void }) {
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [withdrawalAccount, setWithdrawalAccount] = useState<WithdrawalAccount | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [activityError, setActivityError] = useState('');

  useEffect(() => {
    Promise.all([api.getBalance(), api.getWithdrawalAccount(), api.getTransactions()])
      .then(([wallet, accountResult, activityResult]) => {
        setBalance(wallet);
        setWithdrawalAccount(accountResult.account);
        setTransactions(activityResult.transactions);
      })
      .catch((reason) => setActivityError(reason instanceof Error ? reason.message : 'Account information could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);

  return <div className="page-stack my-account-page">
    <div className="page-intro"><Text className="hero-eyebrow">My account</Text><Title1>Account information</Title1><Text className="muted">Your profile, wallet, payout account, and recent activity.</Text></div>

    <section className="my-account-overview" aria-label="Account overview">
      <Card className="my-account-card"><div className="my-account-card__heading"><span className="profile-card__avatar"><PersonRegular /></span><div><Text weight="semibold">Personal details</Text><Text className="muted">Registered account information</Text></div></div><dl className="my-account-details"><div><dt>Full name</dt><dd>{user.fullName}</dd></div><div><dt>Phone number</dt><dd>{user.phoneNumber}</dd></div><div><dt>Country</dt><dd>{user.countryCode ?? 'RW'}</dd></div><div><dt>Currency</dt><dd>{user.currencyCode ?? 'RWF'}</dd></div><div><dt>Referral code</dt><dd>{user.referralCode}</dd></div><div><dt>Account type</dt><dd>{user.role === 'ADMIN' ? 'Administrator' : 'Member'}</dd></div></dl></Card>
      <Card className="my-account-card my-account-card--wallet"><div className="my-account-card__heading"><span className="home-feature-icon"><PersonRegular /></span><div><Text weight="semibold">Wallet balance</Text><Text className="muted">Available and reserved funds</Text></div></div>{loading ? <Text className="muted">Loading wallet...</Text> : balance ? <dl className="my-account-details"><div><dt>Total</dt><dd>{formatCurrencyAmount((balance.displayAvailableBalance ?? balance.availableBalance) + (balance.displayLockedWelcomeBonus ?? balance.lockedWelcomeBonus ?? 0), balance.currencyCode ?? user.currencyCode ?? 'RWF')}</dd></div><div><dt>Available</dt><dd>{formatCurrencyAmount(balance.displayAvailableBalance ?? balance.availableBalance, balance.currencyCode ?? user.currencyCode ?? 'RWF')}</dd></div>{(balance.displayLockedWelcomeBonus ?? balance.lockedWelcomeBonus ?? 0) > 0 && <div><dt>Locked welcome bonus</dt><dd>{formatCurrencyAmount(balance.displayLockedWelcomeBonus ?? balance.lockedWelcomeBonus ?? 0, balance.currencyCode ?? user.currencyCode ?? 'RWF')}</dd></div>}<div><dt>Reserved</dt><dd>{formatCurrencyAmount(balance.displayReservedBalance ?? balance.reservedBalance, balance.currencyCode ?? user.currencyCode ?? 'RWF')}</dd></div></dl> : <Text className="muted">Wallet information is unavailable.</Text>}<a className="my-account-link" href="/wallet">Open wallet <ArrowRightRegular /></a></Card>
    </section>

    <section className="my-account-section"><div className="home-section__heading"><div><Text className="home-kicker">Payout details</Text><Title2>Withdrawal account</Title2></div><a className="home-text-link" href="/withdraw">Open Withdraw <ArrowRightRegular /></a></div><Card className="my-account-card">{loading ? <Text className="muted">Loading withdrawal account...</Text> : withdrawalAccount ? <dl className="my-account-details my-account-details--inline"><div><dt>Provider</dt><dd>{withdrawalAccount.paymentMethod === 'AIRTEL_MONEY' ? 'Airtel Money' : 'MTN MoMo'}</dd></div><div><dt>Account holder</dt><dd>{withdrawalAccount.accountHolderName}</dd></div><div><dt>Phone number</dt><dd>{withdrawalAccount.phoneNumber}</dd></div></dl> : <div className="my-account-empty"><Text>No withdrawal account is bound.</Text><a className="my-account-link" href="/withdraw">Bind an account <ArrowRightRegular /></a></div>}</Card></section>

    <section className="my-account-section"><div className="home-section__heading"><div><Text className="home-kicker">Completed and pending actions</Text><Title2>Transaction history</Title2></div><a className="home-text-link" href="/transactions">Full history <ArrowRightRegular /></a></div>{activityError && <MessageBar intent="error"><MessageBarBody>{activityError}<Button appearance="transparent" onClick={onRetry}>Retry</Button></MessageBarBody></MessageBar>}{loading ? <Card className="my-account-card"><Text className="muted">Loading activity...</Text></Card> : transactions.length ? <div className="my-account-activity">{transactions.map((transaction) => <Card className="my-account-activity__row" key={transaction.id}><div className="my-account-activity__main"><strong>{transaction.type === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'}</strong><Text className="muted">{transaction.internalReference} · {transaction.phoneNumber}</Text><small>{formatDate(transaction.createdAt)}</small></div><div className="my-account-activity__result"><strong>{transaction.type === 'DEPOSIT' ? '+' : '-'}{formatCurrencyAmount(transaction.displayAmount ?? transaction.amount, transaction.currencyCode ?? user.currencyCode ?? 'RWF')}</strong><Badge color={transaction.status === 'SUCCESS' ? 'success' : transaction.status === 'PENDING' ? 'warning' : transaction.status === 'AWAITING_PAYOUT' ? 'informative' : transaction.status === 'REJECTED' || transaction.status === 'FAILED' ? 'danger' : 'subtle'}>{transaction.status}</Badge></div></Card>)}</div> : <Card className="my-account-card"><Text>No wallet activity yet.</Text></Card>}</section>

    {state === 'error' && <MessageBar intent="error"><MessageBarBody>Support and reward details could not be loaded. <Button appearance="transparent" onClick={onRetry}>Retry</Button></MessageBarBody></MessageBar>}
    {state === 'data' && Boolean(data?.tools.length) && <section className="my-account-section"><div className="home-section__heading"><div><Text className="home-kicker">Account services</Text><Title2>Support and rewards</Title2></div></div><div className="tool-list">{data?.tools.map((tool, index) => { const Icon = icons[index] ?? ArrowRightRegular; return <Card className="tool-row" key={tool.name}><div className="my-account-tool-icon"><Icon /></div><div className="my-account-tool-copy"><Text weight="semibold">{tool.name}</Text><Text className="muted">{tool.value}</Text></div><Text className="tool-state">{tool.state}</Text></Card>; })}</div></section>}
  </div>;
}