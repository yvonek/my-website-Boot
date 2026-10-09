import { Badge, Button, Card, MessageBar, MessageBarBody, Text } from '@fluentui/react-components';
import { ArrowRightRegular, CheckmarkRegular, ClipboardRegular, PeopleTeamRegular, ShareRegular, WalletRegular } from '@fluentui/react-icons';
import { useEffect, useMemo, useState } from 'react';
import type { DashboardData } from '../api/types';
import { formatCurrencyAmount } from '../api/money';

interface TeamMember { userId: string; sponsorUserId: string; joinedAt: string; level: number; displayName: string; qualifyingProducts?: number; activeReferral?: boolean; commissionEarned?: number; }
interface Commission { id: string; sourceUserId: string; productId: string; purchaseId: string; referralLevel: number; percentage: number; qualifyingAmount: number; displayQualifyingAmount?: number; commissionAmount: number; displayCommissionAmount?: number; currencyCode?: 'RWF' | 'BIF' | 'UGX'; status: string; createdAt: string; approvedAt: string | null; reference: string; }
interface TeamData { referralCode: string; referralLink: string; levels: TeamMember[]; settings: { level: number; percentage: number }[]; commissions: Commission[]; activeReferrals: number; pendingCommission: number; displayPendingCommission?: number; availableCommission: number; displayAvailableCommission?: number; withdrawnCommission: number; displayWithdrawnCommission?: number; earnings: number; displayEarnings?: number; currencyCode?: 'RWF' | 'BIF' | 'UGX'; }

function maskUser(value: string) { return value.length > 10 ? `${value.slice(0, 5)}...${value.slice(-3)}` : value; }
function shareText(link: string) { return `Join me on our platform using my referral link: ${link}`; }

export function TeamPage({ data, state, onRetry }: { data: DashboardData | null; state: string; onRetry: () => void }) {
  const [team, setTeam] = useState<TeamData | null>(null);
  const [selectedLevel, setSelectedLevel] = useState(1);
  const [copied, setCopied] = useState('');
  const [selectedCommission, setSelectedCommission] = useState<Commission | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { fetch('/api/team').then(async (response) => { if (!response.ok) throw new Error('Team data could not be loaded.'); return response.json(); }).then((result) => setTeam({ referralCode: result.referralCode ?? '', referralLink: result.referralLink ?? '', levels: result.levels ?? [], settings: result.settings ?? [], commissions: result.commissions ?? [], activeReferrals: result.activeReferrals ?? result.levels?.filter((member: TeamMember) => member.activeReferral).length ?? 0, pendingCommission: result.pendingCommission ?? 0, displayPendingCommission: result.displayPendingCommission, availableCommission: result.availableCommission ?? result.earnings ?? 0, displayAvailableCommission: result.displayAvailableCommission, withdrawnCommission: result.withdrawnCommission ?? 0, displayWithdrawnCommission: result.displayWithdrawnCommission, earnings: result.earnings ?? 0, displayEarnings: result.displayEarnings, currencyCode: result.currencyCode ?? 'RWF' })).catch((reason) => setError(reason instanceof Error ? reason.message : 'Team data could not be loaded.')); }, []);

  const link = team?.referralLink ?? '';
  const copy = async (value: string, label: string) => { if (!value) return; await navigator.clipboard?.writeText(value); setCopied(label); window.setTimeout(() => setCopied(''), 1800); };
  const whatsapp = () => { if (link) window.open(`https://wa.me/?text=${encodeURIComponent(shareText(link))}`, '_blank', 'noopener,noreferrer'); };
  const telegram = () => { if (link) window.open(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Join me on our platform')}`, '_blank', 'noopener,noreferrer'); };
  const levelMembers = useMemo(() => team?.levels.filter((member) => member.level === selectedLevel) ?? [], [team, selectedLevel]);
  const levelPercentage = team?.settings.find((setting) => setting.level === selectedLevel)?.percentage ?? 0;

  if (state === 'loading' || !team && !error) return <Card className="state-panel"><Text>Loading your team...</Text></Card>;
  if (state === 'error' || error) return <MessageBar intent="error"><MessageBarBody>{error || 'Team data could not be loaded.'}<Button appearance="transparent" onClick={onRetry}>Retry</Button></MessageBarBody></MessageBar>;
  if (!team) return null;
  const totalMembers = team.levels.length;
  const commissionTotal = team.earnings;
  const currencyCode = team.currencyCode ?? 'RWF';

  return <div className="team-page-premium">
    <header className="team-hero"><span className="team-hero__icon"><PeopleTeamRegular /></span></header>

    <section className="team-earnings-card"><div className="team-earnings-card__top"><span>My referral earnings</span><WalletRegular /></div><strong>{formatCurrencyAmount(team.displayEarnings ?? commissionTotal, currencyCode)}</strong><div className="team-code-row"><div><small>Your referral code</small><b>{team.referralCode}</b></div><Button icon={copied === 'code' ? <CheckmarkRegular /> : <ClipboardRegular />} onClick={() => copy(team.referralCode, 'code')}>{copied === 'code' ? 'Copied' : 'Copy'}</Button></div></section>

    <section className="team-share-card"><div className="team-link-row"><span>{link}</span><Button icon={copied === 'link' ? <CheckmarkRegular /> : <ClipboardRegular />} onClick={() => copy(link, 'link')}>{copied === 'link' ? 'Copied' : 'Copy link'}</Button></div><div className="team-share-actions"><Button className="team-share-button team-share-button--whatsapp" icon={<ShareRegular />} onClick={whatsapp}>WhatsApp</Button><Button className="team-share-button team-share-button--telegram" icon={<ShareRegular />} onClick={telegram}>Telegram</Button></div></section>

    <section className="team-section"><div className="team-level-cards">{[1, 2, 3].map((level) => <button className={selectedLevel === level ? 'team-level-card is-active' : 'team-level-card'} key={level} onClick={() => setSelectedLevel(level)}><span>Level {level}</span><strong>{team.settings.find((setting) => setting.level === level)?.percentage ?? 0}%</strong></button>)}</div><p className="team-rule-note">Referral commissions are generated when a referred user completes a qualifying product purchase according to the platform's commission rules.</p></section>

    <section className="team-section"><div className="team-summary-premium"><div><span>My referrals</span><strong>{totalMembers}</strong></div><div><span>Active referrals</span><strong>{team.activeReferrals}</strong></div><div><span>Level 1</span><strong>{team.levels.filter((member) => member.level === 1).length}</strong></div><div><span>Level 2</span><strong>{team.levels.filter((member) => member.level === 2).length}</strong></div><div><span>Level 3</span><strong>{team.levels.filter((member) => member.level === 3).length}</strong></div><div><span>Pending commission</span><strong>{formatCurrencyAmount(team.displayPendingCommission ?? team.pendingCommission, currencyCode)}</strong></div><div><span>Available commission</span><strong>{formatCurrencyAmount(team.displayAvailableCommission ?? team.availableCommission, currencyCode)}</strong></div><div><span>Withdrawn commission</span><strong>{formatCurrencyAmount(team.displayWithdrawnCommission ?? team.withdrawnCommission, currencyCode)}</strong></div><div><span>Total commission</span><strong>{formatCurrencyAmount(team.displayEarnings ?? commissionTotal, currencyCode)}</strong></div></div></section>

    {levelMembers.length > 0 && <section className="team-section"><div className="team-section-heading"><Text className="muted">Level {selectedLevel} · {levelPercentage}% commission</Text></div><div className="team-members-premium">{levelMembers.map((member) => <div className="team-member-premium" key={member.userId}><span className="team-member-premium__avatar">{member.userId.slice(0, 2).toUpperCase()}</span><div><strong>{maskUser(member.displayName)}</strong><small>Joined {new Date(member.joinedAt).toLocaleDateString()}</small></div><Badge color={member.activeReferral ? 'success' : 'warning'}>{member.activeReferral ? 'ACTIVE REFERRAL' : 'REGISTERED'}</Badge></div>)}</div></section>}

    {team.commissions.length > 0 && <section className="team-section"><div className="commission-history">{team.commissions.map((commission) => <button className="commission-row" key={commission.id} onClick={() => setSelectedCommission(commission)}><span className="commission-row__icon"><ArrowRightRegular /></span><span><strong>Product purchase</strong><small>{maskUser(commission.sourceUserId)} · Level {commission.referralLevel} · {commission.percentage}%</small></span><span><b>+ {formatCurrencyAmount(commission.displayCommissionAmount ?? commission.commissionAmount, commission.currencyCode ?? currencyCode)}</b><small>{commission.status}</small></span></button>)}</div></section>}

    {selectedCommission && <div className="team-modal-backdrop"><section className="team-modal" role="dialog" aria-modal="true" aria-labelledby="commission-detail-title"><button className="team-modal__close" onClick={() => setSelectedCommission(null)} aria-label="Close">×</button><Text className="team-kicker">Commission detail</Text><h2 id="commission-detail-title">Purchase commission</h2><div className="team-detail-list"><div><span>Referral user</span><strong>{maskUser(selectedCommission.sourceUserId)}</strong></div><div><span>Product</span><strong>{selectedCommission.productId}</strong></div><div><span>Purchase amount</span><strong>{formatCurrencyAmount(selectedCommission.displayQualifyingAmount ?? selectedCommission.qualifyingAmount, selectedCommission.currencyCode ?? currencyCode)}</strong></div><div><span>Referral level</span><strong>Level {selectedCommission.referralLevel}</strong></div><div><span>Commission</span><strong>{selectedCommission.percentage}% · {formatCurrencyAmount(selectedCommission.displayCommissionAmount ?? selectedCommission.commissionAmount, selectedCommission.currencyCode ?? currencyCode)}</strong></div><div><span>Status</span><strong>{selectedCommission.status}</strong></div><div><span>Reference</span><strong>{selectedCommission.reference}</strong></div><div><span>Date</span><strong>{new Date(selectedCommission.createdAt).toLocaleString()}</strong></div></div></section></div>}
  </div>;
}
