import { useLocation } from 'wouter';

import { Card, Group, SimpleGrid, Stack, Text } from '@mattstack/app-kit/core';
import type { LeaderboardResponse, UserRow } from '../../shared/types';
import {
  COLUMNS,
  deltaValue,
  formatValue,
  GROUP_META,
  rankValue,
  sortValue,
  type Column,
} from '../columns';
import { DeltaBadge } from './DeltaBadge';
import styles from './leaderboard.module.css';
import { MetricTip } from './MetricTip';
import { Tooltip } from './Tooltip';

interface Props {
  data: LeaderboardResponse;
  trend: boolean;
}

export function MetricCards({ data, trend }: Props) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
      {COLUMNS.map(col => (
        <Card
          key={col.key}
          withBorder
          radius="md"
          padding="md"
          data-testid={`metric-card-${col.key}`}
        >
          <Group justify="space-between" align="baseline" mb="xs">
            <Text size="sm" fw={600}>
              <Tooltip content={<MetricTip col={col} />}>{col.label}</Tooltip>
            </Text>
            <Text
              size="10px"
              tt="uppercase"
              c={GROUP_META[col.group].accent}
              style={{ letterSpacing: '0.06em' }}
            >
              {col.group}
            </Text>
          </Group>
          <Ranking col={col} users={data.users} trend={trend} />
        </Card>
      ))}
    </SimpleGrid>
  );
}

function Ranking({
  col,
  users,
  trend,
}: {
  col: Column;
  users: UserRow[];
  trend: boolean;
}) {
  const [, setLocation] = useLocation();
  // Order and position come from the server-computed rank (ties share a rank),
  // so the cards never disagree with the table or the detail rail.
  const ranked = [...users]
    .filter(u => u.resolved && sortValue(u.metrics, col) !== null)
    .sort(
      (a, b) =>
        (rankValue(a.metrics, col) ?? 99) - (rankValue(b.metrics, col) ?? 99)
    );

  if (ranked.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        No data.
      </Text>
    );
  }

  return (
    <Stack gap={1}>
      {ranked.map(u => {
        const d = trend ? deltaValue(u.metrics, col) : null;
        return (
          <button
            key={u.username}
            className={styles.cardRow}
            onClick={() =>
              setLocation(
                `/user/${encodeURIComponent(u.username)}/${encodeURIComponent(col.key)}`
              )
            }
            title={`${u.name ?? u.username} · ${col.label} details`}
          >
            <Group gap={8} wrap="nowrap">
              <Text
                size="xs"
                c="dimmed"
                style={{ width: 16, textAlign: 'right' }}
              >
                {rankValue(u.metrics, col) ?? '—'}
              </Text>
              <Text
                size="sm"
                fw={u.isCurrentUser ? 600 : 400}
                c={u.isCurrentUser ? 'accent' : undefined}
              >
                {u.name ?? u.username}
              </Text>
            </Group>
            <Group
              gap={8}
              wrap="nowrap"
              style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}
            >
              <Text
                component="span"
                size="sm"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatValue(sortValue(u.metrics, col), col)}
              </Text>
              {d !== null && d !== 0 && <DeltaBadge delta={d} col={col} />}
            </Group>
          </button>
        );
      })}
    </Stack>
  );
}
