import { Badge, Button, Text } from '@fluentui/react-components';
import { MoneyRegular } from '@fluentui/react-icons';
import { useRef, useState } from 'react';
import { api } from '../api';
import { formatCurrencyAmount } from '../api/money';
import type { Plan } from '../api/types';

function newPurchaseIdempotencyKey() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === 'function') {
    return Array.from(cryptoApi.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `purchase-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function PlanCard({ plan, alreadyPurchased = false, onPurchased }: { plan: Plan; alreadyPurchased?: boolean; index?: number; onPurchased: (plan: Plan) => void }) {
  const [purchaseMessage, setPurchaseMessage] = useState('');
  const [purchasing, setPurchasing] = useState(false);
  const purchaseInFlight = useRef(false);
  const idempotencyKey = useRef('');
  const buy = async () => {
    if (purchaseInFlight.current) return;
    purchaseInFlight.current = true;
    setPurchasing(true);
    try { if (!idempotencyKey.current) idempotencyKey.current = newPurchaseIdempotencyKey(); const result = await api.createPurchase({ productId: plan.id ?? plan.name, idempotencyKey: idempotencyKey.current }); idempotencyKey.current = ''; onPurchased(result.product); setPurchaseMessage(`Purchase completed: ${formatCurrencyAmount(result.product.displayPrice ?? result.product.price, result.product.currencyCode ?? currencyCode)} · ${result.purchase.reference}`); }
    catch (error) { setPurchaseMessage(error instanceof Error ? error.message : 'Purchase request failed.'); }
    finally { purchaseInFlight.current = false; setPurchasing(false); }
  };

  const progress = Math.max(0, Math.min(100, plan.progressPercent));
  const currencyCode = plan.currencyCode ?? 'RWF';

  return (
    <article className="product-card">
      <div className="product-card__image-wrap">
        {plan.imageData && <img className="product-card__image" src={plan.imageData} alt={plan.name} />}
        <div className="product-card__image-overlay"><Text weight="semibold">{plan.name}</Text><Badge appearance="tint" color={plan.soldOut ? 'danger' : plan.status === 'Active' ? 'success' : 'warning'}>{plan.soldOut ? 'SOLD OUT' : plan.status}</Badge></div>
      </div>
      <div className="product-card__content">
        {plan.description && <Text className="product-card__description">{plan.description}</Text>}
        <div className="product-card__details">
          <div><span>Price:</span><strong>{formatCurrencyAmount(plan.displayPrice ?? plan.price, currencyCode)}</strong></div>
          <div><span>Term:</span><strong>{plan.durationDays} days</strong></div>
          <div><span>Daily income:</span><strong>{formatCurrencyAmount(plan.displayDailyIncome ?? plan.dailyIncome, currencyCode)}</strong></div>
          <div><span>Total income:</span><strong>{formatCurrencyAmount(plan.displayTotalIncome ?? plan.totalIncome, currencyCode)}</strong></div>
        </div>
        <div className="product-card__inventory"><div className="product-card__inventory-label"><strong>{plan.soldSlots.toLocaleString()} / {plan.totalSlots.toLocaleString()} slots sold</strong><span>{plan.remainingSlots.toLocaleString()} remaining</span></div><div className="product-card__progress" role="progressbar" aria-label={`${plan.name} slots sold`} aria-valuemin={0} aria-valuemax={plan.totalSlots} aria-valuenow={plan.soldSlots}><span style={{ width: `${progress}%` }} /></div><span className="product-card__progress-percent">{progress}% filled</span></div>
        <Button className="product-card__buy" appearance="primary" icon={<MoneyRegular />} disabled={plan.soldOut || plan.status !== 'Active' || purchasing || alreadyPurchased} onClick={() => void buy()}>{plan.soldOut ? 'SOLD OUT' : alreadyPurchased ? 'PURCHASED' : purchasing ? 'PURCHASING...' : 'BUY NOW'}</Button>
        {purchaseMessage && <span className="product-card__purchase-message">{purchaseMessage}</span>}
      </div>
    </article>
  );
}
