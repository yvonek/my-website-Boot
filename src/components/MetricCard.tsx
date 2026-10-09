import { Card, Text } from '@fluentui/react-components';
import { ArrowUpRegular, GiftRegular, MoneyRegular, SparkleRegular } from '@fluentui/react-icons';
import type { Metric } from '../api/types';

const icons = {
  primary: MoneyRegular,
  accent: GiftRegular,
  success: ArrowUpRegular,
};

export function MetricCard({ metric }: { metric: Metric }) {
  const Icon = icons[metric.tone] ?? SparkleRegular;
  return (
    <Card className={`metric-card metric-card--${metric.tone}`} appearance="filled-alternative">
      <div className="metric-card__topline"><Text className="eyebrow">{metric.label}</Text><Icon aria-hidden="true" /></div>
      <Text className="metric-card__value">{metric.value}</Text>
      <Text className="metric-card__detail">{metric.detail}</Text>
    </Card>
  );
}
