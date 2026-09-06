import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';

import {
  Alert,
  Badge,
  Button,
  Group,
  PageShell,
  Paper,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import type { MetricKey, UserDetailResponse } from '../../shared/types';
import {
  COLUMNS,
  deltaValue,
  formatValue,
  GROUP_META,
  GROUP_ORDER,
  rankValue,
  sortValue,
  type Column,
} from '../columns';
import { useUserDetail } from '../hooks/useLeaderboard';
import { DeltaBadge } from './DeltaBadge';
import { EvidenceTable } from './EvidenceTable';

interface RangeState {
  range: string;
  start?: string;
  end?: string;
}

interface Props {
  username: string;
  initialStat: string | null;
  range: RangeState;
  trend: boolean;
}

const GROUPS = GROUP_ORDER.map(key => {
  const meta = GROUP_META[key];
  return {
    key,
    label: meta.hint ? `${meta.label} (${meta.hint})` : meta.label,
    color: GROUP_META[key].accent,
  };
});

const BORDER = '1px solid var(--mantine-color-default-border)';

export function DetailPage({ username, initialStat, range, trend }: Props) {
  const selection = useMemo(
    () => ({ range: range.range, start: range.start, end: range.end, trend }),
    [range.range, range.start, range.end, trend]
  );
  const detailQuery = useUserDetail(username, selection);
  const data: UserDetailResponse | null = detailQuery.data ?? null;
  const error = detailQuery.error ? detailQuery.error.message : null;
  const loading = detailQuery.isLoading;

  const validInitial = COLUMNS.some(c => c.key === initialStat)
    ? (initialStat as MetricKey)
    : null;
  const [selected, setSelected] = useState<MetricKey>(
    validInitial ?? COLUMNS[0]!.key
  );

  useEffect(() => {
    if (validInitial) setSelected(validInitial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, initialStat]);

  const col = useMemo(
    () => COLUMNS.find(c => c.key === selected) ?? COLUMNS[0]!,
    [selected]
  );

  return (
    <PageShell>
      <Stack gap="lg">
        <Button
          variant="subtle"
          color="gray"
          size="xs"
          leftSection={<Icon name="arrowLeft" size={14} />}
          component={Link}
          href="/"
          style={{ alignSelf: 'flex-start' }}
        >
          Back to leaderboard
        </Button>

        {error && (
          <Alert color="red" title="Error" variant="light">
            {error}
          </Alert>
        )}
        {loading && !data && <Text c="dimmed">Loading…</Text>}

        {data && (
          <>
            <Stack gap={2}>
              <Group gap="xs" align="baseline">
                <Text fw={700} size="xl">
                  {data.user.name ?? data.user.username}
                </Text>
                {data.user.isCurrentUser && (
                  <Badge size="xs" variant="light" color="accent">
                    you
                  </Badge>
                )}
              </Group>
              <Text size="sm" c="dimmed">
                @{data.user.username} · {data.window.start.slice(0, 10)} →{' '}
                {data.window.end.slice(0, 10)}
                {data.hasTrend && ' · trend on'}
                {!data.user.resolved && (
                  <Text component="span" c="warn" ml={8}>
                    unresolved on GitLab
                  </Text>
                )}
              </Text>
            </Stack>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '16rem minmax(0, 1fr)',
                gap: 24,
                alignItems: 'start',
              }}
            >
              <StatRail
                data={data}
                selected={selected}
                onSelect={setSelected}
              />
              <EvidencePanel data={data} col={col} trend={trend} />
            </div>
          </>
        )}
      </Stack>
    </PageShell>
  );
}

function StatRail({
  data,
  selected,
  onSelect,
}: {
  data: UserDetailResponse;
  selected: MetricKey;
  onSelect: (k: MetricKey) => void;
}) {
  const { bg } = useSchemeColors();

  return (
    <Stack gap="md" style={{ position: 'sticky', top: 24, alignSelf: 'start' }}>
      {GROUPS.map(g => {
        const cols = COLUMNS.filter(c => c.group === g.key);
        if (cols.length === 0) return null;
        return (
          <div key={g.key}>
            <Text
              size="10px"
              tt="uppercase"
              c={g.color}
              mb={4}
              style={{ letterSpacing: '0.06em' }}
            >
              {g.label}
            </Text>
            <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
              {cols.map((c, i) => {
                const value = sortValue(data.user.metrics, c);
                const rank = rankValue(data.user.metrics, c);
                const active = c.key === selected;
                return (
                  <button
                    key={c.key}
                    data-testid={`stat-${c.key}`}
                    onClick={() => onSelect(c.key)}
                    style={{
                      display: 'flex',
                      width: '100%',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '6px 12px',
                      border: 'none',
                      borderBottom: i === cols.length - 1 ? 'none' : BORDER,
                      textAlign: 'left',
                      cursor: 'pointer',
                      font: 'inherit',
                      backgroundColor: active
                        ? bg.color('accent')
                        : 'transparent',
                    }}
                  >
                    <Text
                      component="span"
                      size="sm"
                      c={active ? 'accent' : undefined}
                      truncate
                    >
                      {c.label}
                    </Text>
                    <span
                      style={{
                        flex: 'none',
                        fontFamily: 'var(--mantine-font-family-monospace)',
                        fontVariantNumeric: 'tabular-nums',
                        fontSize: 13,
                      }}
                    >
                      {formatValue(value, c)}
                      {rank !== null && (
                        <Text component="span" size="10px" c="dimmed" ml={4}>
                          #{rank}
                        </Text>
                      )}
                    </span>
                  </button>
                );
              })}
            </Paper>
          </div>
        );
      })}
    </Stack>
  );
}

function EvidencePanel({
  data,
  col,
  trend,
}: {
  data: UserDetailResponse;
  col: Column;
  trend: boolean;
}) {
  const value = sortValue(data.user.metrics, col);
  const rank = rankValue(data.user.metrics, col);
  const delta = trend ? deltaValue(data.user.metrics, col) : null;
  const evidence = data.evidence[col.key];

  return (
    <Stack gap="sm" style={{ minWidth: 0 }}>
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        <div>
          <Text size="lg" fw={600}>
            {col.label}
          </Text>
          <Text size="xs" c="dimmed" style={{ maxWidth: '42rem' }}>
            {col.description}
          </Text>
        </div>
        <Group
          gap="sm"
          align="baseline"
          style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}
        >
          <Text size="xl" fw={700}>
            {formatValue(value, col)}
          </Text>
          {rank !== null && (
            <Text size="sm" c="dimmed">
              #{rank}
            </Text>
          )}
          {delta !== null && delta !== 0 && (
            <DeltaBadge delta={delta} col={col} />
          )}
        </Group>
      </Group>

      {evidence?.summary && (
        <Text size="sm" c="dimmed">
          {evidence.summary}
        </Text>
      )}
      <EvidenceTable evidence={evidence} />
    </Stack>
  );
}
