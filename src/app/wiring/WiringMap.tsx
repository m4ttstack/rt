import { Component, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import {
  Alert,
  Badge,
  GenericError,
  Group,
  LazyLoader,
  PageShell,
  Paper,
  Select,
  Skeleton,
  Stack,
  Text,
  Timeline,
} from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import { CommandProvenance } from '../runs/CommandProvenance';
import { CompileDrawer } from './CompileDrawer';
import {
  buildSpine,
  type OrphanFillEntry,
  type SpineEntry,
  type WiringHealth,
  type WiringSpine,
} from './outline';
import { HEALTH_COLOR, SkillRow } from './SkillRow';
import {
  useComposition,
  useCompositionSnapshot,
  usePacks,
  useSkillsCheck,
} from './useWiring';

/** The spine's geometry, matching `RunDetail`'s Timeline so the two read as
    the same object: a 22px bullet on a 2px line. */
const BULLET_SIZE = 22;
const LINE_WIDTH = 2;

const PIPELINE_NOTICE: Record<'absent' | 'empty', string> = {
  absent:
    'This rt does not report pipelines, so there is no run order to draw — update rt to see the pipeline. Every wired skill is still listed below.',
  empty:
    "This pack's manifest declares no pipeline, so there is no run order. Every wired skill is still listed below.",
};

function OrphanFillRow({ node }: { node: OrphanFillEntry }) {
  const { text } = useSchemeColors();
  const suffix = node.fill.slice(node.fill.indexOf(':') + 1);

  return (
    <Stack gap={1} data-testid={`orphan-fill-${node.fill}`}>
      <Group gap="xs" wrap="nowrap">
        <div
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            flex: 'none',
            background: text.highContrast('purple'),
          }}
        />
        <Text fw={600} size="lg">
          {suffix}
        </Text>
        <Text size="sm" c={text.muted} truncate>
          {node.fill}
        </Text>
        <Badge size="sm" variant="light" color="purple">
          bound by nothing
        </Badge>
      </Group>
      <Text size="xs" c={text.muted} pl="lg">
        A fill nothing resolves to — not a stage&apos;s slot, not a verb&apos;s,
        not another plugin&apos;s. Safe to delete unless something outside this
        manifest reaches it.
      </Text>
    </Stack>
  );
}

/**
 * The last stop on the spine, not a second section: one continuous list, the
 * same way `RunDetail`'s Timeline ends. Orphaned fills sit at its end because
 * the question they answer -- "can I delete this?" -- is the last one asked.
 */
function OutsideThePipeline({
  spine,
  previewVerb,
  onPreview,
}: {
  spine: WiringSpine;
  previewVerb: string | null;
  onPreview: (entry: SpineEntry) => void;
}) {
  const { text } = useSchemeColors();

  return (
    <Stack gap="sm" mt="sm" data-testid="outside-the-pipeline">
      <Text size="xs" c={text.muted}>
        Wired skills the pipeline never calls — you invoke these directly, or
        another plugin does. No order to run in.
      </Text>
      {spine.outside.map(entry => (
        <SkillRow
          key={entry.key}
          entry={entry}
          withDot
          previewOpen={previewVerb === entry.verb}
          onPreview={() => onPreview(entry)}
        />
      ))}
      {spine.orphans.map(node => (
        <OrphanFillRow key={node.fill} node={node} />
      ))}
    </Stack>
  );
}

function SpineSummary({ spine }: { spine: WiringSpine }) {
  const { text } = useSchemeColors();

  return (
    <Group gap="xs" wrap="nowrap" pb="lg" data-testid="spine-summary">
      {spine.orchestrator?.ref && (
        <>
          <Text size="sm" c={text.muted}>
            Ran by
          </Text>
          <Text size="sm" fw={600}>
            {spine.orchestrator.ref}
          </Text>
          <Text size="sm" c={text.muted}>
            ·
          </Text>
        </>
      )}
      <Text size="sm" c={text.muted}>
        work type
      </Text>
      <Text size="sm" fw={600}>
        {spine.workType ?? 'none'}
      </Text>
      <Text size="sm" c={text.muted}>
        ·
      </Text>
      <Text size="sm" c={text.muted}>
        {spine.stages.length} stages
      </Text>
      <div style={{ flex: 1 }} />
      {spine.attentionCount > 0 && (
        <Badge
          size="sm"
          variant="light"
          color="warn"
          data-testid="attention-count"
        >
          {spine.attentionCount} need attention
        </Badge>
      )}
    </Group>
  );
}

/**
 * Health colours the bullet; it never replaces what the bullet says. A stage
 * in trouble still has to state where it runs, so the number stays and the
 * ring around it changes.
 */
function useBulletStyles() {
  const { bg, text } = useSchemeColors();

  return (health: WiringHealth): CSSProperties => {
    const color = HEALTH_COLOR[health];
    if (health === 'never-compiled') {
      // The filled/contrast pair, not `highContrast`: the latter is a TEXT
      // colour (shade 1 in dark), so using it as a fill puts a white glyph on
      // near-white at 1.4:1. Mantine computes this pair per scheme so the
      // glyph always reads against the fill.
      return {
        borderColor: 'var(--mantine-color-bad-filled)',
        backgroundColor: 'var(--mantine-color-bad-filled)',
        color: 'var(--mantine-color-bad-contrast)',
      };
    }
    if (color) {
      return {
        borderColor: text.highContrast(color),
        color: text.highContrast(color),
        backgroundColor: bg.level2,
      };
    }
    return { backgroundColor: bg.level2, color: text.muted };
  };
}

function StepBullet({ step }: { step: number }) {
  return (
    <Text fz={9} fw={600} lh={1}>
      {step}
    </Text>
  );
}

function WiringSpineView({
  pack,
  workType,
}: {
  pack: string;
  workType: string | null;
}) {
  const { bg, text, border } = useSchemeColors();
  const compositionQuery = useComposition(pack);
  const checkQuery = useSkillsCheck(pack);
  const bulletStyles = useBulletStyles();
  const [preview, setPreview] = useState<{
    verb: string;
    changedFiles: string[];
  } | null>(null);

  const spine = useMemo(
    () =>
      buildSpine(
        compositionQuery.data,
        checkQuery.data ?? { verbs: [] },
        workType
      ),
    [compositionQuery.data, checkQuery.data, workType]
  );

  const openPreview = (entry: SpineEntry) => {
    if (!entry.verb) return;
    setPreview(current =>
      current?.verb === entry.verb
        ? null
        : {
            verb: entry.verb as string,
            changedFiles: [...entry.staleFiles, ...entry.orphanFiles],
          }
    );
  };

  const spineEntries: SpineEntry[] = [
    ...(spine.orchestrator ? [spine.orchestrator] : []),
    ...spine.stages,
  ];

  return (
    <Paper
      bg={bg.level2}
      p="xl"
      radius="md"
      style={{ border: `1px solid ${border.default}` }}
      data-testid="wiring-spine"
    >
      <SpineSummary spine={spine} />

      {spine.pipelineState !== 'ok' && (
        <Alert
          variant="light"
          color="warn"
          icon={<Icons.warning size={14} />}
          mb="lg"
          data-testid="pipeline-notice"
        >
          <Text size="xs">{PIPELINE_NOTICE[spine.pipelineState]}</Text>
        </Alert>
      )}

      {checkQuery.isError && (
        <Alert
          variant="light"
          color="warn"
          icon={<Icons.warning size={14} />}
          mb="lg"
          data-testid="check-error"
        >
          <Text size="xs">
            rt skills check failed, so no row below can state its drift:{' '}
            {(checkQuery.error as Error).message}
          </Text>
        </Alert>
      )}

      <Timeline
        bulletSize={BULLET_SIZE}
        lineWidth={LINE_WIDTH}
        data-testid="wiring-timeline"
      >
        {spineEntries.map(entry => (
          <Timeline.Item
            key={entry.key}
            styles={{ itemBullet: bulletStyles(entry.health) }}
            bullet={
              entry.step === null ? (
                <Icons.zap size={12} />
              ) : (
                <StepBullet step={entry.step} />
              )
            }
            data-testid={`timeline-item-${entry.key}`}
          >
            <SkillRow
              entry={entry}
              previewOpen={preview?.verb === entry.verb}
              onPreview={() => openPreview(entry)}
            />
          </Timeline.Item>
        ))}

        <Timeline.Item
          bullet={<Icons.link size={12} />}
          styles={{ itemBullet: bulletStyles('unknown') }}
          title={
            <Text fw={600} size="lg">
              Outside the pipeline
            </Text>
          }
          data-testid="timeline-item-outside"
        >
          <OutsideThePipeline
            spine={spine}
            previewVerb={preview?.verb ?? null}
            onPreview={openPreview}
          />
        </Timeline.Item>
      </Timeline>

      {spine.outside.length === 0 && spine.orphans.length === 0 && (
        <Text size="xs" c={text.dimmed}>
          Nothing outside the pipeline: every binder in this pack is a stage.
        </Text>
      )}

      <CompileDrawer
        pack={pack}
        verb={preview?.verb ?? null}
        changedFiles={preview?.changedFiles ?? []}
        onClose={() => setPreview(null)}
      />
    </Paper>
  );
}

/**
 * Scoped to the spine itself (not the app-wide `RouteErrorBoundary`), so a
 * thrown `useComposition` suspense query loses only the tree -- the page
 * title and pack picker (rendered by the caller outside this boundary)
 * survive the fallback and stay usable to switch packs.
 */
class WiringErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <GenericError
          title="This pack's composition failed to load"
          message={this.state.error.message}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

export function WiringMap() {
  const { text } = useSchemeColors();
  const packsQuery = usePacks();
  const [explicitPack, setExplicitPack] = useState<string | null>(null);
  const [explicitWorkType, setExplicitWorkType] = useState<string | null>(null);

  const packs = packsQuery.data?.packs ?? [];
  const pack = explicitPack ?? packs[0]?.name ?? null;

  const snapshot = useCompositionSnapshot(pack);
  const workTypes = useMemo(
    () => Object.keys(snapshot.data?.pipelines ?? {}),
    [snapshot.data]
  );
  const workType =
    explicitWorkType && workTypes.includes(explicitWorkType)
      ? explicitWorkType
      : (workTypes[0] ?? null);

  return (
    <PageShell
      title="Wiring"
      actions={
        <Group gap="sm" wrap="nowrap">
          <CommandProvenance
            command="rt skills composition"
            asOf={snapshot.dataUpdatedAt || undefined}
          />
          {packs.length > 1 && pack && (
            <Select
              size="xs"
              w={168}
              data={packs.map(p => ({ value: p.name, label: p.name }))}
              value={pack}
              onChange={value => {
                setExplicitPack(value);
                setExplicitWorkType(null);
              }}
              data-testid="pack-select"
            />
          )}
          {workTypes.length > 1 && workType && (
            <Select
              size="xs"
              w={132}
              data={workTypes.map(t => ({ value: t, label: t }))}
              value={workType}
              onChange={setExplicitWorkType}
              data-testid="work-type-select"
            />
          )}
        </Group>
      }
    >
      {packsQuery.isError ? (
        <GenericError
          title="Couldn't load skills packs"
          message={(packsQuery.error as Error).message}
          onRetry={() => void packsQuery.refetch()}
        />
      ) : !pack ? (
        packsQuery.isPending ? (
          <Skeleton height={200} data-testid="packs-loading" />
        ) : (
          <Text size="sm" c={text.dimmed} data-testid="no-packs">
            No skills packs found.
          </Text>
        )
      ) : (
        <WiringErrorBoundary key={pack}>
          <LazyLoader>
            <WiringSpineView pack={pack} workType={workType} />
          </LazyLoader>
        </WiringErrorBoundary>
      )}
    </PageShell>
  );
}
