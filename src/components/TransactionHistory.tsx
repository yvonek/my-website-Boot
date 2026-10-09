import { Badge, Button, Card, MessageBar, MessageBarBody, Text, Title2 } from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatCurrencyAmount } from '../api/money';
import type { TransactionType, WalletTransaction } from '../api/types';

const allFilters = ['ALL', 'DEPOSIT', 'WITHDRAWAL', 'PENDING', 'APPROVED', 'AWAITING_PAYOUT', 'SUCCESS', 'REJECTED', 'FAILED'];
const statusFilters = ['PENDING', 'APPROVED', 'REJECTED', 'ALL'];

function statusColor(status: string) {
  if (status === 'APPROVED' || status === 'SUCCESS') return 'success';
  if (status === 'PENDING') return 'warning';
  if (status === 'AWAITING_PAYOUT' || status === 'PROCESSING') return 'informative';
  return 'danger';
}

export function TransactionHistory({ typeFilter, showHeading = false, showFilters = true, refreshKey = '' }: { typeFilter?: TransactionType; showHeading?: boolean; showFilters?: boolean; refreshKey?: string }) {
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [filter, setFilter] = useState('ALL');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.getTransactions()
      .then((result) => { if (active) setTransactions(result.transactions); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load transactions.'); });
    return () => { active = false; };
  }, [refreshKey]);

  const scopedTransactions = typeFilter ? transactions.filter((transaction) => transaction.type === typeFilter) : transactions;
  const filtered = scopedTransactions.filter((transaction) => {
    if (filter === 'ALL') return true;
    if (!typeFilter) return transaction.type === filter || transaction.status === filter;
    if (filter === 'APPROVED') return ['APPROVED', 'AWAITING_PAYOUT', 'PROCESSING', 'SUCCESS'].includes(transaction.status);
    if (filter === 'REJECTED') return ['REJECTED', 'FAILED', 'CANCELLED'].includes(transaction.status);
    return transaction.status === filter;
  });
  const filters = typeFilter ? statusFilters : allFilters;

  return <section className={`transaction-history${typeFilter ? ` transaction-history--${typeFilter.toLowerCase()}` : ''}`}>
    {showHeading && <div className="transaction-history__heading"><div><Text className="home-kicker">WALLET ACTIVITY</Text><Title2>{typeFilter === 'DEPOSIT' ? 'Deposit history' : 'Withdrawal history'}</Title2></div><Text className="muted">Requests and their current review status.</Text></div>}
    {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
    {showFilters && <div className="transaction-filters" role="group" aria-label={typeFilter ? `${typeFilter.toLowerCase()} status filter` : 'Filter transaction history'}>{filters.map((value) => <Button key={value} appearance={filter === value ? 'primary' : 'secondary'} aria-pressed={filter === value} onClick={() => setFilter(value)}>{typeFilter ? value.charAt(0) + value.slice(1).toLowerCase() : value === 'ALL' ? 'All' : value}</Button>)}</div>}
    <div className="transaction-list">{filtered.length ? filtered.map((transaction) => {
      const method = transaction.type === 'DEPOSIT' ? transaction.depositMethodName || transaction.paymentMethod : transaction.paymentMethod;
      const reference = transaction.internalReference;
      const detail = transaction.rejectionReason || transaction.failureReason;
      const currencyCode = transaction.currencyCode ?? 'RWF';
      return <Card className="transaction-row" key={transaction.id}>
        <div className="transaction-row__main"><div className="transaction-row__title"><strong>{transaction.type === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'}</strong><span>{method.replace(/_/g, ' ')}</span></div><div className="transaction-row__details"><span>{transaction.phoneNumber}</span><time dateTime={transaction.createdAt}>{new Date(transaction.createdAt).toLocaleString()}</time><span>Ref {reference}</span>{transaction.providerReference && transaction.providerReference !== reference && <span>Provider ref {transaction.providerReference}</span>}{transaction.type === 'DEPOSIT' && transaction.depositReceivingCountryCode && transaction.depositReceivingCountryCode !== transaction.countryCode && transaction.depositPaymentAmount != null && transaction.depositReceivingCurrencyCode && <span>Receiving payment: {formatCurrencyAmount(transaction.depositPaymentAmount, transaction.depositReceivingCurrencyCode)} · {transaction.depositReceivingCountryCode}</span>}{transaction.type === 'WITHDRAWAL' && transaction.withdrawalFee > 0 && <span>Fee {formatCurrencyAmount(transaction.displayFee ?? transaction.withdrawalFee, currencyCode)} · Receive {formatCurrencyAmount(transaction.displayAmountReceived ?? transaction.amountReceived, currencyCode)}</span>}{detail && <span className="transaction-row__note">{detail}</span>}</div></div>
        <div className="transaction-row__amount"><strong>{formatCurrencyAmount(transaction.displayAmount ?? transaction.amount, currencyCode)}</strong><Badge color={statusColor(transaction.status)}>{transaction.status}</Badge></div>
      </Card>;
    }) : <Card className="state-panel"><Text>{scopedTransactions.length ? 'No transactions match this filter.' : 'No transactions yet.'}</Text></Card>}</div>
  </section>;
}