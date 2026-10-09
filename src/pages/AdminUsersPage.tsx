import { Badge, Button, Card, Field, Input, MessageBar, MessageBarBody, Text, Title1 } from '@fluentui/react-components';
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { AccountStatus, UserFeature } from '../api/types';
import { formatCurrencyAmount } from '../api/money';

interface ManagedUser {
  id: string;
  fullName: string;
  phoneNumber: string;
  referralCode: string;
  role: 'USER' | 'ADMIN';
  countryCode?: 'RW' | 'BI' | 'UG';
  currencyCode?: 'RWF' | 'BIF' | 'UGX';
  createdAt: string;
  lastActivity: string | null;
  currentPage?: string | null;
  isLive?: boolean;
  referredBy?: string | null;
  referralCommissionEarned?: number;
  availableBalance: number;
  displayAvailableBalance?: number;
  displayTotalDeposit?: number;
  displayTotalWithdrawal?: number;
  displayWelcomeBonusAmount?: number;
  displayReferralCommissionEarned?: number;
  totalDeposit: number;
  totalWithdrawal: number;
  productsPurchased: number;
  welcomeBonusAmount?: number;
  welcomeBonusAwardedAt?: string | null;
  welcomeBonusUnlockedAt?: string | null;
  accountStatus: AccountStatus;
  allowDeposits: boolean;
  allowWithdrawals: boolean;
  lastDepositStatus: string | null;
  lastWithdrawalStatus: string | null;
}
interface UserDetail extends ManagedUser {
  reservedBalance: number;
  permissions: Record<UserFeature, boolean>;
  transactions: { id: string; type: string; amount: number; displayAmount?: number; currencyCode?: 'RWF' | 'BIF' | 'UGX'; status: string; reference: string; createdAt: string }[];
  messages: { id: string; kind: string; title: string; body: string; createdAt: string; isRead: boolean }[];
  audit: { id: string; action: string; previousValue?: string | null; newValue?: string | null; metadata?: string | null; createdAt: string }[];
}
const features: { key: UserFeature; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' }, { key: 'products', label: 'Products' }, { key: 'wallet', label: 'Wallet' },
  { key: 'deposit', label: 'Deposit' }, { key: 'withdraw', label: 'Withdraw' }, { key: 'myTeam', label: 'My Team' },
  { key: 'support', label: 'Support' }, { key: 'telegram', label: 'Telegram' }, { key: 'messages', label: 'Messages' },
];
const statuses: AccountStatus[] = ['ACTIVE', 'FROZEN', 'RESTRICTED', 'SUSPENDED'];

export function AdminUsersPage({ activeOnly = false, initialSelectedUserId }: { activeOnly?: boolean; initialSelectedUserId?: string }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'USER' | 'ADMIN'>('ALL');
  const [activityFilter, setActivityFilter] = useState<'ALL' | 'LIVE' | 'RECENT' | 'OFFLINE'>('ALL');
  const [selected, setSelected] = useState<UserDetail | null>(null);
  const [currentAdminId, setCurrentAdminId] = useState('');
  const [editedName, setEditedName] = useState('');
  const [balanceAdjustment, setBalanceAdjustment] = useState('');
  const [balanceAdjustmentReason, setBalanceAdjustmentReason] = useState('');
  const [editingUserId, setEditingUserId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [privateTitle, setPrivateTitle] = useState('');
  const [privateBody, setPrivateBody] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [telegramUrl, setTelegramUrl] = useState('');
  const [deleteUserTarget, setDeleteUserTarget] = useState<ManagedUser | null>(null);
  const [deleteUserConfirmation, setDeleteUserConfirmation] = useState('');
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllConfirmation, setDeleteAllConfirmation] = useState('');
  const userDetailRef = useRef<HTMLDivElement>(null);
  const pageSize = 25;
  const visibleUsers = users.filter((item) => {
    if (roleFilter !== 'ALL' && item.role !== roleFilter) return false;
    if (activityFilter === 'LIVE' && !item.isLive) return false;
    if (activityFilter === 'OFFLINE' && item.isLive) return false;
    if (activityFilter === 'RECENT') {
      const activeAt = item.lastActivity ? new Date(item.lastActivity).getTime() : 0;
      if (!activeAt || Date.now() - activeAt > 5 * 60 * 1000) return false;
    }
    return true;
  });

  const loadUsers = async () => {
    setBusy(true);
    setMessage('');
    try {
      const params = new URLSearchParams({ search, status: statusFilter, limit: String(pageSize), offset: String(offset), ...(activeOnly ? { active: '1' } : {}) });
      const response = await fetch(`/api/admin/users?${params}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Users could not be loaded.');
      setUsers(body.users);
      setTotal(body.total);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Users could not be loaded.'); }
    finally { setBusy(false); }
  };

  const loadDetail = async (userId: string) => {
    setMessage('');
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'User details could not be loaded.');
      setSelected(body.user ? { ...body.user, transactions: body.transactions, messages: body.messages, audit: body.audit } : null);
      setEditedName(body.user?.fullName ?? '');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'User details could not be loaded.'); }
  };

  const openUserDetails = async (item: ManagedUser, edit = false) => {
    await loadDetail(item.id);
    setEditingUserId(edit ? item.id : '');
    setBalanceAdjustment('');
    setBalanceAdjustmentReason('');
    requestAnimationFrame(() => userDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const toggleUserStatus = (item: ManagedUser) => {
    const nextStatus = item.accountStatus === 'ACTIVE' ? 'FROZEN' : 'ACTIVE';
    void updateUser({ accountStatus: nextStatus }, nextStatus === 'FROZEN' ? `Suspend ${item.fullName}? Their data and financial history will be preserved.` : undefined, item.id);
  };

  useEffect(() => { void loadUsers(); }, [search, statusFilter, offset, activeOnly]);
  useEffect(() => { if (initialSelectedUserId) void loadDetail(initialSelectedUserId); }, [initialSelectedUserId]);
  useEffect(() => {
    fetch('/api/admin/support/settings').then((response) => response.ok ? response.json() : null).then((settings) => { if (settings?.telegramUrl) setTelegramUrl(settings.telegramUrl); }).catch(() => undefined);
    fetch('/api/auth/me').then((response) => response.ok ? response.json() : null).then((body) => { if (body?.user?.id) setCurrentAdminId(body.user.id); }).catch(() => undefined);
  }, []);
  const updateUser = async (changes: Record<string, unknown>, confirmText?: string, userId = selected?.id) => {
    if (!userId) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Account update failed.');
      if (selected?.id === userId) await loadDetail(userId);
      await loadUsers();
      setMessage('User access updated.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Account update failed.'); }
    finally { setBusy(false); }
  };

  const adjustBalance = async () => {
    if (!selected) return;
    const amount = Number(balanceAdjustment);
    if (!Number.isSafeInteger(amount) || amount === 0 || !balanceAdjustmentReason.trim()) {
      setMessage('Enter a non-zero whole RWF amount and a reason.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(selected.id)}/balance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount, reason: balanceAdjustmentReason.trim() }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Balance adjustment failed.');
      setBalanceAdjustment('');
      setBalanceAdjustmentReason('');
      await loadDetail(selected.id);
      await loadUsers();
      setMessage('Wallet balance adjusted and recorded.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Balance adjustment failed.'); }
    finally { setBusy(false); }
  };

  const toggleControl = (key: 'allowDeposits' | 'allowWithdrawals', label: string) => {
    if (!selected) return;
    const next = !selected[key];
    void updateUser({ [key]: next }, next ? undefined : `Disable ${label} for ${selected.fullName}? Existing history will remain unchanged.`);
  };

  const toggleFeature = (feature: UserFeature, enabled: boolean) => {
    if (!selected) return;
    const permissions = { ...selected.permissions, [feature]: enabled };
    void updateUser({ permissions }, enabled ? undefined : `Disable ${features.find((item) => item.key === feature)?.label} access for ${selected.fullName}?`);
  };

  const sendPrivateMessage = async () => {
    if (!selected || !privateBody.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/messages/private', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: selected.id, title: privateTitle, body: privateBody, notificationType: 'INFO' }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Message could not be sent.');
      setPrivateTitle('');
      setPrivateBody('');
      setMessage('Private message sent.');
      await loadDetail(selected.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Message could not be sent.'); }
    finally { setBusy(false); }
  };

  const resetUserPassword = async (target?: ManagedUser) => {
    const account = target ?? selected;
    if (!account || !window.confirm(`Reset the password for ${account.fullName}? Their active sessions will be ended.`)) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(account.id)}/reset-password`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Password reset failed.');
      setResetPassword(body.temporaryPassword);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Password reset failed.'); }
    finally { setBusy(false); }
  };

  const deactivateUser = async (target?: ManagedUser) => {
    const account = target ?? selected;
    if (!account || account.role === 'ADMIN') return;
    setDeleteUserConfirmation('');
    setDeleteUserTarget(account);
  };

  const confirmDeleteUser = async () => {
    const target = deleteUserTarget;
    if (!target || target.role === 'ADMIN' || deleteUserConfirmation !== 'DELETE USER') return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'User could not be deleted.');
      setDeleteUserTarget(null);
      setDeleteUserConfirmation('');
      if (selected?.id === target.id) setSelected(null);
      setMessage('User and their account history were permanently deleted.');
      await loadUsers();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'User could not be deleted.'); }
    finally { setBusy(false); }
  };

  const deleteAllUsers = async () => {
    if (deleteAllConfirmation !== 'DELETE ALL USERS') return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/users', { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Users could not be deleted.');
      setSelected(null);
      setDeleteAllOpen(false);
      setDeleteAllConfirmation('');
      setMessage(`${body.deleted} non-Admin accounts and their account data were permanently deleted.`);
      await loadUsers();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Users could not be deleted.'); }
    finally { setBusy(false); }
  };

  return <section className="admin-console-section admin-console-section--users">
    <div className="admin-console-heading"><div><Text className="home-kicker">{activeOnly ? 'COMPLETED PURCHASERS' : 'ACCOUNT ACCESS'}</Text><Title1>{activeOnly ? 'Active users' : 'Users'}</Title1></div><div className="admin-user-heading-actions"><Text className="admin-console-greeting">{total.toLocaleString()} accounts</Text>{!activeOnly && <Button appearance="secondary" disabled={busy || total === 0} onClick={() => { setDeleteAllConfirmation(''); setDeleteAllOpen(true); }}>Delete all users</Button>}</div></div>
    {selected && <div className="admin-user-wallet-tools">
      <div className="admin-user-role-control"><div><strong>Account role</strong><span>{selected.role === 'ADMIN' ? 'Administrator access' : 'Standard user access'}</span></div>{selected.role === 'USER' ? <Button appearance="secondary" disabled={busy} onClick={() => void updateUser({ role: 'ADMIN' }, `Make ${selected.fullName} an Admin? They will gain access to Admin tools.`)}>Make Admin</Button> : selected.id !== currentAdminId && <Button appearance="secondary" disabled={busy} onClick={() => void updateUser({ role: 'USER' }, `Dismiss Admin access for ${selected.fullName}? They will become a standard user.`)}>Dismiss Admin</Button>}</div>
      <div className="admin-user-role-control"><div><strong>Country and currency</strong><span>{selected.countryCode ?? 'RW'} · {selected.currencyCode ?? 'RWF'}</span><span>Available: {formatCurrencyAmount(selected.displayAvailableBalance ?? selected.availableBalance, selected.currencyCode ?? 'RWF')}</span><span>Deposited: {formatCurrencyAmount(selected.displayTotalDeposit ?? selected.totalDeposit, selected.currencyCode ?? 'RWF')}</span><span>Withdrawn: {formatCurrencyAmount(selected.displayTotalWithdrawal ?? selected.totalWithdrawal, selected.currencyCode ?? 'RWF')}</span>{(selected.welcomeBonusAmount ?? 0) > 0 && <span>Welcome bonus: {formatCurrencyAmount(selected.displayWelcomeBonusAmount ?? selected.welcomeBonusAmount ?? 0, selected.currencyCode ?? 'RWF')}</span>}</div></div>
      <div className="admin-wallet-adjustment"><div><strong>Adjust wallet balance</strong><span>Available now: {selected.availableBalance.toLocaleString()} RWF. Use a negative amount to deduct.</span></div><div className="admin-wallet-adjustment__fields"><Field label="Adjustment (RWF)"><Input aria-label="Adjustment amount in RWF" type="number" step="1" value={balanceAdjustment} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setBalanceAdjustment(value.value)} placeholder="e.g. 5000 or -5000" /></Field><Field label="Reason"><Input aria-label="Balance adjustment reason" value={balanceAdjustmentReason} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setBalanceAdjustmentReason(value.value)} placeholder="Required for audit" /></Field><Button appearance="primary" disabled={busy || !balanceAdjustment || !balanceAdjustmentReason.trim()} onClick={() => void adjustBalance()}>Apply adjustment</Button></div></div>
    </div>}
    {message && <MessageBar intent="info"><MessageBarBody>{message}</MessageBarBody></MessageBar>}
    {resetPassword && <Card className="admin-temp-password"><div><strong>Temporary password</strong><span>Share this once with the user. It is not stored in the audit log.</span></div><code>{resetPassword}</code><Button appearance="secondary" onClick={() => setResetPassword('')}>Dismiss</Button></Card>}
    <div className="admin-users-toolbar"><form onSubmit={(event) => { event.preventDefault(); setOffset(0); setSearch(searchInput.trim()); }}><Input aria-label="Search users" value={searchInput} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setSearchInput(value.value)} placeholder="Search name or phone" /><Button appearance="secondary" type="submit">Search</Button><Button appearance="subtle" type="button" disabled={!searchInput && !search} onClick={() => { setSearchInput(''); setSearch(''); setOffset(0); }}>Clear</Button></form><div className="admin-user-filters"><select aria-label="Filter account status" value={statusFilter} onChange={(event) => { setOffset(0); setStatusFilter(event.currentTarget.value); }}><option value="ALL">Status: All</option>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select><select aria-label="Filter user role" value={roleFilter} onChange={(event) => setRoleFilter(event.currentTarget.value as 'ALL' | 'USER' | 'ADMIN')}><option value="ALL">Role: All</option><option value="USER">User</option><option value="ADMIN">Admin</option></select><select aria-label="Filter user activity" value={activityFilter} onChange={(event) => setActivityFilter(event.currentTarget.value as 'ALL' | 'LIVE' | 'RECENT' | 'OFFLINE')}><option value="ALL">Activity: All</option><option value="LIVE">Live</option><option value="RECENT">Recently active</option><option value="OFFLINE">Offline</option></select></div></div>
    <div className="admin-users-layout"><div className="admin-user-table-panel">{busy && !selected && <Text className="muted">Loading users...</Text>}<div className="admin-user-table-wrap"><table className="admin-user-table"><thead><tr><th>User</th><th>Status</th><th>Balance</th><th>Deposit</th><th>Withdrawal</th><th>Products</th><th>Referral</th><th>Last active</th><th>Current page</th><th>Actions</th></tr></thead><tbody>{visibleUsers.map((item) => <tr className={selected?.id === item.id ? 'is-selected' : ''} key={item.id}><td data-label="User"><div className="admin-user-table-identity"><span className="admin-user-avatar">{item.fullName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span><button type="button" className="admin-user-select" onClick={() => void openUserDetails(item)}><strong>{item.fullName}</strong><small>{item.phoneNumber} · {item.role}</small></button></div></td><td data-label="Status"><div className="admin-user-table-status"><Badge color={item.accountStatus === 'ACTIVE' ? 'success' : item.accountStatus === 'FROZEN' ? 'warning' : 'danger'}>{item.accountStatus}</Badge>{item.isLive && <Badge color="success">LIVE</Badge>}</div></td><td data-label="Balance">{formatCurrencyAmount(item.displayAvailableBalance ?? item.availableBalance, item.currencyCode ?? 'RWF')}</td><td data-label="Deposit">{formatCurrencyAmount(item.displayTotalDeposit ?? item.totalDeposit, item.currencyCode ?? 'RWF')}</td><td data-label="Withdrawal">{formatCurrencyAmount(item.displayTotalWithdrawal ?? item.totalWithdrawal, item.currencyCode ?? 'RWF')}</td><td data-label="Products">{item.productsPurchased}</td><td data-label="Referral">{item.referredBy ?? 'Direct'}</td><td data-label="Last active">{item.lastActivity ? new Date(item.lastActivity).toLocaleString() : 'Never'}</td><td data-label="Current page">{item.isLive ? item.currentPage ?? 'Other' : 'Offline'}</td><td data-label="Actions"><div className="admin-user-row-actions"><Button size="small" appearance="subtle" onClick={() => void openUserDetails(item)}>View</Button><Button size="small" appearance="subtle" onClick={() => void openUserDetails(item, true)}>Edit</Button><Button size="small" appearance="subtle" onClick={() => void resetUserPassword(item)}>Reset password</Button><Button size="small" appearance="subtle" disabled={busy || item.role === 'ADMIN'} onClick={() => toggleUserStatus(item)}>{item.accountStatus === 'ACTIVE' ? 'Suspend' : 'Activate'}</Button><Button size="small" appearance="subtle" disabled={busy || item.role === 'ADMIN'} onClick={() => void deactivateUser(item)}>Delete</Button></div></td></tr>)}</tbody></table>{!busy && visibleUsers.length === 0 && <Card className="admin-user-empty">No users match these filters.</Card>}</div><div className="admin-pagination"><span>Showing {visibleUsers.length} on this page · {total} users total</span><Button appearance="secondary" disabled={offset === 0 || busy} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Previous</Button><Button appearance="secondary" disabled={offset + pageSize >= total || busy} onClick={() => setOffset(offset + pageSize)}>Next</Button></div></div>
      {selected ? <div className="admin-user-detail" ref={userDetailRef}>
        <div className="admin-user-detail__heading"><span className="admin-user-avatar admin-user-avatar--large">{selected.fullName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span><div><h2>{selected.fullName}</h2><span>{selected.phoneNumber} · {selected.role}</span><small>Joined {new Date(selected.createdAt).toLocaleDateString()} · {selected.lastActivity ? `Last active ${new Date(selected.lastActivity).toLocaleString()}` : 'No activity recorded'}</small><small>{selected.isLive ? `LIVE · ${selected.currentPage ?? 'Other'}` : 'OFFLINE'}</small></div></div>
        <div className="admin-user-edit-name"><Field label={editingUserId === selected.id ? 'Editing display name' : 'Display name'}><Input id="admin-user-edit-name" autoFocus={editingUserId === selected.id} value={editedName} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setEditedName(value.value)} /></Field><Button appearance="secondary" disabled={busy || editedName.trim() === selected.fullName} onClick={() => void updateUser({ fullName: editedName.trim() })}>Save name</Button></div>
        <dl className="admin-user-facts"><div><dt>Current balance</dt><dd>{formatCurrencyAmount(selected.displayAvailableBalance ?? selected.availableBalance, selected.currencyCode ?? 'RWF')}</dd></div><div><dt>Total deposit</dt><dd>{formatCurrencyAmount(selected.displayTotalDeposit ?? selected.totalDeposit, selected.currencyCode ?? 'RWF')}</dd></div><div><dt>Total withdrawal</dt><dd>{formatCurrencyAmount(selected.displayTotalWithdrawal ?? selected.totalWithdrawal, selected.currencyCode ?? 'RWF')}</dd></div><div><dt>Products purchased</dt><dd>{selected.productsPurchased}</dd></div><div><dt>Direct referrer</dt><dd>{selected.referredBy ?? 'None'}</dd></div><div><dt>Referral status</dt><dd>{selected.referredBy ? selected.productsPurchased > 0 ? 'ACTIVE' : 'REGISTERED' : 'Not referred'}</dd></div><div><dt>Referral commission earned</dt><dd>{formatCurrencyAmount(selected.displayReferralCommissionEarned ?? selected.referralCommissionEarned ?? 0, selected.currencyCode ?? 'RWF')}</dd></div><div><dt>Welcome bonus</dt><dd>{selected.welcomeBonusAmount ? `${formatCurrencyAmount(selected.displayWelcomeBonusAmount ?? selected.welcomeBonusAmount, selected.currencyCode ?? 'RWF')} · ${selected.welcomeBonusUnlockedAt ? 'UNLOCKED' : 'LOCKED'}` : 'None'}</dd></div><div><dt>Deposit status</dt><dd>{selected.lastDepositStatus ?? 'No deposits'}</dd></div><div><dt>Withdrawal status</dt><dd>{selected.lastWithdrawalStatus ?? 'No withdrawals'}</dd></div></dl>
        <div className="admin-user-controls"><h3>Account controls</h3><label>Account status<select value={selected.accountStatus} onChange={(event) => void updateUser({ accountStatus: event.currentTarget.value }, event.currentTarget.value === 'FROZEN' || event.currentTarget.value === 'SUSPENDED' ? `Set ${selected.fullName} to ${event.currentTarget.value}?` : undefined)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label><label className="admin-toggle"><input type="checkbox" checked={selected.allowDeposits} onChange={() => toggleControl('allowDeposits', 'deposits')} /><span>Allow deposits</span></label><label className="admin-toggle"><input type="checkbox" checked={selected.allowWithdrawals} onChange={() => toggleControl('allowWithdrawals', 'withdrawals')} /><span>Allow withdrawals</span></label><h3>Feature access</h3><div className="admin-permission-grid">{features.map((feature) => <label className="admin-toggle" key={feature.key}><input type="checkbox" checked={selected.permissions[feature.key]} onChange={(event) => toggleFeature(feature.key, event.currentTarget.checked)} /><span>{feature.label}</span></label>)}</div><details className="admin-user-action-menu"><summary>Actions</summary><div className="admin-user-actions"><Button appearance="secondary" disabled={busy} onClick={() => void resetUserPassword()}>Reset password</Button><Button appearance="secondary" disabled={busy || selected.role === 'ADMIN'} onClick={() => void deactivateUser()}>Delete user</Button>{telegramUrl && selected.permissions.telegram && <a href={telegramUrl} target="_blank" rel="noreferrer">Telegram support</a>}</div></details></div>
        <div className="admin-user-message-form"><h3>Send private message</h3><Input aria-label="Message subject" value={privateTitle} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setPrivateTitle(value.value)} placeholder="Subject (optional)" /><Input aria-label="Private message" value={privateBody} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setPrivateBody(value.value)} placeholder="Write a message" /><Button appearance="primary" disabled={busy || !privateBody.trim()} onClick={() => void sendPrivateMessage()}>Send message</Button></div>
        <div className="admin-user-history"><h3>Recent activity</h3>{selected.transactions.length ? selected.transactions.slice(0, 8).map((item) => <div key={item.id}><span>{item.type} · {item.reference}</span><strong>{formatCurrencyAmount(item.displayAmount ?? item.amount, item.currencyCode ?? selected.currencyCode ?? 'RWF')} · {item.status}</strong></div>) : <span>No financial activity.</span>}<h3>Messages</h3>{selected.messages.length ? selected.messages.slice(0, 8).map((item) => <div key={item.id}><span>{item.kind === 'BROADCAST' ? 'Announcement' : item.title || 'Private message'} · {item.body}</span><strong>{item.isRead ? 'Read' : 'Unread'}</strong></div>) : <span>No messages sent.</span>}<h3>Admin history</h3>{selected.audit.length ? selected.audit.slice(0, 8).map((item, index) => <div key={`${item.id ?? item.action}-${item.createdAt}-${index}`}><span>{item.action}</span><strong>{new Date(item.createdAt).toLocaleString()}</strong></div>) : <span>No Admin actions recorded.</span>}</div>
      </div> : <Card className="admin-user-empty admin-user-detail-placeholder">Select a user to inspect access, messages, transactions and account history.</Card>}
    </div>
    {deleteUserTarget && <div className="withdrawal-modal__backdrop"><section className="withdrawal-modal admin-delete-all-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-user-title"><h2 id="delete-user-title">Delete this user permanently?</h2><p>The account, wallet and transactions, purchases, messages, referrals, and account activity will be permanently removed. This cannot be undone.</p><Field label="Type DELETE USER to confirm"><Input autoComplete="off" value={deleteUserConfirmation} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setDeleteUserConfirmation(value.value)} /></Field><div className="withdrawal-modal__actions"><Button appearance="secondary" disabled={busy} onClick={() => { setDeleteUserTarget(null); setDeleteUserConfirmation(''); }}>Cancel</Button><Button appearance="primary" disabled={busy || deleteUserConfirmation !== 'DELETE USER'} onClick={() => void confirmDeleteUser()}>{busy ? 'Deleting...' : 'Delete User'}</Button></div></section></div>}
    {deleteAllOpen && <div className="withdrawal-modal__backdrop"><section className="withdrawal-modal admin-delete-all-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-all-users-title"><h2 id="delete-all-users-title">Delete all users?</h2><p>This permanently removes all non-Admin accounts and their account data, transactions, messages, purchases, and activity. Admin accounts remain. This cannot be undone.</p><Field label="Type DELETE ALL USERS to confirm"><Input autoComplete="off" value={deleteAllConfirmation} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setDeleteAllConfirmation(value.value)} /></Field><div className="withdrawal-modal__actions"><Button appearance="secondary" disabled={busy} onClick={() => { setDeleteAllOpen(false); setDeleteAllConfirmation(''); }}>Cancel</Button><Button appearance="primary" disabled={busy || deleteAllConfirmation !== 'DELETE ALL USERS'} onClick={() => void deleteAllUsers()}>{busy ? 'Deleting...' : 'Delete all users'}</Button></div></section></div>}
  </section>;
}
