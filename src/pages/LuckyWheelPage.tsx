import { Badge, Button, Card, MessageBar, MessageBarBody, Text, Title1 } from '@fluentui/react-components';
import { GiftRegular, PeopleTeamRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { LuckyWheelData, LuckyWheelSpin } from '../api/types';
import { formatCurrencyAmount } from '../api/money';

const wheelColors = ['#c5233a', '#178b73', '#e5ae32', '#2878b9', '#a74881', '#63a94c', '#d46b32', '#3265a8'];

function prizeWeight(weight: number | undefined) { return Math.max(1, Number(weight) || 1); }

function prizeCenterAngle(prizes: LuckyWheelData['prizes'], prizeIndex: number) {
  const totalWeight = prizes.reduce((total, prize) => total + prizeWeight(prize.weight), 0);
  const precedingWeight = prizes.slice(0, prizeIndex).reduce((total, prize) => total + prizeWeight(prize.weight), 0);
  return (precedingWeight + prizeWeight(prizes[prizeIndex]?.weight) / 2) / totalWeight * 360;
}

function wheelBackground(prizes: LuckyWheelData['prizes']) {
  if (!prizes.length) return 'conic-gradient(#25352f 0deg 360deg)';
  const totalWeight = prizes.reduce((total, prize) => total + prizeWeight(prize.weight), 0);
  let position = 0;
  const stops = prizes.map((prize, index) => {
    const start = position / totalWeight * 360;
    position += prizeWeight(prize.weight);
    const end = position / totalWeight * 360;
    return `${wheelColors[index % wheelColors.length]} ${start}deg ${end}deg`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

export function LuckyWheelPage() {
  const [wheel, setWheel] = useState<LuckyWheelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [latestWin, setLatestWin] = useState<LuckyWheelSpin | null>(null);
  const [error, setError] = useState('');

  const loadWheel = async () => {
    setError('');
    try { setWheel(await api.getLuckyWheel()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Lucky Wheel could not be loaded.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadWheel(); }, []);

  const spin = async () => {
    if (!wheel?.remainingSpins || !wheel.prizes.length || spinning) return;
    setSpinning(true);
    setError('');
    setLatestWin(null);
    try {
      const result = await api.spinLuckyWheel();
      const prizeIndex = wheel.prizes.findIndex((prize) => prize.id === result.spin.prizeId);
      const centerAngle = prizeCenterAngle(wheel.prizes, Math.max(0, prizeIndex));
      const alignment = (360 - centerAngle - rotation % 360 + 360) % 360;
      setRotation(rotation + 360 * 6 + alignment);
      setLatestWin(result.spin);
      setWheel((current) => current ? { ...current, remainingSpins: result.remainingSpins, spins: [result.spin, ...current.spins], referrals: current.referrals.map((referral) => referral.userId === result.spin.referralUserId ? { ...referral, spun: true } : referral) } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The wheel could not be spun.');
      setSpinning(false);
      void loadWheel();
    }
  };

  if (loading) return <Card className="state-panel"><Text>Loading Lucky Wheel...</Text></Card>;
  if (error && !wheel) return <MessageBar intent="error"><MessageBarBody>{error}<Button appearance="transparent" onClick={() => { setLoading(true); void loadWheel(); }}>Retry</Button></MessageBarBody></MessageBar>;
  if (!wheel) return null;
  const eligibleCount = wheel.referrals.filter((referral) => referral.completedProducts > 0 && !referral.spun).length;
  const prizeCount = wheel.prizes.length;

  return <div className="lucky-wheel-page">
    <header className="lucky-wheel-heading"><div><Text className="lucky-wheel-kicker">REFERRAL REWARDS</Text><Title1>Lucky Wheel</Title1><Text className="lucky-wheel-subtitle">Active direct referrals give you one chance each.</Text></div><div className="lucky-wheel-count"><PeopleTeamRegular /><span><strong>{eligibleCount}</strong><small>spins available</small></span></div></header>

    {error && <MessageBar intent="warning"><MessageBarBody>{error}</MessageBarBody></MessageBar>}

    <section className="lucky-wheel-stage" aria-label="Lucky Wheel game">
      <div className="lucky-wheel-wrap">
        <span className="lucky-wheel-pointer" aria-hidden="true" />
        <div className="lucky-wheel" style={{ background: wheelBackground(wheel.prizes), transform: `rotate(${rotation}deg)` }} onTransitionEnd={() => setSpinning(false)} aria-label={`${prizeCount} prizes on the wheel`}>
          {wheel.prizes.map((prize, index) => {
            const angle = prizeCenterAngle(wheel.prizes, index);
            return <div className="lucky-wheel-segment" key={prize.id} style={{ transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-34cqw) rotate(${-angle}deg)` }}>
              {prize.imageData && <img src={prize.imageData} alt="" />}
              <strong>{prize.name}</strong>
              <small>{formatCurrencyAmount(prize.valueRwf, 'RWF')}</small>
            </div>;
          })}
          <div className="lucky-wheel-hub"><GiftRegular /><span>LUCKY</span></div>
        </div>
      </div>
      <div className="lucky-wheel-action">
        <Button appearance="primary" size="large" disabled={spinning || wheel.remainingSpins === 0 || prizeCount === 0} onClick={() => void spin()}>{spinning ? 'Spinning...' : 'Spin the wheel'}</Button>
        {latestWin ? <div className="lucky-wheel-win" role="status"><Badge color="success">WINNER</Badge><strong>{latestWin.prizeName}</strong><span>{latestWin.prizeDescription || formatCurrencyAmount(latestWin.prizeValueRwf, 'RWF')}</span><small>Referral used: {latestWin.referralName}</small></div>
          : wheel.remainingSpins === 0 ? <Text className="lucky-wheel-hint">Invite someone and wait until they complete a product purchase to unlock a spin.</Text>
            : prizeCount === 0 ? <Text className="lucky-wheel-hint">There are no active prizes right now.</Text>
              : <Text className="lucky-wheel-hint">{wheel.remainingSpins} spin{wheel.remainingSpins === 1 ? '' : 's'} ready</Text>}
      </div>
    </section>

    <section className="lucky-wheel-section"><div className="lucky-wheel-section-heading"><div><Text className="lucky-wheel-kicker">PRIZE LIST</Text><h2>Available prizes</h2></div><Text>{prizeCount} active</Text></div>
      <div className="lucky-prize-grid">{wheel.prizes.map((prize) => <Card className="lucky-prize" key={prize.id}>{prize.imageData ? <img src={prize.imageData} alt={prize.name} /> : <span className="lucky-prize-placeholder"><GiftRegular /></span>}<div><strong>{prize.name}</strong><span>{prize.description}</span><b>{formatCurrencyAmount(prize.valueRwf, 'RWF')}</b></div></Card>)}{prizeCount === 0 && <Text className="lucky-wheel-hint">Prize details will appear here when available.</Text>}</div>
    </section>

    <section className="lucky-wheel-section"><div className="lucky-wheel-section-heading"><div><Text className="lucky-wheel-kicker">YOUR REFERRALS</Text><h2>Spin eligibility</h2></div><Text>{wheel.referrals.length} direct</Text></div>
      <div className="lucky-referral-list">{wheel.referrals.map((referral) => <div className="lucky-referral-row" key={referral.userId}><span><strong>{referral.fullName}</strong><small>Joined {new Date(referral.joinedAt).toLocaleDateString()} · {referral.completedProducts} completed product{referral.completedProducts === 1 ? '' : 's'}</small></span><Badge color={referral.spun ? 'informative' : referral.completedProducts ? 'success' : 'warning'}>{referral.spun ? 'SPIN USED' : referral.completedProducts ? 'READY' : 'NEEDS PURCHASE'}</Badge></div>)}{wheel.referrals.length === 0 && <Text className="lucky-wheel-hint">Your direct referrals will appear here.</Text>}</div>
    </section>

    {wheel.spins.length > 0 && <section className="lucky-wheel-section"><div className="lucky-wheel-section-heading"><div><Text className="lucky-wheel-kicker">WIN HISTORY</Text><h2>Past wins</h2></div><Text>{wheel.spins.length} total</Text></div><div className="lucky-win-list">{wheel.spins.map((win) => <div className="lucky-win-row" key={win.id}>{win.prizeImageData ? <img src={win.prizeImageData} alt="" /> : <span className="lucky-prize-placeholder"><GiftRegular /></span>}<span><strong>{win.prizeName}</strong><small>From {win.referralName ?? 'an active referral'} · {new Date(win.createdAt).toLocaleString()}</small></span><b>{formatCurrencyAmount(win.prizeValueRwf, 'RWF')}</b></div>)}</div></section>}
  </div>;
}