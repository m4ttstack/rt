import { useState } from 'react';
import type { RunDecisionRow } from '@mattstack/rt-client';
import { useQuery } from '@tanstack/react-query';

import {
  Badge,
  Code,
  Drawer,
  Group,
  Skeleton,
  Stack,
  Text,
  UnstyledButton,
} from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import type {
  ConfigDepRow,
  EffectiveInputsPayload,
  PackVersionRow,
} from '../../server/effectiveInputs';
import { client } from '../api';
import { shortValue } from '../config/chain';
import { navigate } from '../router/navigation';
import { useDrawerSurface } from '../wiring/drawerSurface';
import { QuietBadge } from '../wiring/QuietBadge';
import { CommandProvenance } from './CommandProvenance';

const ATTRIBUTION =
  'joins rt runs show, rt skills packs --json, and git show at the recorded pack sha';

/** Matches every other code surface in the console (CompiledView's
    CODE_STYLE) rather than Code's own default block padding and size. */
const CODE_STYLE = {
  padding: 0,
  background: 'transparent',
  fontSize: 'var(--mantine-font-size-xs)',
  lineHeight: 1.65,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
} as const;

function useEffectiveInputs(repo: string, runId: string) {
  return useQuery({
    queryKey: ['effective-inputs', repo, runId],
    queryFn: async () => {
      const res = await client.api.runs[':repo'][':runId'][
        'effective-inputs'
      ].$get({ param: { repo, runId } });
      const body = await res.json();
      if (!res.ok) {
        const message =
          body &&
          typeof body === 'object' &&
          'error' in body &&
          typeof (body as { error?: unknown }).error === 'string'
            ? (body as { error: string }).error
            : `effective inputs failed: ${res.status}`;
        throw new Error(message);
      }
      return body as EffectiveInputsPayload;
    },
  });
}

type StageDocResult = { text: string } | { error: string };

function useStageDoc(repo: string, runId: string, stage: string | null) {
  return useQuery({
    queryKey: ['stage-doc', repo, runId, stage],
    queryFn: async () => {
      const res = await client.api.runs[':repo'][':runId']['stage-doc'].$get({
        param: { repo, runId },
        query: { stage: stage ?? '' },
      });
      return (await res.json()) as StageDocResult;
    },
    enabled: stage !== null,
  });
}

function DriftBadge({ drifted }: { drifted: boolean | null }) {
  if (drifted === true) {
    return (
      <Badge size="xs" variant="light" color="warn">
        source has moved since
      </Badge>
    );
  }
  if (drifted === false) {
    return (
      <Badge size="xs" variant="light" color="ok">
        matches source
      </Badge>
    );
  }
  return <QuietBadge>pack not resolvable here</QuietBadge>;
}

function PackRow({ pack }: { pack: PackVersionRow }) {
  return (
    <Group gap="xs" wrap="nowrap" data-testid={`pack-row-${pack.pack}`}>
      <Text size="sm" ff="monospace">
        pack {pack.pack} @ {pack.recordedSha}
      </Text>
      <DriftBadge drifted={pack.drifted} />
    </Group>
  );
}

function StageRow({
  stage,
  onOpen,
}: {
  stage: string;
  onOpen: (stage: string) => void;
}) {
  const { text } = useSchemeColors();
  return (
    <UnstyledButton
      onClick={() => onOpen(stage)}
      aria-label={`view compiled doc for ${stage}`}
      data-testid={`stage-row-${stage}`}
    >
      <Group gap={6} wrap="nowrap">
        <Icons.chevronRight size={12} color={text.muted} />
        <Text size="sm">{stage}</Text>
      </Group>
    </UnstyledButton>
  );
}

function PipelineSection({
  payload,
  onOpenStage,
}: {
  payload: EffectiveInputsPayload;
  onOpenStage: (stage: string) => void;
}) {
  const { text } = useSchemeColors();
  return (
    <Stack gap="xs" data-testid="effective-inputs-pipeline">
      <Text fw={700}>Pipeline &amp; stages</Text>
      <Text size="sm">
        {payload.pipeline} · {payload.workType}
      </Text>
      {payload.packVersions === null ? (
        <Text size="xs" c={text.muted}>
          pre-v2 run — pack version not recorded
        </Text>
      ) : (
        <Stack gap={4}>
          {payload.packVersions.map(pack => (
            <PackRow key={pack.pack} pack={pack} />
          ))}
          {payload.packDirty && (
            <Text size="xs" c={text.muted}>
              pack tree had uncommitted changes — the as-run text may exist in
              no commit
            </Text>
          )}
        </Stack>
      )}
      <Stack gap={2}>
        {payload.stages.map(stage => (
          <StageRow key={stage} stage={stage} onOpen={onOpenStage} />
        ))}
      </Stack>
    </Stack>
  );
}

function DecisionRow({ decision }: { decision: RunDecisionRow }) {
  const { text } = useSchemeColors();
  return (
    <Group
      gap={6}
      wrap="nowrap"
      data-testid={`decision-row-${decision.contract}`}
    >
      <Text size="sm">
        {decision.contract} → {decision.selection}
      </Text>
      <Text size="xs" c={text.muted}>
        {decision.scope} · {decision.decided_by} ·{' '}
        {new Date(decision.decided_at).toLocaleString()}
      </Text>
    </Group>
  );
}

function DecisionsSection({ decisions }: { decisions: RunDecisionRow[] }) {
  const { text } = useSchemeColors();
  return (
    <Stack gap="xs" data-testid="effective-inputs-decisions">
      <Text fw={700}>Decisions in force</Text>
      {decisions.length === 0 ? (
        <Text size="xs" c={text.muted}>
          No decisions were recorded for this run.
        </Text>
      ) : (
        decisions.map(decision => (
          <DecisionRow
            key={`${decision.contract}-${decision.decided_at}`}
            decision={decision}
          />
        ))
      )}
    </Stack>
  );
}

function ConfigRow({ row }: { row: ConfigDepRow }) {
  const { text } = useSchemeColors();
  // Provenance arrives weakest-first (rt-client's resolver contract, same as
  // ExplainRowWire) -- the last entry is the strongest layer that set it.
  const strongest = row.provenance.at(-1);
  return (
    <UnstyledButton
      onClick={() => navigate('/config/' + row.key)}
      aria-label={`open ${row.key} in the config lens`}
      data-testid={`config-row-${row.key}`}
    >
      <Group gap={6} wrap="nowrap">
        <Text size="sm" ff="monospace">
          {row.key}
        </Text>
        <Text size="xs" c={text.muted}>
          {shortValue(row.value)}
        </Text>
        {strongest && <QuietBadge>{strongest.scope}</QuietBadge>}
      </Group>
    </UnstyledButton>
  );
}

function ConfigSection({ config }: { config: ConfigDepRow[] }) {
  const { text } = useSchemeColors();
  return (
    <Stack gap="xs" data-testid="effective-inputs-config">
      <Text fw={700}>Configuration</Text>
      {config.map(row => (
        <ConfigRow key={row.key} row={row} />
      ))}
      <Text size="xs" c={text.dimmed}>
        Current values, not as-run — runs do not record the config they read.
      </Text>
    </Stack>
  );
}

function StageDocDrawer({
  repo,
  runId,
  stage,
  onClose,
}: {
  repo: string;
  runId: string;
  stage: string | null;
  onClose: () => void;
}) {
  const { text } = useSchemeColors();
  const surface = useDrawerSurface();
  const query = useStageDoc(repo, runId, stage);

  return (
    <Drawer
      opened={stage !== null}
      onClose={onClose}
      position="right"
      size={640}
      padding="lg"
      styles={surface}
      data-testid="stage-doc-drawer"
      title={
        <Text fz="xl" fw={700}>
          {stage}
        </Text>
      }
    >
      {query.isPending && <Skeleton height={200} />}
      {query.isError && (
        <Text size="xs" c={text.muted}>
          {(query.error as Error).message}
        </Text>
      )}
      {query.data && 'text' in query.data && (
        <Code block style={CODE_STYLE}>
          {query.data.text}
        </Code>
      )}
      {query.data && 'error' in query.data && (
        <Text size="xs" c={text.muted} data-testid="stage-doc-no-doc">
          {query.data.error}
        </Text>
      )}
    </Drawer>
  );
}

export interface EffectiveInputsProps {
  repo: string;
  runId: string;
  decisions: RunDecisionRow[];
}

/**
 * What this run was actually told, joined from three sources rt never
 * joins itself: the run row, the pack roster, and the pack repo at the sha
 * the run recorded. A plain `useQuery` (not suspense) on purpose -- this
 * panel sits below a Timeline that already rendered, and a join across three
 * sources is more likely to fail than any single-source panel on the page.
 */
export function EffectiveInputs({
  repo,
  runId,
  decisions,
}: EffectiveInputsProps) {
  const { text } = useSchemeColors();
  const query = useEffectiveInputs(repo, runId);
  const [openStage, setOpenStage] = useState<string | null>(null);

  return (
    <Stack gap="md" data-testid="effective-inputs">
      <Text fw={700} size="lg">
        Effective inputs — what was this run actually told?
      </Text>
      <CommandProvenance
        command={ATTRIBUTION}
        asOf={query.dataUpdatedAt || undefined}
      />
      {query.isPending && (
        <Skeleton height={160} data-testid="effective-inputs-loading" />
      )}
      {query.isError && (
        <Text
          size="sm"
          c={text.highContrast('bad')}
          data-testid="effective-inputs-error"
        >
          Could not load effective inputs: {(query.error as Error).message}
        </Text>
      )}
      {query.data && (
        <>
          <PipelineSection payload={query.data} onOpenStage={setOpenStage} />
          <DecisionsSection decisions={decisions} />
          <ConfigSection config={query.data.config} />
        </>
      )}
      <StageDocDrawer
        repo={repo}
        runId={runId}
        stage={openStage}
        onClose={() => setOpenStage(null)}
      />
    </Stack>
  );
}
