import { Badge, Button, Card, Field, Input, MessageBar, MessageBarBody, Text, Textarea, Title1, Title2 } from '@fluentui/react-components';
import { ArrowDownRegular, ArrowUpRegular, CheckmarkCircleRegular, ClipboardTaskRegular, GiftRegular, PeopleRegular, SettingsRegular, WalletRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { AdminBusinessSettingsPage } from './AdminBusinessSettingsPage';
import { AdminCountrySettingsPage } from './AdminCountrySettingsPage';
import { AdminTransactionsPage } from './AdminTransactionsPage';
import { SignOutRegular } from '@fluentui/react-icons';
import { AdminUsersPage } from './AdminUsersPage';
import { AdminMessagesPage } from './AdminMessagesPage';
import { AdminPromotersPage } from './AdminPromotersPage';
import { AdminLiveUsersPage } from './AdminLiveUsersPage';
import type { ChangeEvent } from 'react';
import { api } from '../api';
import type { AdminPlanInput, Plan } from '../api/types';

type AdminView = 'overview' | 'members' | 'active' | 'deposits' | 'withdrawals' | 'plans' | 'rewards' | 'promoters' | 'messages' | 'settings' | 'countries' | 'audit';
interface AdminPlan { name: string; description: string; imageData: string; price: number; dailyIncome: number; durationDays: number; purchaseBonus: number; totalSlots: number; soldSlots: number; remainingSlots: number; progressPercent: number; soldOut: boolean; status: Plan['status']; position: number; deposited: string; incomePerDay: number; term: string; note: string; }
interface Overview { members: number; pendingDeposits: { count: number; amount: number }; pendingWithdrawals: { count: number; amount: number }; plans: number; summary?: { totalUsers: number; activeUsers: number; liveUsers: number; totalDeposit: number; totalWithdrawal: number; totalProductsSold: number; totalReferrals: number; totalReferralCommissions: number }; }
interface AuditEntry { id: string; targetUserId?: string | null; adminUserId?: string | null; action: string; previousValue?: string | null; newValue?: string | null; metadata?: string | null; createdAt: string; }

const navigation: { id: AdminView; label: string; icon: typeof WalletRegular }[] = [
  { id: 'overview', label: 'Overview', icon: CheckmarkCircleRegular },
  { id: 'members', label: 'Users', icon: PeopleRegular },
  { id: 'active', label: 'Active users', icon: CheckmarkCircleRegular },
  { id: 'deposits', label: 'Deposits', icon: ArrowDownRegular },
  { id: 'withdrawals', label: 'Withdrawals', icon: ArrowUpRegular },
  { id: 'plans', label: 'Plans', icon: WalletRegular },
  { id: 'rewards', label: 'Rewards', icon: GiftRegular },
  { id: 'promoters', label: 'Promoters', icon: PeopleRegular },
  { id: 'live', label: 'Live users', icon: PeopleRegular },
  { id: 'messages', label: 'Messages', icon: ClipboardTaskRegular },
  { id: 'settings', label: 'Settings', icon: SettingsRegular },
  { id: 'countries', label: 'Countries', icon: SettingsRegular },
  { id: 'audit', label: 'Audit log', icon: ClipboardTaskRegular },
];

const adminRouteByView: Record<AdminView, string> = {
  overview: '/admin', members: '/admin/users', deposits: '/admin/deposits', withdrawals: '/admin/withdrawals',
  plans: '/admin/products', rewards: '/admin/rewards', promoters: '/admin/referrals', active: '/admin/active-users', live: '/admin/live-users',
  messages: '/admin/messages', settings: '/admin/settings', countries: '/admin/countries', audit: '/admin/audit',
};

function adminViewForPath(path: string): AdminView {
  if (path === '/admin/users') return 'members';
  if (path === '/admin/active-users') return 'active';
  if (path === '/admin/live-users') return 'live';
  if (path === '/admin/deposits') return 'deposits';
  if (path === '/admin/withdrawals') return 'withdrawals';
  if (path === '/admin/products' || path === '/admin/plans') return 'plans';
  if (path === '/admin/rewards') return 'rewards';
  if (path === '/admin/referrals' || path === '/admin/promoters') return 'promoters';
  if (path === '/admin/messages') return 'messages';
  if (path === '/admin/settings') return 'settings';
  if (path === '/admin/countries') return 'countries';
  if (path === '/admin/audit') return 'audit';
  return 'overview';
}

const emptyPlan: AdminPlan = { name: '', description: '', imageData: '', price: 0, dailyIncome: 0, durationDays: 0, purchaseBonus: 0, totalSlots: 0, soldSlots: 0, remainingSlots: 0, progressPercent: 0, soldOut: false, status: 'Active', position: 0, deposited: '', incomePerDay: 0, term: '', note: '' };

function planDraftFrom(plan: Plan): AdminPlan {
  return { ...emptyPlan, ...plan, imageData: plan.imageData ?? '', description: plan.description ?? plan.note, price: plan.price ?? 0, dailyIncome: plan.dailyIncome ?? plan.incomePerDay, durationDays: plan.durationDays ?? plan.termDays ?? 0, purchaseBonus: plan.purchaseBonus ?? 0, totalSlots: plan.totalSlots ?? 0, soldSlots: plan.soldSlots ?? 0, remainingSlots: plan.remainingSlots ?? 0, progressPercent: plan.progressPercent ?? 0, soldOut: plan.soldOut ?? false, term: plan.term, deposited: String(plan.price ?? plan.deposited), incomePerDay: plan.dailyIncome ?? plan.incomePerDay, note: plan.description ?? plan.note };
}

function readProductImage(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return Promise.reject(new Error('Choose a PNG, JPEG, or WebP product image.'));
  if (file.size > 4 * 1024 * 1024) return Promise.reject(new Error('Product images must be 4 MB or smaller.'));
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read product image.')); reader.onerror = () => reject(new Error('Could not read product image.')); reader.readAsDataURL(file); });
}

export function AdminConsolePage({ adminName, onLogout }: { adminName: string; onLogout: () => void }) {
  const [view, setView] = useState<AdminView>(() => adminViewForPath(window.location.pathname));
  const [selectedUserId, setSelectedUserId] = useState(() => new URLSearchParams(window.location.search).get('userId') ?? '');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [planDraft, setPlanDraft] = useState<AdminPlan | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [transactionStatusFilter, setTransactionStatusFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING');

  const loadOverview = async () => {
    const response = await fetch('/api/admin/overview');
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Overview could not be loaded.');
    setOverview(body);
  };

  const loadPlans = async () => {
    const { plans: adminPlans } = await api.getAdminPlans();
    setPlans(adminPlans);
  };

  const loadAudit = async () => {
    const response = await fetch('/api/admin/audit-log');
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Audit log could not be loaded.');
    setAuditEntries(body.entries);
  };

  const refreshView = async (target: AdminView) => {
    setBusy(true);
    setMessage('');
    try {
      if (target === 'overview') await loadOverview();
      if (target === 'plans') await loadPlans();
      if (target === 'audit') await loadAudit();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Admin data could not be loaded.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void refreshView(view); }, [view]);

  useEffect(() => {
    const syncView = () => setView(adminViewForPath(window.location.pathname));
    window.addEventListener('popstate', syncView);
    return () => window.removeEventListener('popstate', syncView);
  }, []);

  const navigateToView = (target: AdminView) => {
    if (target !== 'members') setSelectedUserId('');
    const targetPath = adminRouteByView[target];
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } else setView(target);
  };

  const openUserDetails = (userId: string) => {
    setSelectedUserId(userId);
    window.history.pushState({}, '', `${adminRouteByView.members}?userId=${encodeURIComponent(userId)}`);
    setView('members');
  };

  const savePlan = async () => {
    if (!planDraft) return;
    setBusy(true);
    setMessage('');
    try {
      const editing = plans.some((plan) => plan.name === planDraft.name);
      const input: AdminPlanInput = { name: planDraft.name, description: planDraft.description, imageData: planDraft.imageData, price: planDraft.price, dailyIncome: planDraft.dailyIncome, durationDays: planDraft.durationDays, purchaseBonus: planDraft.purchaseBonus, totalSlots: planDraft.totalSlots, status: planDraft.status, position: planDraft.position };
      if (editing) await api.updateAdminPlan(planDraft.name, input);
      else await api.createAdminPlan(input);
      setPlanDraft(null);
      setMessage(editing ? 'Plan saved.' : 'Plan created.');
      await loadPlans();
      await loadOverview();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Plan could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const deletePlan = async (plan: AdminPlan) => {
    setBusy(true);
    setMessage('');
    try {
      await api.deleteAdminPlan(plan.name);
      setMessage('Plan deleted.');
      await loadPlans();
      await loadOverview();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Plan could not be deleted.');
    } finally {
      setBusy(false);
    }
  };

  const renderView = () => {
    if (view === 'deposits' || view === 'withdrawals') return <section className="admin-console-section admin-console-section--transactions" data-status-filter={transactionStatusFilter.toLowerCase()}><div className="admin-console-heading admin-transaction-page-heading"><div><Text className="home-kicker">TRANSACTION REVIEW</Text><Title1>{view === 'deposits' ? 'Deposits' : 'Withdrawals'}</Title1></div></div><div className="admin-transaction-status-tabs" role="group" aria-label="Filter transactions by status">{(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map((status) => <Button key={status} size="small" appearance={transactionStatusFilter === status ? 'primary' : 'secondary'} aria-pressed={transactionStatusFilter === status} onClick={() => setTransactionStatusFilter(status)}>{status === 'ALL' ? 'All' : status.charAt(0) + status.slice(1).toLowerCase()}</Button>)}</div><AdminTransactionsPage sessionAdmin typeFilter={view === 'deposits' ? 'DEPOSIT' : 'WITHDRAWAL'} statusFilter={transactionStatusFilter} /></section>;
    if (view === 'settings') return <AdminBusinessSettingsPage sessionAdmin section="settings" />;
    if (view === 'countries') return <AdminCountrySettingsPage />;
    if (view === 'rewards') return <AdminBusinessSettingsPage sessionAdmin section="rewards" />;
    if (view === 'promoters') return <AdminPromotersPage onOpenUser={openUserDetails} />;
    if (view === 'live') return <AdminLiveUsersPage onOpenUser={openUserDetails} />;
    if (view === 'messages') return <AdminMessagesPage />;
    if (view === 'members') return <AdminUsersPage initialSelectedUserId={selectedUserId || undefined} />;
    if (view === 'active') return <AdminUsersPage activeOnly />;
    if (view === 'overview') return <>
      <div className="admin-console-heading"><div><Text className="home-kicker">ADMIN CONSOLE</Text><Title1>Overview</Title1></div><Text className="admin-console-greeting">Signed in as {adminName}</Text></div>
      {overview && <div className="admin-overview-grid">
        <button type="button" className="admin-overview-card" onClick={() => navigateToView('members')}><span className="admin-overview-card__icon"><PeopleRegular /></span><span>Total users</span><strong>{(overview.summary?.totalUsers ?? overview.members).toLocaleString()}</strong></button>
        <button type="button" className="admin-overview-card" onClick={() => navigateToView('active')}><span className="admin-overview-card__icon"><CheckmarkCircleRegular /></span><span>Active users</span><strong>{(overview.summary?.activeUsers ?? 0).toLocaleString()}</strong><small>Users with completed purchases</small></button>
        <button type="button" className="admin-overview-card" onClick={() => navigateToView('live')}><span className="admin-overview-card__icon"><PeopleRegular /></span><span>Live users</span><strong>{(overview.summary?.liveUsers ?? overview.liveUsers ?? 0).toLocaleString()}</strong></button>
        <button type="button" className="admin-overview-card" onClick={() => navigateToView('deposits')}><span className="admin-overview-card__icon"><ArrowDownRegular /></span><span>Total deposits</span><strong className={(overview.summary?.totalDeposit ?? overview.completedDeposits ?? 0) === 0 ? 'is-zero' : undefined}>{(overview.summary?.totalDeposit ?? overview.completedDeposits ?? 0).toLocaleString()} RWF</strong><small>Approved deposit volume</small></button>
        <button type="button" className="admin-overview-card" onClick={() => navigateToView('withdrawals')}><span className="admin-overview-card__icon"><ArrowUpRegular /></span><span>Total withdrawals</span><strong className={(overview.summary?.totalWithdrawal ?? overview.completedWithdrawals ?? 0) === 0 ? 'is-zero' : undefined}>{(overview.summary?.totalWithdrawal ?? overview.completedWithdrawals ?? 0).toLocaleString()} RWF</strong><small>Approved withdrawal volume</small></button>
        <button type="button" className="admin-overview-card" onClick={() => navigateToView('plans')}><span className="admin-overview-card__icon"><WalletRegular /></span><span>Products</span><strong>{overview.plans.toLocaleString()}</strong><small>{(overview.summary?.totalProductsSold ?? overview.productsSold ?? 0).toLocaleString()} purchased</small></button>
        <button type="button" className="admin-overview-card" onClick={() => navigateToView('deposits')}><span className="admin-overview-card__icon"><ArrowDownRegular /></span><span>Pending deposits</span><strong>{overview.pendingDeposits.count.toLocaleString()}</strong><small>{overview.pendingDeposits.amount.toLocaleString()} RWF awaiting review</small></button>
        <button type="button" className="admin-overview-card" onClick={() => navigateToView('withdrawals')}><span className="admin-overview-card__icon"><ArrowUpRegular /></span><span>Pending withdrawals</span><strong>{overview.pendingWithdrawals.count.toLocaleString()}</strong><small>{overview.pendingWithdrawals.amount.toLocaleString()} RWF awaiting review</small></button>
        <button type="button" className="admin-overview-card" onClick={() => navigateToView('promoters')}><span className="admin-overview-card__icon"><PeopleRegular /></span><span>Promoters / Referrals</span><strong>{(overview.summary?.totalReferrals ?? overview.referrals ?? 0).toLocaleString()}</strong><small>{(overview.summary?.totalReferralCommissions ?? 0).toLocaleString()} RWF commissions credited</small></button>
      </div>}
      <div className="admin-quick-links"><button onClick={() => navigateToView('deposits')}><ArrowDownRegular /> Review deposits</button><button onClick={() => navigateToView('withdrawals')}><ArrowUpRegular /> Review withdrawals</button><button onClick={() => navigateToView('settings')}><SettingsRegular /> Payment settings</button></div>
    </>;
    if (view === 'plans') return <section className="admin-console-section admin-console-section--plans"><div className="admin-console-heading"><div><Text className="home-kicker">CATALOG</Text><Title1>Plans</Title1></div><Button appearance="primary" onClick={() => setPlanDraft({ ...emptyPlan })}>Add product</Button></div>{planDraft && <Card className="admin-plan-editor"><Field label="Product name"><Input value={planDraft.name} disabled={plans.some((plan) => plan.name === planDraft.name)} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setPlanDraft({ ...planDraft, name: value.value })} /></Field><Field label="Description"><Textarea value={planDraft.description} onChange={(_: ChangeEvent<HTMLTextAreaElement>, value: { value: string }) => setPlanDraft({ ...planDraft, description: value.value })} /></Field><Field label="Product image"><input className="admin-product-image-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void readProductImage(file).then((imageData) => { setPlanDraft((current) => current ? { ...current, imageData } : current); setMessage(''); }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Could not read product image.')); }} />{planDraft.imageData && <img className="admin-product-image-preview" src={planDraft.imageData} alt="Product preview" />}</Field><Field label="Price (RWF)"><Input type="number" min="1" value={planDraft.price || ''} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setPlanDraft({ ...planDraft, price: Number(value.value) })} /></Field><Field label="Daily income (RWF)"><Input type="number" min="0" value={planDraft.dailyIncome || ''} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setPlanDraft({ ...planDraft, dailyIncome: Number(value.value) })} /></Field><Field label="Duration (days)"><Input type="number" min="1" value={planDraft.durationDays || ''} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setPlanDraft({ ...planDraft, durationDays: Number(value.value) })} /></Field><Field label="Purchase bonus (RWF)"><Input type="number" min="0" value={planDraft.purchaseBonus || ''} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setPlanDraft({ ...planDraft, purchaseBonus: Number(value.value) })} /></Field><Field label="Total slots"><Input type="number" min={planDraft.soldSlots || 1} value={planDraft.totalSlots || ''} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setPlanDraft({ ...planDraft, totalSlots: Number(value.value) })} /></Field><Field label="Status"><select value={planDraft.status} onChange={(event) => setPlanDraft({ ...planDraft, status: event.currentTarget.value as AdminPlan['status'] })}><option>Active</option><option>Ending soon</option></select></Field><div className="admin-plan-editor__actions"><Button appearance="primary" disabled={busy} onClick={() => void savePlan()}>Save product</Button><Button appearance="secondary" onClick={() => setPlanDraft(null)}>Cancel</Button></div></Card>}<div className="admin-data-list">{plans.length ? plans.map((plan) => <Card key={plan.name} className="admin-data-row"><div><strong>{plan.name}</strong><span>{plan.price.toLocaleString()} RWF · {plan.dailyIncome.toLocaleString()}/day · {plan.durationDays} days · {plan.soldSlots}/{plan.totalSlots} slots</span></div><Badge color={plan.soldOut ? 'danger' : plan.status === 'Active' ? 'success' : 'warning'}>{plan.soldOut ? 'SOLD OUT' : plan.status}</Badge><div className="admin-data-row__actions"><Button appearance="secondary" onClick={() => setPlanDraft(planDraftFrom(plan))}>Edit</Button><Button appearance="secondary" disabled={plan.soldSlots > 0} onClick={() => void deletePlan(plan)}>Delete</Button></div></Card>) : <Text className="muted">No products configured.</Text>}</div></section>;
    if (view === 'audit') return <section className="admin-console-section"><div className="admin-console-heading"><div><Text className="home-kicker">SECURITY</Text><Title1>Audit log</Title1></div><Button appearance="secondary" onClick={() => void refreshView(view)}>Refresh</Button></div><div className="admin-data-list">{auditEntries.length ? auditEntries.map((entry) => <Card key={entry.id} className="admin-data-row"><div><strong>{entry.action}</strong><span>{entry.targetUserId ?? 'All users'} · {new Date(entry.createdAt).toLocaleString()}</span></div><Text className="muted">{entry.metadata ?? [entry.previousValue, entry.newValue].filter(Boolean).join(' → ')}</Text></Card>) : <Text className="muted">No audit entries.</Text>}</div></section>;
    return null;
  };

  return <div className="admin-console"><header className="admin-console-header"><a href="/admin" className="admin-console-brand">Admin console</a><Text>{adminName}</Text><a href="/" className="admin-console-user-link">User app</a><Button appearance="subtle" icon={<SignOutRegular />} onClick={onLogout}>Log out</Button></header><nav className="admin-console-nav" aria-label="Admin sections">{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'is-active' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => navigateToView(id)}><Icon />{label}</button>)}</nav><main className="admin-console-main">{message && <MessageBar intent="error"><MessageBarBody>{message}</MessageBarBody></MessageBar>}{busy && view !== 'deposits' && view !== 'withdrawals' && <Text className="muted">Loading...</Text>}{renderView()}</main></div>;
}