import { Badge, Button, Card, Input, MessageBar, MessageBarBody, Text, Title1 } from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { formatCurrencyAmount } from '../api/money';

interface LiveUser { sessionId: string; userId: string; fullName: string; phoneNumber: string; countryCode: 'RW' | 'BI' | 'UG'; currencyCode: 'RWF' | 'BIF' | 'UGX'; currentPage: string; lastSeenAt: string; loginAt: string; currentBalance: number; displayCurrentBalance?: number; totalDeposit: number; displayTotalDeposit?: number; totalWithdrawal: number; displayTotalWithdrawal?: number; productsPurchased: number; promoterName: string | null; }
const pageSize = 25;
const pageOptions = ['ALL', 'Home', 'Products', 'My Wallet', 'Deposit', 'Withdraw', 'My Team', 'Promotion', 'Support', 'Messages', 'Profile', 'Settings', 'Other'];
const ago = (value: string) => { const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000)); return seconds < 10 ? 'Now' : `${seconds} sec ago`; };

export function AdminLiveUsersPage({ onOpenUser }: { onOpenUser: (userId: string) => void }) {
  const [users, setUsers] = useState<LiveUser[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<LiveUser | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState('ALL');
  const [offset, setOffset] = useState(0);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      const params = new URLSearchParams({ search, page: page === 'ALL' ? '' : page, limit: String(pageSize), offset: String(offset) });
      fetch(`/api/admin/live-users?${params}`).then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Live users could not be loaded.');
        if (!cancelled) { setUsers(body.users); setTotal(body.total); setSelected((current) => current ? body.users.find((user: LiveUser) => user.userId === current.userId) ?? null : null); setMessage(''); }
      }).catch((error: unknown) => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Live users could not be loaded.'); });
    };
    refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [search, page, offset]);

  return <section className="admin-console-section admin-live-users-page">
    <div className="admin-console-heading"><div><Text className="home-kicker">SESSION PRESENCE · 60 SECOND WINDOW</Text><Title1>Live users</Title1></div><Text className="admin-console-greeting">{total.toLocaleString()} online</Text></div>
    {message && <MessageBar intent="error"><MessageBarBody>{message}</MessageBarBody></MessageBar>}
    <div className="admin-live-toolbar"><form onSubmit={(event) => { event.preventDefault(); setOffset(0); setSearch(searchInput.trim()); }}><Input aria-label="Search live users" value={searchInput} onChange={(_, value) => setSearchInput(value.value)} placeholder="Search name or phone" /><Button appearance="secondary" type="submit">Search</Button></form><select aria-label="Filter live users by page" value={page} onChange={(event) => { setOffset(0); setPage(event.currentTarget.value); }}><option value="ALL">All live users</option>{pageOptions.slice(1).map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
    <div className="admin-live-layout"><div className="admin-live-table-wrap"><table className="admin-promoter-table"><thead><tr><th>User</th><th>Status</th><th>Current page</th><th>Last active</th><th>Actions</th></tr></thead><tbody>{users.map((user) => <tr key={user.sessionId} className={selected?.sessionId === user.sessionId ? 'is-selected' : ''} onClick={() => setSelected(user)}><td><strong>{user.fullName}</strong><small>{user.phoneNumber}</small></td><td><Badge color="success">ONLINE</Badge></td><td>{user.currentPage}</td><td>{ago(user.lastSeenAt)}</td><td><Button appearance="subtle" onClick={(event) => { event.stopPropagation(); onOpenUser(user.userId); }}>Open user</Button></td></tr>)}</tbody></table>{users.length === 0 && <Card className="admin-user-empty">No authenticated activity in the last minute.</Card>}<div className="admin-pagination"><Button appearance="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Previous</Button><span>{total ? `${offset + 1}–${Math.min(offset + pageSize, total)} of ${total}` : '0 users'}</span><Button appearance="secondary" disabled={offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>Next</Button></div></div>
      {selected && <Card className="admin-live-detail"><Text className="home-kicker">USER DETAILS · {selected.countryCode} · {selected.currencyCode}</Text><h2>{selected.fullName}</h2><span>{selected.phoneNumber}</span><dl><div><dt>Status</dt><dd>Online</dd></div><div><dt>Current page</dt><dd>{selected.currentPage}</dd></div><div><dt>Last active</dt><dd>{ago(selected.lastSeenAt)}</dd></div><div><dt>Login time</dt><dd>{new Date(selected.loginAt).toLocaleString()}</dd></div><div><dt>Total deposit</dt><dd>{formatCurrencyAmount(selected.displayTotalDeposit ?? selected.totalDeposit, selected.currencyCode)}</dd></div><div><dt>Total withdrawal</dt><dd>{formatCurrencyAmount(selected.displayTotalWithdrawal ?? selected.totalWithdrawal, selected.currencyCode)}</dd></div><div><dt>Current balance</dt><dd>{formatCurrencyAmount(selected.displayCurrentBalance ?? selected.currentBalance, selected.currencyCode)}</dd></div><div><dt>Products purchased</dt><dd>{selected.productsPurchased}</dd></div><div><dt>Purchase status</dt><dd>{selected.productsPurchased > 0 ? 'ACTIVE' : 'INACTIVE'}</dd></div><div><dt>Promoter</dt><dd>{selected.promoterName ?? 'Direct / unknown'}</dd></div></dl><Button appearance="secondary" onClick={() => onOpenUser(selected.userId)}>Open user account</Button></Card>}
    </div>
  </section>;
}
