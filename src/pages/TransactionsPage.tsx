import { Text, Title1 } from '@fluentui/react-components';
import { TransactionHistory } from '../components/TransactionHistory';
export function TransactionsPage() {
  return <div className="page-stack transactions-page"><div className="page-intro"><Text className="hero-eyebrow">Wallet activity</Text><Title1>Transaction history</Title1><Text className="muted">Every request is recorded with a backend reference.</Text></div><TransactionHistory /></div>;
}
