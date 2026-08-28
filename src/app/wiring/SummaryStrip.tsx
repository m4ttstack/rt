import type { ReactNode } from 'react';
import { Anchor, Badge, Group, Stack, Text } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Link } from 'wouter';

import { WIRING_ATTENTION_HREF } from './attentionFilter';
import { HealthChip } from './HealthChip';
import type { SpineEntry, WiringHealth } from './outline';
import { SOFT_RULE } from './SlotRow';

/** The strip's column labels: small caps, tracked out, so five of them read
    as one header band rather than five sentences. Mirrors the runs
    redesign's `FactLabel` (`RunDetail.tsx`) exactly -- this strip is that
    pattern's sibling, not a new one. */
function FactLabel({ children }: { children: ReactNode }) {
  const { text } = useSchemeColors();
  return (
    <Text
      c={text.muted}
      fz={10}
      fw={600}
      tt="uppercase"
      style={{ letterSpacing: '0.06em' }}
    >
      {children}
    </Text>
  );
}

/** One fact column. Only the first drops its left inset and only the last
    drops its divider -- `Main.dc.html` `.fact`/`.fact:first-child`/
    `.fact:last-child`. */
function Fact({
  label,
  children,
  isFirst,
  isLast,
  testId,
}: {
  label: string;
  children: ReactNode;
  isFirst?: boolean;
  isLast?: boolean;
  testId: string;
}) {
  return (
    <Stack
      gap={3}
      pl={isFirst ? 0 : 'xxl'}
      pr="xxl"
      style={isLast ? undefined : { borderRight: `1px solid ${SOFT_RULE}` }}
      data-testid={testId}
    >
      <FactLabel>{label}</FactLabel>
      {children}
    </Stack>
  );
}

export interface SummaryStripProps {
  orchestrator: SpineEntry | null;
  workType: string | null;
  stageCount: number;
  health: WiringHealth;
  attentionCount: number;
}

/**
 * The pipeline's structured header: five always-on facts, a sibling of
 * `RunDetail`'s `SummaryCard` fact strip rather than a new invention. Never
 * filter-aware -- the attention filter's own "showing N of M" caveat lives
 * beside the spine it describes, not here (see `AttentionFilterNotice` in
 * `WiringMap.tsx`).
 */
export function SummaryStrip({
  orchestrator,
  workType,
  stageCount,
  health,
  attentionCount,
}: SummaryStripProps) {
  const { bg, text } = useSchemeColors();

  return (
    <Group
      gap={0}
      wrap="nowrap"
      align="center"
      bg={bg.level3}
      py="xl"
      px="xxl"
      mb="lg"
      style={{ borderBottom: `1px solid ${SOFT_RULE}` }}
      data-testid="summary-strip"
    >
      <Fact label="Orchestrator" isFirst testId="fact-orchestrator">
        {orchestrator?.ref ? (
          <Anchor
            component="button"
            type="button"
            fz={13}
            fw={600}
            onClick={() =>
              document
                .querySelector(`[data-testid="skill-row-${orchestrator.key}"]`)
                ?.scrollIntoView?.({ block: 'center' })
            }
            style={{
              background: 'none',
              border: 0,
              padding: 0,
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            {orchestrator.ref}
          </Anchor>
        ) : (
          <Text fz={13} fw={600} c={text.dimmed}>
            none
          </Text>
        )}
      </Fact>
      <Fact label="Work type" testId="fact-work-type">
        {workType ? (
          <Text fz={13} fw={600}>
            {workType}
          </Text>
        ) : (
          <Text fz={13} fw={600} c={text.dimmed}>
            none
          </Text>
        )}
      </Fact>
      <Fact label="Stages" testId="fact-stages">
        <Text fz={13} fw={600}>
          {stageCount} in run order
        </Text>
      </Fact>
      <Fact label="Pack health" testId="fact-health">
        <HealthChip health={health} fz={13} fw={600} />
      </Fact>
      <Fact label="Attention" isLast testId="fact-attention">
        {attentionCount > 0 ? (
          <Badge
            component={Link}
            href={WIRING_ATTENTION_HREF}
            size="sm"
            variant="light"
            color="warn"
            style={{ cursor: 'pointer' }}
            data-testid="attention-count"
          >
            {attentionCount} need attention
          </Badge>
        ) : (
          <Text fz={13} fw={600} c={text.muted}>
            {attentionCount} need attention
          </Text>
        )}
      </Fact>
    </Group>
  );
}
