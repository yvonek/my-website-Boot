import { Button, createDarkTheme, createLightTheme, FluentProvider, type BrandVariants } from '@fluentui/react-components';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import type { DashboardData, Plan, TransactionStatus, WalletTransactionStatus } from './api/types';
import { AppShell } from './components/AppShell';
import type { AuthUser } from './api/types';
import { playNotificationSound, unlockNotificationSound } from './notifications';

const HomeDashboard = lazy(() => import('./pages/HomeDashboard').then((module) => ({ default: module.HomeDashboard })));
const InvitePage = lazy(() => import('./pages/InvitePage').then((module) => ({ default: module.InvitePage })));
const MePage = lazy(() => import('./pages/MePage').then((module) => ({ default: module.MePage })));
const PlansPage = lazy(() => import('./pages/PlansPage').then((module) => ({ default: module.PlansPage })));
const TeamPage = lazy(() => import('./pages/TeamPage').then((module) => ({ default: module.TeamPage })));
const WalletPage = lazy(() => import('./pages/WalletPage').then((module) => ({ default: module.WalletPage })));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage').then((module) => ({ default: module.TransactionsPage })));
const AdminTransactionsPage = lazy(() => import('./pages/AdminTransactionsPage').then((module) => ({ default: module.AdminTransactionsPage })));
const SupportPage = lazy(() => import('./pages/SupportPage').then((module) => ({ default: module.SupportPage })));
const AdminBusinessSettingsPage = lazy(() => import('./pages/AdminBusinessSettingsPage').then((module) => ({ default: module.AdminBusinessSettingsPage })));
const AdminConsolePage = lazy(() => import('./pages/AdminConsolePage').then((module) => ({ default: module.AdminConsolePage })));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage').then((module) => ({ default: module.AdminUsersPage })));
const AdminMessagesPage = lazy(() => import('./pages/AdminMessagesPage').then((module) => ({ default: module.AdminMessagesPage })));
const AdminPromotersPage = lazy(() => import('./pages/AdminPromotersPage').then((module) => ({ default: module.AdminPromotersPage })));
const AdminLiveUsersPage = lazy(() => import('./pages/AdminLiveUsersPage').then((module) => ({ default: module.AdminLiveUsersPage })));
const UserMessagesPage = lazy(() => import('./pages/UserMessagesPage').then((module) => ({ default: module.UserMessagesPage })));
const DepositPage = lazy(() => import('./pages/DepositPage').then((module) => ({ default: module.DepositPage })));
const WithdrawPage = lazy(() => import('./pages/WithdrawPage').then((module) => ({ default: module.WithdrawPage })));
const LoginPage = lazy(() => import('./pages/AuthPages').then((module) => ({ default: module.LoginPage })));
const RegisterPage = lazy(() => import('./pages/AuthPages').then((module) => ({ default: module.RegisterPage })));

const brandRamp: BrandVariants = { 10: '#2a0710', 20: '#450b18', 30: '#600f20', 40: '#7d1428', 50: '#99192f', 60: '#b31f35', 70: '#c82d42', 80: '#d74355', 90: '#e05d6a', 100: '#e87a83', 110: '#ef999f', 120: '#f4b5b9', 130: '#f8cdd0', 140: '#fbe0e2', 150: '#fdf0f1', 160: '#fff8f8' };

type ViewState = 'loading' | 'error' | 'empty' | 'data';
const defaultPermissions = { dashboard: true, products: true, wallet: true, deposit: true, withdraw: true, myTeam: true, support: true, telegram: true, messages: true } as const;
const decidedTransactionStatuses = new Set<TransactionStatus>(['APPROVED', 'AWAITING_PAYOUT', 'PROCESSING', 'SUCCESS', 'FAILED', 'REJECTED', 'CANCELLED']);

export function hasNewTransactionDecision(previous: Map<string, TransactionStatus> | null, transactions: WalletTransactionStatus[]) {
  if (!previous) return false;
  return transactions.some((transaction) => {
    const previousStatus = previous.get(transaction.id);
    return previousStatus === undefined || previousStatus === 'PENDING' && decidedTransactionStatuses.has(transaction.status);
  });
}

function isDashboardEmpty(data: DashboardData) {
  return data.metrics.length === 0 && data.plans.length === 0 && data.referrals.length === 0 && data.tools.length === 0;
}

function getInitialDarkMode() {
  const saved = localStorage.getItem('app-theme');
  return saved ? saved === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function decodeApplicationServerKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function registerPushSubscription(requestPermission: boolean) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
  const permission = Notification.permission === 'default' && requestPermission ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') return;
  const config = await api.getPushConfiguration();
  if (!config.enabled || !config.publicKey) return;
  const registration = await navigator.serviceWorker.register('/service-worker.js');
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeApplicationServerKey(config.publicKey) as BufferSource });
  await api.savePushSubscription(subscription.toJSON() as import('./api/types').UserPushSubscription);
}

async function unregisterPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const registration = await navigator.serviceWorker.getRegistration('/service-worker.js');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await api.removePushSubscription(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe();
}

function localizeAmounts(message: string, currencyCode: string, rate: number, welcomeBonus?: number) {
  const compact = message.replace(/\n\s*\n+/g, '\n').replace(/\{welcomeBonus\}/gi, welcomeBonus != null ? `${Math.round(welcomeBonus).toLocaleString('en-US')} ${currencyCode}` : '');
  if (!(rate > 0) || currencyCode === 'RWF') return compact;
  return compact.replace(/(\d[\d,]*(?:\.\d+)?)\s*(?:RWF|FRW)\b/gi, (_match, amount: string) => `${Math.round(Number(amount.replace(/,/g, '')) * rate).toLocaleString('en-US')} ${currencyCode}`);
}

function TelegramInvitePopup({ userId, currencyCode = 'RWF', exchangeRate = 1, welcomeBonus }: { userId: string; currencyCode?: string; exchangeRate?: number; welcomeBonus?: number }) {
  const [invitation, setInvitation] = useState<{ url: string; message: string; dismissalKey: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/support/settings')
      .then((response) => response.ok ? response.json() : null)
      .then((settings) => {
        const url = settings?.telegramUrl ?? '';
        if (!active || (!url && !settings?.telegramPopupMessage)) return;
        const message = localizeAmounts(settings.telegramPopupMessage || 'Join our Telegram group for updates and support.', currencyCode, exchangeRate, welcomeBonus);
        const dismissalKey = `telegram-invite-dismissed:${userId}:${JSON.stringify([url, message])}`;
        if (!sessionStorage.getItem(dismissalKey)) setInvitation({ url, message, dismissalKey });
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [userId, currencyCode, exchangeRate, welcomeBonus]);

  const dismiss = () => {
    if (invitation) sessionStorage.setItem(invitation.dismissalKey, '1');
    setInvitation(null);
  };

  if (!invitation) return null;
  return <div className="telegram-invite-backdrop"><section className="telegram-invite" role="dialog" aria-modal="true" aria-labelledby="telegram-invite-title"><span className="telegram-invite__eyebrow">COMMUNITY</span><h2 id="telegram-invite-title">Join our Telegram group</h2><p>{invitation.message}</p><div className="telegram-invite__actions">{invitation.url && <a href={invitation.url} target="_blank" rel="noreferrer" onClick={dismiss}>Join</a>}<button type="button" onClick={dismiss}>Not now</button></div></section></div>;
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [accessUser, setAccessUser] = useState<AuthUser | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [dark, setDark] = useState(getInitialDarkMode);
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(() => localStorage.getItem('notification-sound') === 'on');
  const [data, setData] = useState<DashboardData | null>(null);
  const [state, setState] = useState<ViewState>('loading');
  const [reloadToken, setReloadToken] = useState(0);
  const onAdminRoute = path === '/admin' || path.startsWith('/admin/');

  useEffect(() => { const onPopState = () => setPath(window.location.pathname); window.addEventListener('popstate', onPopState); return () => window.removeEventListener('popstate', onPopState); }, []);
  useEffect(() => {
    if (!notificationSoundEnabled) return;
    document.addEventListener('pointerdown', unlockNotificationSound, true);
    document.addEventListener('keydown', unlockNotificationSound, true);
    return () => {
      document.removeEventListener('pointerdown', unlockNotificationSound, true);
      document.removeEventListener('keydown', unlockNotificationSound, true);
    };
  }, [notificationSoundEnabled]);
  useEffect(() => { api.getCurrentUser().then(({ user }) => { setAuthUser(user); setAccessUser(user); }).catch(() => { setAuthUser(null); setAccessUser(null); }).finally(() => setAuthLoaded(true)); }, []);
  useEffect(() => {
    if (!authLoaded || !authUser) return;
    const sendHeartbeat = () => void fetch('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ path }) }).catch(() => undefined);
    sendHeartbeat();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') sendHeartbeat(); }, 5000);
    const sendLeave = () => { try { navigator.sendBeacon?.('/api/presence', new Blob([JSON.stringify({ path, leave: true })], { type: 'application/json' })); } catch { /* best effort */ } };
    const onVisibility = () => { if (document.visibilityState === 'hidden') sendLeave(); else sendHeartbeat(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', sendLeave);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', sendLeave); };
  }, [authLoaded, authUser?.id, path]);
  useEffect(() => {
    if (!authUser) { setAccessUser(null); return; }
    let cancelled = false;
    const refreshAccess = async () => {
      try { const access = await api.getUserAccountState(); if (!cancelled) setAccessUser((current) => current ? { ...current, ...access } : current); }
      catch (error) { if (!cancelled && error instanceof Error && error.message === 'Authentication required.') { setAuthUser(null); setAccessUser(null); } }
    };
    void refreshAccess();
    const timer = window.setInterval(() => void refreshAccess(), 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [authUser?.id]);
  useEffect(() => {
    if (!authLoaded || !authUser || onAdminRoute) return;
    let cancelled = false;
    let inFlight = false;
    let previousMessageIds: Set<string> | null = null;
    let previousPayoutDays: Map<string, number> | null = null;
    let previousTransactionStatuses: Map<string, TransactionStatus> | null = null;
    const pollNotifications = async () => {
      if (cancelled || inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      let hasNewNotification = false;
      const [messagesResult, productsResult, transactionsResult] = await Promise.allSettled([api.getUserMessages(), api.getWalletProducts(), api.getTransactionStatuses()]);
      if (cancelled) return;
      if (messagesResult.status === 'fulfilled' && Array.isArray(messagesResult.value.messages)) {
        const messageIds = new Set(messagesResult.value.messages.map((message) => message.id));
        if (previousMessageIds && messagesResult.value.messages.some((message) => !previousMessageIds?.has(message.id))) hasNewNotification = true;
        previousMessageIds = messageIds;
      }
      if (productsResult.status === 'fulfilled' && Array.isArray(productsResult.value.products)) {
        const payoutDays = new Map(productsResult.value.products.map((product) => [product.id, product.incomePaidDays]));
        if (previousPayoutDays && [...payoutDays].some(([id, days]) => days > (previousPayoutDays?.get(id) ?? 0))) hasNewNotification = true;
        previousPayoutDays = payoutDays;
      }
      if (transactionsResult.status === 'fulfilled' && Array.isArray(transactionsResult.value.transactions)) {
        if (hasNewTransactionDecision(previousTransactionStatuses, transactionsResult.value.transactions)) hasNewNotification = true;
        previousTransactionStatuses = new Map(transactionsResult.value.transactions.map((transaction) => [transaction.id, transaction.status]));
      }
      if (hasNewNotification && notificationSoundEnabled) playNotificationSound();
      inFlight = false;
    };
    void pollNotifications();
    const timer = window.setInterval(() => void pollNotifications(), 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [authLoaded, authUser?.id, onAdminRoute, notificationSoundEnabled]);
  useEffect(() => {
    if (!authLoaded || !authUser || !notificationSoundEnabled) return;
    void registerPushSubscription(false).catch(() => undefined);
  }, [authLoaded, authUser?.id, notificationSoundEnabled]);
  useEffect(() => { localStorage.setItem('app-theme', dark ? 'dark' : 'light'); }, [dark]);
  const toggleNotificationSound = async () => {
    if (notificationSoundEnabled) {
      setNotificationSoundEnabled(false);
      localStorage.setItem('notification-sound', 'off');
      await unregisterPushSubscription().catch(() => undefined);
      return;
    }
    setNotificationSoundEnabled(true);
    localStorage.setItem('notification-sound', 'on');
    playNotificationSound();
    await registerPushSubscription(true).catch(() => undefined);
  };
  useEffect(() => {
    if (!authLoaded || !authUser || onAdminRoute) return;
    let cancelled = false;
    const loadingFailsafe = window.setTimeout(() => {
      if (!cancelled) setState('error');
    }, 30000);
    setState('loading');
    api.getDashboard().then((result) => {
      if (cancelled) return;
      window.clearTimeout(loadingFailsafe);
      setData(result);
      setState(isDashboardEmpty(result) ? 'empty' : 'data');
    }).catch((reason: unknown) => {
      if (cancelled) return;
      window.clearTimeout(loadingFailsafe);
      setState('error');
      if (reason instanceof Error && reason.message === 'Authentication required.') {
        setAuthUser(null);
      }
    });
    return () => { cancelled = true; window.clearTimeout(loadingFailsafe); };
  }, [reloadToken, authLoaded, authUser, onAdminRoute]);
  useEffect(() => {
    if ((path !== '/plans' && path !== '/') || !authLoaded || !authUser) return;
    let cancelled = false;
    const refreshCatalog = () => void api.getDashboard().then((result) => {
      if (!cancelled) setData((current) => current ? { ...current, plans: result.plans } : result);
    }).catch(() => undefined);
    const timer = window.setInterval(refreshCatalog, 10000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [path, authLoaded, authUser?.id]);
  const theme = useMemo(() => dark ? createDarkTheme(brandRamp) : createLightTheme(brandRamp), [dark]);
  const retry = () => setReloadToken((value) => value + 1);
  const authenticate = (user: AuthUser) => { Object.keys(sessionStorage).filter((key) => key.startsWith('telegram-invite-dismissed:')).forEach((key) => sessionStorage.removeItem(key)); const destination = user.role === 'ADMIN' ? '/admin' : '/'; setAuthUser(user); setAccessUser(user); setPath(destination); window.history.replaceState({}, '', destination); };
  const refreshProducts = (updatedPlan: Plan) => setData((current) => current ? { ...current, plans: current.plans.map((plan) => plan.id === updatedPlan.id ? updatedPlan : plan) } : current);
  const logout = async () => { try { await api.logout(); } finally { Object.keys(sessionStorage).filter((key) => key.startsWith('telegram-invite-dismissed:')).forEach((key) => sessionStorage.removeItem(key)); setAuthUser(null); setPath('/login'); window.history.replaceState({}, '', '/login'); } };
  const isAuthRoute = path === '/login' || path === '/register';
  useEffect(() => { if (!authLoaded) return; if (!authUser && !isAuthRoute) { setPath('/login'); window.history.replaceState({}, '', '/login'); } else if (authUser && isAuthRoute) { const destination = authUser.role === 'ADMIN' ? '/admin' : '/'; setPath(destination); window.history.replaceState({}, '', destination); } }, [authLoaded, authUser, isAuthRoute]);
  const guardedFeature = path === '/plans' ? 'products' : path === '/wallet' ? 'wallet' : path === '/deposit' ? 'deposit' : path === '/withdraw' ? 'withdraw' : path === '/team' || path === '/invite' ? 'myTeam' : path === '/support' ? 'support' : path === '/messages' ? 'messages' : path === '/' ? 'dashboard' : null;
  const effectivePermissions = accessUser?.permissions ?? authUser?.permissions ?? defaultPermissions;
  const featureDenied = Boolean(guardedFeature && accessUser && !effectivePermissions[guardedFeature]);
  const paymentDenied = path === '/deposit' && effectivePermissions.deposit && accessUser?.allowDeposits === false || path === '/withdraw' && effectivePermissions.withdraw && accessUser?.allowWithdrawals === false;
  const accountDenied = accessUser?.accountStatus === 'FROZEN' || accessUser?.accountStatus === 'SUSPENDED';
  const page = path === '/register' ? <RegisterPage onAuthenticated={authenticate} /> : path === '/login' ? <LoginPage onAuthenticated={authenticate} /> : !authLoaded ? <div className="state-panel">Loading your session...</div> : !authUser ? <LoginPage onAuthenticated={authenticate} /> : path === '/admin' ? authUser.role === 'ADMIN' ? <AdminConsolePage adminName={authUser.fullName} onLogout={logout} /> : <div className="admin-access-denied"><span className="hero-eyebrow">Restricted</span><h1>Admin access required</h1><p>This account does not have Admin access. Use the bootstrap setup to authorize the Admin phone account.</p><Button appearance="primary" onClick={() => { window.history.pushState({}, '', '/admin/settings'); setPath('/admin/settings'); }}>Open Admin setup</Button></div> : path === '/admin/users' ? authUser.role === 'ADMIN' ? <AdminUsersPage /> : <div className="admin-access-denied"><h1>Admin access required</h1></div> : path === '/admin/messages' ? authUser.role === 'ADMIN' ? <AdminMessagesPage /> : <div className="admin-access-denied"><h1>Admin access required</h1></div> : accountDenied && path !== '/me' && !(accessUser?.accountStatus === 'FROZEN' && path === '/messages') ? <div className="account-restriction-page"><h1>{accessUser?.accountStatus === 'FROZEN' ? 'Account frozen' : 'Account suspended'}</h1><p>{accessUser?.accountStatus === 'FROZEN' ? 'Your account is frozen by an administrator. Contact support for assistance.' : 'Your account is suspended. Contact support for assistance.'}</p><Button appearance="secondary" onClick={() => { window.history.pushState({}, '', '/messages'); setPath('/messages'); }}>Open account messages</Button></div> : featureDenied ? <div className="account-restriction-page"><h1>Feature unavailable</h1><p>{guardedFeature === 'deposit' ? 'Deposit access is disabled for this account.' : guardedFeature === 'withdraw' ? 'Withdrawal access is disabled for this account.' : `Access to ${guardedFeature} is disabled for this account.`} Contact support if you need help.</p><Button appearance="secondary" onClick={() => { window.history.pushState({}, '', '/support'); setPath('/support'); }}>Open support</Button></div> : paymentDenied ? <div className="account-restriction-page"><h1>{path === '/deposit' ? 'Deposits disabled' : 'Withdrawals disabled'}</h1><p>This action is currently disabled for your account by an administrator.</p></div> : path === '/plans' ? <PlansPage data={data} state={state} onRetry={retry} onPurchased={refreshProducts} /> : path === '/invite' || path === '/team' ? <TeamPage data={data} state={state} onRetry={retry} /> : path === '/wallet' ? <WalletPage data={data} state={state} onRetry={retry} /> : path === '/deposit' ? <DepositPage /> : path === '/withdraw' ? <WithdrawPage /> : path === '/support' ? <SupportPage allowTelegram={accessUser?.permissions.telegram ?? true} /> : path === '/messages' ? <UserMessagesPage /> : path === '/transactions' ? <TransactionsPage /> : path === '/admin/transactions' ? <AdminTransactionsPage /> : path === '/admin/settings' ? <AdminBusinessSettingsPage /> : path === '/me' ? <MePage user={authUser} data={data} state={state} onRetry={retry} /> : <HomeDashboard data={data} state={state} onRetry={retry} />;
  const isAdminPath = path === '/admin' || path.startsWith('/admin/');
  const renderedPage = isAdminPath && authLoaded && authUser
    ? authUser.role === 'ADMIN'
      ? <AdminConsolePage adminName={authUser.fullName} onLogout={logout} />
      : path === '/admin/settings'
        ? <AdminBusinessSettingsPage />
        : <div className="admin-access-denied"><h1>Admin access required</h1><p>This account does not have Admin access.</p></div>
    : page;
  if (isAuthRoute || !authLoaded || !authUser) return <FluentProvider theme={theme} className="fluent-app"><Suspense fallback={<div className="state-panel">Loading...</div>}>{renderedPage}</Suspense></FluentProvider>;
  if (isAdminPath) return <FluentProvider theme={theme} className={authUser.role === 'ADMIN' ? 'fluent-app admin-console-provider' : 'fluent-app'}><Suspense fallback={<div className="state-panel">Loading...</div>}>{renderedPage}</Suspense></FluentProvider>;
  return <FluentProvider theme={theme} className="fluent-app"><AppShell path={path} dark={dark} isAdmin={authUser.role === 'ADMIN'} permissions={effectivePermissions} accountStatus={accessUser?.accountStatus ?? authUser.accountStatus ?? 'ACTIVE'} userName={authUser.fullName} notificationSoundEnabled={notificationSoundEnabled} onToggleNotificationSound={toggleNotificationSound} onLogout={logout} onToggleTheme={() => setDark((value) => !value)}><Suspense fallback={<div className="state-panel">Loading...</div>}>{renderedPage}</Suspense></AppShell>{authUser.role === 'USER' && <TelegramInvitePopup userId={authUser.id} currencyCode={authUser.currencyCode} exchangeRate={authUser.exchangeRate} welcomeBonus={authUser.displayWelcomeBonusAmount} />}</FluentProvider>;
}

