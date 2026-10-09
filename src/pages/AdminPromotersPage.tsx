import { Badge, Button, Card, Input, MessageBar, MessageBarBody, Text, Title1, Title2 } from '@fluentui/react-components';
import { useEffect, useState } from 'react';

interface Promoter { userId: string; fullName: string; phoneNumber: string; totalReferred: number; activeMembers: number; }
interface PromotedUser { userId: string; fullName: string; phoneNumber: string; createdAt: string; level: number; productsPurchased: number; totalDeposit: number; totalWithdrawal: number; currentBalance: number; lastActive: string | null; currentPage: string | null; loginAt: string | null; activityStatus: 'ACTIVE' | 'INACTIVE'; }
interface PromoterCommission { id: string; referrerName: string; referredUserName: string; productId: string; purchaseAmount: number; commissionLevel: number; commissionPercentage: number; commissionAmount: number; status: string; date: string; reference: string; }
interface PromoterDetail { promoter: Promoter; totals: { totalReferred: number; activeMembers: number; inactiveMembers: number }; teamTotals: { totalDeposit: number; totalWithdrawal: number; totalProductsPurchased: number }; levels: { level: number; total: number; active: number }[]; members: PromotedUser[]; commissions: PromoterCommission[]; total: number; limit: number; offset: number; }

const pageSize = 25;
const money = (value: number) => `${Number(value ?? 0).toLocaleString()} RWF`;
const when = (value: string | null) => value ? new Date(value).toLocaleString() : 'Never';

export function AdminPromotersPage({ onOpenUser }: { onOpenUser: (userId: string) => void }) {
  const [promoters, setPromoters] = useState<Promoter[]>([]);
  const [promotersTotal, setPromotersTotal] = useState(0);
  const [promoterSearchInput, setPromoterSearchInput] = useState('');
  const [promoterSearch, setPromoterSearch] = useState('');
  const [promoterOffset, setPromoterOffset] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<PromoterDetail | null>(null);
  const [memberSearchInput, setMemberSearchInput] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [level, setLevel] = useState(1);
  const [memberOffset, setMemberOffset] = useState(0);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [referralSettings, setReferralSettings] = useState<{ level: number; percentage: string }[]>([]);
  const [savingLevel, setSavingLevel] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/admin/referral-settings').then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Referral settings could not be loaded.');
      setReferralSettings(body.settings.map((item: { level: number; percentage: number }) => ({ level: item.level, percentage: String(item.percentage) })));
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Referral settings could not be loaded.'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ search: promoterSearch, limit: String(pageSize), offset: String(promoterOffset) });
    fetch(`/api/admin/promoters?${params}`).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Promoters could not be loaded.');
      if (!cancelled) { setPromoters(body.promoters); setPromotersTotal(body.total); }
    }).catch((error: unknown) => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Promoters could not be loaded.'); });
    return () => { cancelled = true; };
  }, [promoterSearch, promoterOffset]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let cancelled = false;
    setBusy(true);
    const params = new URLSearchParams({ search: memberSearch, level: String(level), limit: String(pageSize), offset: String(memberOffset) });
    fetch(`/api/admin/promoters/${encodeURIComponent(selectedId)}?${params}`).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Promoter details could not be loaded.');
      if (!cancelled) { setDetail(body); setMessage(''); }
    }).catch((error: unknown) => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Promoter details could not be loaded.'); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [selectedId, memberSearch, level, memberOffset]);

  const changeLevel = (value: number) => { setLevel(value); setMemberOffset(0); };

  const saveReferralLevel = async (levelNumber: number) => {
    const item = referralSettings.find((setting) => setting.level === levelNumber);
    const percentage = Number(item?.percentage);
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) { setMessage('Commission percentage must be between 0 and 100.'); return; }
    setSavingLevel(levelNumber);
    try {
      const response = await fetch('/api/admin/referral-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: levelNumber, percentage }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Referral setting could not be saved.');
      setReferralSettings(body.settings.map((setting: { level: number; percentage: number }) => ({ level: setting.level, percentage: String(setting.percentage) })));
      setMessage(`Level ${levelNumber} commission saved.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Referral setting could not be saved.'); }
    finally { setSavingLevel(null); }
  };

  return <section className="admin-console-section admin-promoters-page">
    <div className="admin-console-heading"><div><Text className="home-kicker">REFERRAL NETWORK</Text><Title1>Promoters</Title1></div><Text className="admin-console-greeting">{promotersTotal.toLocaleString()} promoters</Text></div>
    {message && <MessageBar intent="error"><MessageBarBody>{message}</MessageBarBody></MessageBar>}
    <section className="admin-console-section admin-referral-settings"><div className="admin-console-heading"><div><Text className="home-kicker">COMMISSION RULES</Text><Title2>Referral commission levels</Title2></div></div><div className="admin-referral-settings__grid">{referralSettings.map((item) => <Card key={item.level} className="admin-referral-setting"><label htmlFor={`referral-level-${item.level}`}>Level {item.level} percentage</label><Input id={`referral-level-${item.level}`} aria-label={`Level ${item.level} percentage`} type="number" min="0" max="100" step="0.01" value={item.percentage} onChange={(_, value) => setReferralSettings((current) => current.map((setting) => setting.level === item.level ? { ...setting, percentage: value.value } : setting))} /><Button appearance="secondary" disabled={savingLevel !== null} onClick={() => void saveReferralLevel(item.level)}>{savingLevel === item.level ? 'Saving...' : `Save Level ${item.level}`}</Button></Card>)}</div></section>
    <div className="admin-promoters-layout">
      <section className="admin-promoter-list" aria-label="Promoters">
        <form className="admin-users-toolbar" onSubmit={(event) => { event.preventDefault(); setPromoterOffset(0); setPromoterSearch(promoterSearchInput.trim()); }}><Input aria-label="Search promoters" value={promoterSearchInput} onChange={(_, value) => setPromoterSearchInput(value.value)} placeholder="Search name or phone" /><Button appearance="secondary" type="submit">Search</Button></form>
        <div className="admin-data-list">{promoters.map((promoter) => <button key={promoter.userId} className={selectedId === promoter.userId ? 'admin-user-row is-selected' : 'admin-user-row'} onClick={() => { setSelectedId(promoter.userId); setMemberOffset(0); }}><span className="admin-user-row__identity"><strong>{promoter.fullName}</strong><small>{promoter.phoneNumber} · {promoter.activeMembers}/{promoter.totalReferred} active</small></span></button>)}{promoters.length === 0 && <Card className="admin-user-empty">No users have direct referrals yet.</Card>}</div>
        <div className="admin-pagination"><Button appearance="secondary" disabled={promoterOffset === 0} onClick={() => setPromoterOffset(Math.max(0, promoterOffset - pageSize))}>Previous</Button><span>{promotersTotal ? `${promoterOffset + 1}–${Math.min(promoterOffset + pageSize, promotersTotal)} of ${promotersTotal}` : '0 promoters'}</span><Button appearance="secondary" disabled={promoterOffset + pageSize >= promotersTotal} onClick={() => setPromoterOffset(promoterOffset + pageSize)}>Next</Button></div>
      </section>
      {detail ? <section className="admin-promoter-detail" aria-label={`${detail.promoter.fullName} referral details`}>
        <div className="admin-promoter-detail__heading"><div><Text className="home-kicker">PROMOTER</Text><Title2>{detail.promoter.fullName}</Title2><Text className="muted">{detail.promoter.phoneNumber}</Text></div></div>
        <div className="admin-promoter-stats"><Card><span>Total referred</span><strong>{detail.totals.totalReferred}</strong></Card><Card><span>Active members</span><strong>{detail.totals.activeMembers}</strong></Card><Card><span>Inactive members</span><strong>{detail.totals.inactiveMembers}</strong></Card><Card><span>Team deposits</span><strong>{money(detail.teamTotals.totalDeposit)}</strong></Card><Card><span>Team withdrawals</span><strong>{money(detail.teamTotals.totalWithdrawal)}</strong></Card><Card><span>Team products purchased</span><strong>{detail.teamTotals.totalProductsPurchased}</strong></Card></div>
        <div className="admin-promoter-levels">{detail.levels.map((item) => <Card key={item.level}><span>Level {item.level}</span><strong>{item.total} users</strong><small>{item.active} active</small></Card>)}</div>
        <section className="admin-commission-ledger"><div className="admin-console-heading"><div><Text className="home-kicker">CREDITED COMMISSIONS</Text><Title2>Referral commission ledger</Title2></div></div><div className="admin-promoter-table-wrap"><table className="admin-promoter-table"><thead><tr><th>Referrer</th><th>Referred user</th><th>Product</th><th>Purchase amount</th><th>Level</th><th>Percentage</th><th>Commission</th><th>Status</th><th>Date</th></tr></thead><tbody>{detail.commissions.map((commission) => <tr key={commission.id}><td>{commission.referrerName}</td><td>{commission.referredUserName}</td><td>{commission.productId}</td><td>{money(commission.purchaseAmount)}</td><td>Level {commission.commissionLevel}</td><td>{commission.commissionPercentage}%</td><td>{money(commission.commissionAmount)}</td><td>{commission.status}</td><td>{when(commission.date)}</td></tr>)}</tbody></table>{detail.commissions.length === 0 && <Text className="muted">No referral commissions have been credited.</Text>}</div></section>
        <div className="admin-console-heading admin-promoter-members-heading"><div><Text className="home-kicker">REFERRED USERS</Text><Title2>{level ? `Level ${level}` : 'All levels'}</Title2></div><div className="admin-promoter-filters"><Input aria-label="Search referred users" value={memberSearchInput} onChange={(_, value) => setMemberSearchInput(value.value)} placeholder="Search name or phone" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); setMemberOffset(0); setMemberSearch(memberSearchInput.trim()); } }} /><select aria-label="Filter referral level" value={level} onChange={(event) => changeLevel(Number(event.currentTarget.value))}><option value={0}>All levels</option><option value={1}>Level 1</option><option value={2}>Level 2</option><option value={3}>Level 3</option></select><Button appearance="secondary" onClick={() => { setMemberOffset(0); setMemberSearch(memberSearchInput.trim()); }}>Search</Button></div></div>
        <div className="admin-promoter-table-wrap"><table className="admin-promoter-table"><thead><tr><th>User</th><th>Registered</th><th>Status</th><th>Products</th><th>Deposit</th><th>Withdrawal</th><th>Balance</th><th>Last active</th><th>Current page</th><th>Actions</th></tr></thead><tbody>{detail.members.map((member) => <tr key={member.userId}><td><strong>{member.fullName}</strong><small>{member.phoneNumber} · L{member.level}</small></td><td>{new Date(member.createdAt).toLocaleDateString()}</td><td><Badge color={member.productsPurchased > 0 ? 'success' : 'warning'}>{member.productsPurchased > 0 ? 'ACTIVE' : 'INACTIVE'}</Badge></td><td>{member.productsPurchased}</td><td>{money(member.totalDeposit)}</td><td>{money(member.totalWithdrawal)}</td><td>{money(member.currentBalance)}</td><td>{when(member.lastActive)}</td><td>{member.currentPage ?? 'Offline'}</td><td><Button appearance="subtle" onClick={() => onOpenUser(member.userId)}>Open user</Button></td></tr>)}</tbody></table>{detail.members.length === 0 && <Text className="muted">No referred users match this filter.</Text>}</div>
        <div className="admin-pagination"><Button appearance="secondary" disabled={memberOffset === 0 || busy} onClick={() => setMemberOffset(Math.max(0, memberOffset - pageSize))}>Previous</Button><span>{detail.total ? `${memberOffset + 1}–${Math.min(memberOffset + pageSize, detail.total)} of ${detail.total}` : '0 users'}</span><Button appearance="secondary" disabled={memberOffset + pageSize >= detail.total || busy} onClick={() => setMemberOffset(memberOffset + pageSize)}>Next</Button></div>
      </section> : <Card className="admin-user-empty admin-promoter-placeholder">Select a promoter to view referral statistics and members.</Card>}
    </div>
  </section>;
}
