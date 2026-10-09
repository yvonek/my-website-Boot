/// <reference types="vite/client" />

import { Button, MessageBar, MessageBarBody, Skeleton, Text } from '@fluentui/react-components';
import { ArrowDownRegular, ArrowUpRegular, EyeOffRegular, EyeRegular, StarRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import type { Plan } from '../api/types';
import { api } from '../api';
import { formatCurrencyAmount } from '../api/money';
import type { DashboardData, WalletBalance } from '../api/types';
import { PlanCard } from '../components/PlanCard';

const tomatoSlides = [
  { src: '/assets/home-tomatoes-aquaponics.webp', alt: 'Tomato plants growing in an aquaponics system', label: 'Aquaponics harvest', category: 'Tomato growing' },
  { src: '/assets/home-tomatoes-garden.jpg', alt: 'Ripe tomatoes growing among garden leaves', label: 'Garden-grown tomatoes', category: 'Tomato growing' },
  { src: '/assets/registration-background.jpg', alt: 'A team working together in an office', label: 'Our team', category: 'Our community' },
  { src: '/assets/home-tomatoes-greenhouse.png', alt: 'Colorful tomatoes growing in a greenhouse', label: 'Greenhouse tomatoes', category: 'Tomato growing' },
  { src: '/assets/home-tomatoes-harvest.png', alt: 'Baskets filled with freshly harvested tomatoes', label: 'Tomato harvest', category: 'Fresh harvest' },
  { src: '/assets/home-tomato-sauce.png', alt: 'Fresh tomato sauce being prepared in a pan', label: 'Fresh tomato sauce', category: 'Tomato recipes' },
];

export function HomeDashboard({ data, state, onRetry }: { data: DashboardData | null; state: string; onRetry: () => void }) {
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [homePlanUpdates, setHomePlanUpdates] = useState<Record<string, Plan>>({});
  const [purchasedProductNames, setPurchasedProductNames] = useState<string[]>([]);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [activeTomatoSlide, setActiveTomatoSlide] = useState(0);
  const [checkin, setCheckin] = useState<{ enabled: boolean; rewardAmount: number; claimed: boolean } | null>(null);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [checkinMessage, setCheckinMessage] = useState('');

  useEffect(() => {
    api.getBalance().then(setBalance).catch(() => undefined);
    api.getWalletProducts().then(({ products }) => setPurchasedProductNames(products.map((product) => product.name))).catch(() => undefined);
    api.getDailyCheckin().then(setCheckin).catch(() => setCheckin(null));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setActiveTomatoSlide((slide) => (slide + 1) % tomatoSlides.length), 6000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => { setHomePlanUpdates({}); }, [data?.plans]);

  if (state === 'loading') return <div className="state-panel"><Skeleton aria-label="Loading dashboard" /><Skeleton /><Skeleton /></div>;
  if (state === 'error' || !data) return <MessageBar intent="error"><MessageBarBody>Dashboard data is unavailable right now. <Button appearance="transparent" onClick={onRetry}>Retry loading data</Button></MessageBarBody></MessageBar>;

  const totalBalance = balance ? balance.availableBalance + (balance.lockedWelcomeBonus ?? 0) : null;
  const currencyCode = balance?.currencyCode ?? 'RWF';
  const displayAvailableBalance = balance?.displayAvailableBalance ?? balance?.availableBalance ?? 0;
  const displayLockedBonus = balance?.displayLockedWelcomeBonus ?? balance?.lockedWelcomeBonus ?? 0;
  const balanceText = balanceVisible ? totalBalance !== null ? formatCurrencyAmount(displayAvailableBalance + displayLockedBonus, currencyCode) : '—' : '••••••';
  const balanceDetail = balance ? `${formatCurrencyAmount(displayAvailableBalance, currencyCode)} available${displayLockedBonus ? ` · ${formatCurrencyAmount(displayLockedBonus, currencyCode)} locked until product purchase` : ''}` : 'Wallet balance';
  const claimCheckin = async () => {
    setCheckinBusy(true);
    setCheckinMessage('');
    try {
      const result = await api.claimDailyCheckin();
      setBalance(result.balance);
      setCheckin((current) => current ? { ...current, claimed: true } : current);
      setCheckinMessage(`Received ${formatCurrencyAmount(result.displayRewardAmount ?? result.rewardAmount, result.currencyCode ?? currencyCode)}`);
    } catch (reason) {
      setCheckinMessage(reason instanceof Error ? reason.message : 'Daily check-in could not be claimed.');
    } finally {
      setCheckinBusy(false);
    }
  };

  const homePlans = data?.plans.map((plan) => homePlanUpdates[plan.id ?? plan.name] ?? plan) ?? [];
  const refreshHomePlan = (updatedPlan: Plan) => {
    setHomePlanUpdates((current) => ({ ...current, [updatedPlan.id ?? updatedPlan.name]: updatedPlan }));
    setPurchasedProductNames((current) => current.includes(updatedPlan.name) ? current : [...current, updatedPlan.name]);
  };

  return <div className="home-dashboard">
    <section className="home-tomato-carousel" aria-label="Featured tomato growing, harvest, and recipe photos" aria-roledescription="carousel">
      <img key={tomatoSlides[activeTomatoSlide].src} className="home-tomato-carousel__image" src={tomatoSlides[activeTomatoSlide].src} alt={tomatoSlides[activeTomatoSlide].alt} />
      <div className="home-tomato-carousel__shade" />
      <div className="home-tomato-carousel__caption" aria-live="polite"><span>{tomatoSlides[activeTomatoSlide].category}</span><strong>{tomatoSlides[activeTomatoSlide].label}</strong></div>
    </section>

    <section className="home-balance-card" aria-label="Wallet balance">
      <div className="home-balance-card__top"><span>Wallet balance</span><button type="button" aria-label={balanceVisible ? 'Hide balance' : 'Show balance'} onClick={() => setBalanceVisible((visible) => !visible)}>{balanceVisible ? <EyeOffRegular /> : <EyeRegular />}</button></div>
      <strong className="home-balance-card__amount">{balanceText}</strong>
      <Text className="home-balance-card__trend">{balanceDetail}</Text>
      <div className={checkin?.enabled ? 'home-balance-card__actions home-balance-card__actions--checkin' : 'home-balance-card__actions'}><a href="/deposit" className="home-primary-action"><ArrowDownRegular /> Deposit</a><a href="/withdraw" className="home-secondary-action"><ArrowUpRegular /> Withdraw</a>{checkin?.enabled && <button className="home-checkin-action" type="button" disabled={checkin.claimed || checkinBusy} onClick={() => void claimCheckin()}><StarRegular />{checkin.claimed ? 'Checked in' : checkinBusy ? 'Checking...' : `Check in · ${formatCurrencyAmount(checkin.displayRewardAmount ?? checkin.rewardAmount, checkin.currencyCode ?? currencyCode)}`}</button>}</div>
      {checkinMessage && <span className="home-checkin-message" role="status">{checkinMessage}</span>}
    </section>

    <section className="home-section home-products-section" aria-labelledby="home-products-title">
      <div className="home-section__heading"><div><span className="home-kicker">Explore</span><h2 id="home-products-title">Available products</h2></div><a href="/plans" className="home-text-link">View all</a></div>
      {homePlans.length ? <div className="plan-grid plan-grid--home">{homePlans.slice(0, 4).map((plan) => <PlanCard key={plan.id ?? plan.name} plan={plan} alreadyPurchased={purchasedProductNames.includes(plan.name)} onPurchased={refreshHomePlan} />)}</div> : <div className="home-products-empty"><strong>No products available</strong><span>Products will appear here when they are added to the catalog.</span></div>}
    </section>
  </div>;
}
