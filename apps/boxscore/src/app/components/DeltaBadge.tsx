import { Text } from '@mattstack/app-kit/core';
import { deltaIsGood, formatValue, type Column } from '../columns';

/** A nonzero trend delta: colored direction arrow + absolute value. `data-good` is a stable test hook. */
export function DeltaBadge({
  delta,
  col,
  className,
}: {
  delta: number;
  col: Column;
  className?: string;
}) {
  const good = deltaIsGood(delta, col.better);
  return (
    <Text
      component="span"
      fw={600}
      c={good ? 'green' : 'red'}
      data-good={good}
      className={className}
      style={{ whiteSpace: 'nowrap' }}
    >
      {delta > 0 ? '▲' : '▼'} {formatValue(Math.abs(delta), col)}
    </Text>
  );
}
