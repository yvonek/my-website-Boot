import { Button, Card, MessageBar, MessageBarBody, Text, Title1, Title2 } from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { AddRegular } from '@fluentui/react-icons';
import { api } from '../api';
import type { DashboardData, Plan } from '../api/types';
import { PlanCard } from '../components/PlanCard';

export function PlansPage({ data, state, onRetry, onPurchased }: { data: DashboardData | null; state: string; onRetry: () => void; onPurchased: (plan: Plan) => void }) {
  const [purchasedProductNames, setPurchasedProductNames] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    api.getWalletProducts().then(({ products }) => { if (active) setPurchasedProductNames(products.map((product) => product.name)); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  if (state === 'loading') return <div className="page-stack plans-page"><Card className="state-panel"><Text>Loading active plans...</Text></Card></div>;
  if (state === 'error') return <div className="page-stack plans-page"><MessageBar intent="error"><MessageBarBody>Plans could not be loaded. <Button appearance="transparent" onClick={onRetry}>Retry loading plans</Button></MessageBarBody></MessageBar></div>;
  if (!data || data.plans.length === 0) return <div className="page-stack plans-page"><Card className="state-panel"><Text className="state-icon">◌</Text><Title2>No products available</Title2><Text className="muted">Products published by the administrator will appear here.</Text></Card></div>;
  const handlePurchased = (updatedPlan: Plan) => {
    setPurchasedProductNames((current) => current.includes(updatedPlan.name) ? current : [...current, updatedPlan.name]);
    onPurchased(updatedPlan);
  };
  return <div className="page-stack plans-page"><div className="page-intro"><Text className="hero-eyebrow">Investment products</Text><Title1>Choose a product.</Title1><Text className="muted">Review product terms and available slots before purchasing.</Text></div><div className="plan-grid plan-grid--wide">{data.plans.map((plan) => <PlanCard key={plan.id ?? plan.name} plan={plan} alreadyPurchased={purchasedProductNames.includes(plan.name)} onPurchased={handlePurchased} />)}</div></div>;
}
