import { Badge, Button, Card, MessageBar, MessageBarBody, Text, Title1, Title2 } from '@fluentui/react-components';
import { ArrowRightRegular, MoneyRegular, StarRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatCurrencyAmount } from '../api/money';
import type { DashboardData, WalletBalance, WalletProduct } from '../api/types';
import { TransactionHistory } from '../components/TransactionHistory';

export function WalletPage({ data, state, onRetry }: { data: DashboardData | null; state: string; onRetry: () => void }) {
  const [products, setProducts] = useState<WalletProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState('');
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [checkin, setCheckin] = useState<{ enabled: boolean; rewardAmount: number; claimed: boolean } | null>(null);
  const [checkinLoading, setCheckinLoading] = useState(true);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [checkinMessage, setCheckinMessage] = useState('');
  const currencyCode = balance?.currencyCode ?? 'RWF';
  const displayAvailableBalance = balance?.displayAvailableBalance ?? balance?.availableBalance ?? 0;
  const displayLockedBonus = balance?.displayLockedWelcomeBonus ?? balance?.lockedWelcomeBonus ?? 0;
  const totalBalance = balance ? displayAvailableBalance + displayLockedBonus : null;

  useEffect(() => {
    const refreshWallet = () => {
      api.getWalletProducts().then(({ products: userProducts }) => setProducts(userProducts)).catch((reason) => setProductsError(reason instanceof Error ? reason.message : 'Your products could not be loaded.')).finally(() => setProductsLoading(false));
      api.getBalance().then(setBalance).catch(() => setBalance(null));
    };
    refreshWallet();
    const timer = window.setInterval(refreshWallet, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    api.getDailyCheckin().then(setCheckin).catch(() => setCheckin(null)).finally(() => setCheckinLoading(false));
  }, []);

  const claimCheckin = async () => {
    setCheckinBusy(true);
    setCheckinMessage('');
    try {
      const result = await api.claimDailyCheckin();
      setCheckin((current) => current ? { ...current, claimed: true } : current);
      setCheckinMessage(`Daily reward received: ${formatCurrencyAmount(result.displayRewardAmount ?? result.rewardAmount, result.currencyCode ?? currencyCode)}`);
    } catch (reason) {
      setCheckinMessage(reason instanceof Error ? reason.message : 'Daily check-in could not be claimed.');
    } finally {
      setCheckinBusy(false);
    }
  };

  if (state === 'loading') return <Card className="state-panel"><Text>Loading your wallet...</Text></Card>;
  if (state === 'error') return <MessageBar intent="error"><MessageBarBody>Wallet data could not be loaded. <Button appearance="transparent" onClick={onRetry}>Retry</Button></MessageBarBody></MessageBar>;
  return <div className="page-stack wallet-page">
    <div className="page-intro"><Text className="hero-eyebrow">Account products</Text><Title1>My Wallet</Title1><Text className="muted">Your balance and purchases.</Text></div>
    <section className="wallet-total"><div><span>My products</span><strong>{productsLoading ? '…' : products.length}</strong></div><div><span>Wallet balance</span><strong>{totalBalance === null ? '—' : formatCurrencyAmount(totalBalance, currencyCode)}</strong><small>{balance ? `${formatCurrencyAmount(displayAvailableBalance, currencyCode)} available` : 'Balance unavailable'}{displayLockedBonus > 0 ? ` · ${formatCurrencyAmount(displayLockedBonus, currencyCode)} locked` : ''}</small></div>{(balance?.welcomeBonusAmount ?? 0) > 0 && <div className="wallet-bonus-summary"><span>Welcome bonus</span><strong>{formatCurrencyAmount(balance.displayWelcomeBonusAmount ?? balance.welcomeBonusAmount ?? 0, currencyCode)}</strong><small>{balance?.welcomeBonusStatus === 'LOCKED' ? 'LOCKED · Purchase a product to unlock' : 'UNLOCKED · Included in available balance'}</small></div>}</section>
    {checkinLoading ? <div className="daily-checkin-skeleton" aria-label="Loading daily check-in" /> : checkin?.enabled && <Card className="daily-checkin"><div className="daily-checkin__copy"><span className="daily-checkin__icon"><StarRegular /></span><div><strong>Daily check-in</strong><span>{checkin.claimed ? 'You have checked in today' : `Claim ${formatCurrencyAmount(checkin.displayRewardAmount ?? checkin.rewardAmount, checkin.currencyCode ?? currencyCode)} today`}</span></div></div><Button appearance="primary" disabled={checkin.claimed || checkinBusy} onClick={() => void claimCheckin()}>{checkin.claimed ? 'Claimed today' : checkinBusy ? 'Claiming...' : 'Check in'}</Button>{checkinMessage && <MessageBar className={checkinMessage.startsWith('Daily reward received') ? 'daily-checkin__message daily-checkin__message--success' : 'daily-checkin__message'} intent={checkinMessage.startsWith('Daily reward received') ? 'success' : 'error'}><MessageBarBody>{checkinMessage}</MessageBarBody></MessageBar>}</Card>}
    <section><div className="section-heading"><Title2>Purchased products</Title2><a className="home-text-link" href="/plans">Browse products <ArrowRightRegular /></a></div>{productsLoading ? <Text className="muted">Loading your purchases...</Text> : productsError ? <MessageBar intent="error"><MessageBarBody>{productsError}</MessageBarBody></MessageBar> : products.length ? <div className="wallet-products">{products.map((product) => <Card className="wallet-product" key={product.id}><div className="wallet-product__top"><span className="wallet-product__icon"><MoneyRegular /></span><Badge color="success">Completed</Badge></div><Text weight="semibold">{product.name}</Text><Text className="wallet-product__purchase-detail">Your purchase · {formatCurrencyAmount(product.displayAmount ?? product.amount, product.currencyCode ?? currencyCode)}</Text><Text className="wallet-product__purchase-date">Purchased {new Date(product.purchasedAt).toLocaleDateString()}</Text>{product.dailyIncome > 0 && <div className="wallet-product__income"><div className="wallet-product__income-row"><span>Daily income</span><strong>{formatCurrencyAmount(product.displayDailyIncome, product.currencyCode ?? currencyCode)}</strong></div><div className="wallet-product__income-status"><span>{product.incomePaidDays} of {product.durationDays} payouts received</span><span>{product.nextIncomeAt ? `${product.incomePaidDays === 0 ? 'First' : 'Next'} payout ${new Date(product.nextIncomeAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : 'Income schedule complete'}</span></div></div>}</Card>)}</div> : <Card className="wallet-empty"><strong>No purchased products yet</strong><Text>Your wallet will show products after your purchase is approved.</Text><Button appearance="primary" icon={<ArrowRightRegular />} onClick={() => { window.history.pushState({}, '', '/plans'); window.dispatchEvent(new PopStateEvent('popstate')); }}>Browse products</Button></Card>}</section>
    <section><div className="section-heading"><Title2>Transaction history</Title2></div><TransactionHistory showFilters={false} /></section>
  </div>;
}
