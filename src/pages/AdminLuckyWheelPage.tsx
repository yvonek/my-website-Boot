import { Badge, Button, Card, Field, Input, MessageBar, MessageBarBody, Text, Textarea, Title1, Title2 } from '@fluentui/react-components';
import { AddRegular, DeleteRegular, EditRegular, GiftRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { LuckyWheelPrize, LuckyWheelSpin } from '../api/types';

type PrizeDraft = Omit<LuckyWheelPrize, 'id' | 'wins' | 'createdAt' | 'updatedAt'> & { id?: string };
interface AdminSpin extends LuckyWheelSpin { userName: string; }
const emptyPrize: PrizeDraft = { name: '', description: '', imageData: null, valueRwf: 0, weight: 1, enabled: true, position: 0 };

function readPrizeImage(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return Promise.reject(new Error('Choose a PNG, JPEG, or WebP image.'));
  if (file.size > 4 * 1024 * 1024) return Promise.reject(new Error('Prize images must be 4 MB or smaller.'));
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read the image.')); reader.onerror = () => reject(new Error('Could not read the image.')); reader.readAsDataURL(file); });
}

export function AdminLuckyWheelPage() {
  const [prizes, setPrizes] = useState<LuckyWheelPrize[]>([]);
  const [spins, setSpins] = useState<AdminSpin[]>([]);
  const [draft, setDraft] = useState<PrizeDraft | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const [prizeResponse, spinResponse] = await Promise.all([fetch('/api/admin/lucky-wheel/prizes'), fetch('/api/admin/lucky-wheel/spins')]);
      const [prizeBody, spinBody] = await Promise.all([prizeResponse.json(), spinResponse.json()]);
      if (!prizeResponse.ok) throw new Error(prizeBody.error ?? 'Prizes could not be loaded.');
      if (!spinResponse.ok) throw new Error(spinBody.error ?? 'Winner history could not be loaded.');
      setPrizes(prizeBody.prizes);
      setSpins(spinBody.spins);
      setMessage('');
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Lucky Wheel data could not be loaded.'); }
    finally { setBusy(false); }
  };

  useEffect(() => { void load(); }, []);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setMessage('');
    try {
      const editing = Boolean(draft.id);
      const response = await fetch(editing ? `/api/admin/lucky-wheel/prizes/${encodeURIComponent(draft.id!)}` : '/api/admin/lucky-wheel/prizes', {
        method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: draft.name, description: draft.description, imageData: draft.imageData, valueRwf: draft.valueRwf, weight: draft.weight, enabled: draft.enabled, position: draft.position }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Prize could not be saved.');
      setDraft(null);
      await load();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Prize could not be saved.'); }
    finally { setBusy(false); }
  };

  const remove = async (prize: LuckyWheelPrize) => {
    if (!window.confirm(`Delete ${prize.name}? Existing win history will be kept.`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/lucky-wheel/prizes/${encodeURIComponent(prize.id)}`, { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Prize could not be deleted.');
      await load();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Prize could not be deleted.'); }
    finally { setBusy(false); }
  };

  return <section className="admin-console-section admin-lucky-wheel-page">
    <div className="admin-console-heading"><div><Text className="home-kicker">REFERRAL REWARDS</Text><Title1>Lucky Wheel</Title1></div><Button appearance="secondary" onClick={() => void load()} disabled={busy}>Refresh</Button></div>
    {message && <MessageBar intent="error"><MessageBarBody>{message}</MessageBarBody></MessageBar>}
    <section className="admin-wheel-section"><div className="admin-console-heading"><div><Text className="home-kicker">WHEEL CONFIGURATION</Text><Title2>Prize list</Title2></div><Button appearance="primary" icon={<AddRegular />} onClick={() => setDraft({ ...emptyPrize, position: prizes.length })}>Add prize</Button></div>
      {draft && <Card className="admin-wheel-editor"><div className="admin-wheel-editor__fields">
        <Field label="Prize name"><Input value={draft.name} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setDraft({ ...draft, name: value.value })} /></Field>
        <Field label="Prize value (RWF)"><Input type="number" min="1" step="1" value={String(draft.valueRwf || '')} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setDraft({ ...draft, valueRwf: Number(value.value) })} /></Field>
        <Field label="Weight (relative chance)"><Input type="number" min="1" max="1000000" step="1" value={String(draft.weight || '')} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setDraft({ ...draft, weight: Number(value.value) })} /></Field>
        <Field label="Description"><Textarea value={draft.description} onChange={(_: ChangeEvent<HTMLTextAreaElement>, value: { value: string }) => setDraft({ ...draft, description: value.value })} /></Field>
        <Field label="Prize image"><input className="admin-wheel-image-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void readPrizeImage(file).then((imageData) => setDraft((current) => current ? { ...current, imageData } : current)).catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : 'Could not read the image.')); }} />{draft.imageData && <img className="admin-wheel-image-preview" src={draft.imageData} alt="Prize preview" />}</Field>
        <label className="admin-wheel-enabled"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.currentTarget.checked })} />Active on wheel</label>
      </div><div className="admin-wheel-editor__actions"><Button appearance="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving...' : draft.id ? 'Save prize' : 'Create prize'}</Button><Button appearance="secondary" onClick={() => setDraft(null)}>Cancel</Button></div></Card>}
      <div className="admin-wheel-prizes">{prizes.map((prize) => <Card className="admin-wheel-prize" key={prize.id}>{prize.imageData ? <img src={prize.imageData} alt={prize.name} /> : <span className="admin-wheel-prize__placeholder"><GiftRegular /></span>}<div className="admin-wheel-prize__info"><strong>{prize.name}</strong><span>{prize.description || 'No description'}</span><small>{Number(prize.valueRwf).toLocaleString()} RWF · weight {prize.weight} · {prize.wins ?? 0} wins</small></div><Badge color={prize.enabled ? 'success' : 'informative'}>{prize.enabled ? 'ACTIVE' : 'PAUSED'}</Badge><div className="admin-wheel-prize__actions"><Button appearance="subtle" icon={<EditRegular />} aria-label={`Edit ${prize.name}`} title={`Edit ${prize.name}`} onClick={() => setDraft({ ...prize })} /><Button appearance="subtle" icon={<DeleteRegular />} aria-label={`Delete ${prize.name}`} title={`Delete ${prize.name}`} onClick={() => void remove(prize)} /></div></Card>)}{!prizes.length && <Text className="muted">No wheel prizes have been added.</Text>}</div>
    </section>
    <section className="admin-wheel-section"><div className="admin-console-heading"><div><Text className="home-kicker">FULFILLMENT</Text><Title2>Winner history</Title2></div><Text className="admin-console-greeting">{spins.length} recorded wins</Text></div>
      <div className="admin-wheel-winners">{spins.map((spin) => <Card className="admin-wheel-winner" key={spin.id}><div><strong>{spin.userName}</strong><span>Referral: {spin.referralName}</span></div><div><strong>{spin.prizeName}</strong><span>{Number(spin.prizeValueRwf).toLocaleString()} RWF</span></div><time>{new Date(spin.createdAt).toLocaleString()}</time></Card>)}{!spins.length && <Text className="muted">There are no winners yet.</Text>}</div>
    </section>
  </section>;
}