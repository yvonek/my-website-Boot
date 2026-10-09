import { Button, createDarkTheme, createLightTheme, FluentProvider, type BrandVariants } from '@fluentui/react-components';
import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import type { DashboardData, Plan } from './api/types';
import { AppShell } from './components/AppShell';
import { HomeDashboard } from './pages/HomeDashboard';
import { InvitePage } from './pages/InvitePage';
import { MePage } from './pages/MePage';
import { PlansPage } from './pages/PlansPage';
import { TeamPage } from './pages/TeamPage';
import { WalletPage } from './pages/WalletPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { AdminTransactionsPage } from './pages/AdminTransactionsPage';
import { SupportPage } from './pages/SupportPage';
import { AdminBusinessSettingsPage } from './pages/AdminBusinessSettingsPage';
import { AdminConsolePage } from './pages/AdminConsolePage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AdminMessagesPage } from './pages/AdminMessagesPage';
import { AdminPromotersPage } from './pages/AdminPromotersPage';
import { AdminLiveUsersPage } from './pages/AdminLiveUsersPage';
import { UserMessagesPage } from './pages/UserMessagesPage';
import { DepositPage } from './pages/DepositPage';
import { WithdrawPage } from './pages/WithdrawPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import type { AuthUser } from './api/types';

const brandRamp: BrandVariants = { 10: '#2a0710', 20: '#450b18', 30: '#600f20', 40: '#7d1428', 50: '#99192f', 60: '#b31f35', 70: '#c82d42', 80: '#d74355', 90: '#e05d6a', 100: '#e87a83', 110: '#ef999f', 120: '#f4b5b9', 130: '#f8cdd0', 140: '#fbe0e2', 150: '#fdf0f1', 160: '#fff8f8' };

type ViewState = 'loading' | 'error' | 'empty' | 'data';
const defaultPermissions = { dashboard: true, products: true, wallet: true, deposit: true, withdraw: true, myTeam: true, support: true, telegram: true, messages: true } as const;

function isDashboardEmpty(data: DashboardData) {
  return data.metrics.length === 0 && data.plans.length === 0 && data.referrals.length === 0 && data.tools.length === 0;
}

function getInitialDarkMode() {
  const saved = localStorage.getItem('app-theme');
  return saved ? saved === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function TelegramInvitePopup({ userId }: { userId: string }) {
  const [invitation, setInvitation] = useState<{ url: string; message: string } | null>(null);

  useEffect(() => {
    const storageKey = `telegram-invite-dismissed:${userId}`;
    if (localStorage.getItem(storageKey)) return;
    let active = true;
    fetch('/api/support/settings')
      .then((response) => response.ok ? response.json() : null)
      .then((settings) => {
        if (active && settings?.telegramUrl) setInvitation({ url: settings.telegramUrl, message: settings.telegramPopupMessage || 'Join our Telegram group for updates and support.' });
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [userId]);

  const dismiss = () => {
    localStorage.setItem(`telegram-invite-dismissed:${userId}`, '1');
    setInvitation(null);
  };

  if (!invitation) return null;
  return <div className="telegram-invite-backdrop"><section className="telegram-invite" role="dialog" aria-modal="true" aria-labelledby="telegram-invite-title"><span className="telegram-invite__eyebrow">COMMUNITY</span><h2 id="telegram-invite-title">Join our Telegram group</h2><p>{invitation.message}</p><div className="telegram-invite__actions"><a href={invitation.url} target="_blank" rel="noreferrer" onClick={dismiss}>Open Telegram</a><button type="button" onClick={dismiss}>Not now</button></div></section></div>;
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [accessUser, setAccessUser] = useState<AuthUser | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [dark, setDark] = useState(getInitialDarkMode);
  const [data, setData] = useState<DashboardData | null>(null);
  const [state, setState] = useState<ViewState>('loading');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => { const onPopState = () => setPath(window.location.pathname); window.addEventListener('popstate', onPopState); return () => window.removeEventListener('popstate', onPopState); }, []);
  useEffect(() => { api.getCurrentUser().then(({ user }) => { setAuthUser(user); setAccessUser(user); }).catch(() => { setAuthUser(null); setAccessUser(null); }).finally(() => setAuthLoaded(true)); }, []);
  useEffect(() => {
    if (!authLoaded || !authUser) return;
    const sendHeartbeat = () => void fetch('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ path }) }).catch(() => undefined);
    sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, 15000);
    return () => window.clearInterval(timer);
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
  useEffect(() => { localStorage.setItem('app-theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => {
    if (!authLoaded || !authUser) return;
    let cancelled = false;
    const loadingFailsafe = window.setTimeout(() => {
      if (!cancelled) setState('error');
    }, 5000);
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
  }, [reloadToken, authLoaded, authUser]);
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
  const authenticate = (user: AuthUser) => { const destination = user.role === 'ADMIN' ? '/admin' : '/'; setAuthUser(user); setAccessUser(user); setPath(destination); window.history.replaceState({}, '', destination); };
  const refreshProducts = (updatedPlan: Plan) => setData((current) => current ? { ...current, plans: current.plans.map((plan) => plan.id === updatedPlan.id ? updatedPlan : plan) } : current);
  const logout = async () => { try { await api.logout(); } finally { setAuthUser(null); setPath('/login'); window.history.replaceState({}, '', '/login'); } };
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
  if (isAuthRoute || !authLoaded || !authUser) return <FluentProvider theme={theme} className="fluent-app">{renderedPage}</FluentProvider>;
  if (isAdminPath) return <FluentProvider theme={theme} className={authUser.role === 'ADMIN' ? 'fluent-app admin-console-provider' : 'fluent-app'}>{renderedPage}</FluentProvider>;
  return <FluentProvider theme={theme} className="fluent-app"><AppShell path={path} dark={dark} isAdmin={authUser.role === 'ADMIN'} permissions={effectivePermissions} accountStatus={accessUser?.accountStatus ?? authUser.accountStatus ?? 'ACTIVE'} userName={authUser.fullName} onLogout={logout} onToggleTheme={() => setDark((value) => !value)}>{renderedPage}</AppShell>{authUser.role === 'USER' && <TelegramInvitePopup userId={authUser.id} />}</FluentProvider>;
}

