import { Component, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link, useSearch } from 'wouter';
import { navigate } from 'wouter/use-browser-location';

import {
  Alert,
  Anchor,
  Badge,
  Button,
  GenericError,
  Group,
  LazyLoader,
  PageShell,
  Select,
  Skeleton,
  Stack,
  Text,
  Timeline,
} from '@mattstack/app-kit/core';
import type { PageShellTab } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import { CommandProvenance } from '../runs/CommandProvenance';
import { AttentionEmptyState } from './AttentionEmptyState';
import {
  comparedVerbCount,
  isAttentionOnly,
  onlyNeedsAttention,
  WIRING_HREF,
} from './attentionFilter';
import { HEALTH_COLOR } from './HealthChip';
import { HealthTab } from './HealthTab';
import { OnDemandView } from './OnDemandView';
import {
  buildSpine,
  spineRows,
  type SpineEntry,
  type WiringHealth,
  type WiringSpine,
} from './outline';
import { QuietBadge } from './QuietBadge';
import { SkillRow } from './SkillRow';
import { SkillSplitLayout } from './SkillSplitLayout';
import { SummaryStrip } from './SummaryStrip';
import { SurfaceTab } from './SurfaceTab';
import { useSkillSelection } from './useSkillSelection';
import {
  useAttentionCount,
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

/**
 * Shown only while the attention filter is on: which rows survived it, how
 * many stages that dropped (check has no artifact to flag on a stage, so
 * hiding one is not the same as it being healthy), and the way back to the
 * unfiltered spine. `SummaryStrip` carries the always-on facts (work type
 * included); this is the filter's own caveat, not a second summary.
 */
function AttentionFilterNotice({
  spine,
  shown,
}: {
  spine: WiringSpine;
  shown: WiringSpine;
}) {
  const { text } = useSchemeColors();
  const hiddenStages = spine.stages.length - shown.stages.length;
  // Count only the rows the Pipeline tab actually draws (orchestrator +
  // stages). Everything outside the run order now lives on the On-demand
  // tab, so counting `spine.outside` here would claim rows this list never
  // renders -- "showing 2 of 6" while one row is on screen.
  const pipelineRows = (s: WiringSpine) =>
    (s.orchestrator ? 1 : 0) + s.stages.length;

  return (
    <Group gap="xs" wrap="nowrap" pb="lg" data-testid="spine-summary">
      <Text size="sm" c={text.muted}>
        work type
      </Text>
      <Text size="sm" fw={600}>
        {spine.workType ?? 'none'}
      </Text>
      <Text size="sm" c={text.muted}>
        ·
      </Text>
      <Text size="sm" c={text.muted} data-testid="shown-of-total">
        showing {pipelineRows(shown)} of {pipelineRows(spine)} rows
      </Text>
      {hiddenStages > 0 && (
        <>
          <Text size="sm" c={text.muted}>
            ·
          </Text>
          <Text size="xs" c={text.muted} truncate>
            {hiddenStages} stages hidden — check covers no artifact of a stage
            to flag
          </Text>
        </>
      )}
      <div style={{ flex: 1 }} />
      {/* Always offered while filtered, including at zero rows -- otherwise
          an empty inbox would have no way back to the full spine. */}
      <Group gap="xs" wrap="nowrap">
        <QuietBadge>needs attention only</QuietBadge>
        <Anchor
          component={Link}
          href={WIRING_HREF}
          size="sm"
          data-testid="show-all-rows"
        >
          Show all
        </Anchor>
      </Group>
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
      //
      // Light scheme steps one shade past `filled` because the glyph is a 9px
      // numeral -- small text, so it wants 4.5:1, and shade 6 gives white only
      // 3.89:1. Shade 7 gives 4.82:1. Dark needs no such step: `filled` there
      // is a pale shade taking a dark glyph at 7.94:1.
      const fill =
        'light-dark(var(--mantine-color-bad-7), var(--mantine-color-bad-filled))';
      return {
        borderColor: fill,
        backgroundColor: fill,
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
  attentionOnly,
  pendingVerb,
  onPendingVerbHandled,
}: {
  pack: string;
  workType: string | null;
  attentionOnly: boolean;
  /** A verb the Health tab asked to open, by name rather than by spine key --
      Health builds its own spine from the same composition/check data but
      has no reason to know this view's internal keying. Resolved into
      `selectedKey` below and cleared once handled, so switching back to
      Pipeline without a pending verb never reopens a stale selection. */
  pendingVerb?: string | null;
  onPendingVerbHandled?: () => void;
}) {
  const { text } = useSchemeColors();
  const compositionQuery = useComposition(pack);
  const checkQuery = useSkillsCheck(pack);
  const bulletStyles = useBulletStyles();

  const spine = useMemo(
    () =>
      buildSpine(
        compositionQuery.data,
        checkQuery.data ?? { verbs: [] },
        workType
      ),
    [compositionQuery.data, checkQuery.data, workType]
  );

  // Every row the Pipeline tab can select into its panel: the orchestrator,
  // every stage, and everything outside the run order (a Used-by site can
  // point at any of the three, even one the attention filter is hiding).
  const allRows = useMemo(
    () =>
      [spine.orchestrator, ...spine.stages, ...spine.outside].filter(
        (entry): entry is SpineEntry => entry !== null
      ),
    [spine]
  );
  const selection = useSkillSelection({
    pack,
    entries: allRows,
    composition: compositionQuery.data,
    // The target row may be a healthy one the filter is hiding -- leave the
    // filter first, then scroll on the next frame once it has rendered.
    beforeShowInMap: () => {
      if (attentionOnly) navigate(WIRING_HREF);
    },
  });
  const { selectedKey, setSelectedKey, panelOpen } = selection;

  // Every roster verb gets exactly one row in every work type (see
  // `buildSpine`'s own comment on `attentionCount`), so this always finds a
  // pending verb regardless of which work type is currently selected.
  useEffect(() => {
    if (!pendingVerb) return;
    const target = spineRows(spine).find(entry => entry.verb === pendingVerb);
    if (target) setSelectedKey(target.key);
    onPendingVerbHandled?.();
  }, [pendingVerb, spine, onPendingVerbHandled, setSelectedKey]);

  // Same rows, same order, same components -- the healthy ones simply are
  // not rendered. `spine` itself stays whole: the header's count and the
  // panel's binding-site index answer about the pack, not about what is
  // currently on screen.
  const shown = attentionOnly ? onlyNeedsAttention(spine) : spine;

  const spineEntries: SpineEntry[] = [
    ...(shown.orchestrator ? [shown.orchestrator] : []),
    ...shown.stages,
  ];
  // "Nothing needs attention" is a claim about the WHOLE pack, so it reads the
  // pack-wide count -- not `spineEntries`, which only sees pipeline rows. An
  // unwired verb that drifted lives outside the pipeline (On-demand/Health),
  // and calling the compile clean while one differed would be a false all-clear.
  const nothingNeedsAttention = attentionOnly && spine.attentionCount === 0;
  // The pipeline itself is clean but attention is owed elsewhere: point there
  // rather than stranding an empty Timeline under the filter.
  const attentionElsewhere = attentionOnly && spineEntries.length === 0;

  return (
    <SkillSplitLayout
      pack={pack}
      composition={compositionQuery.data}
      bindingSites={spine.bindingSites}
      asOf={compositionQuery.dataUpdatedAt || undefined}
      selection={selection}
      left={
        <>
          {panelOpen ? (
            <Text
              fz="xs"
              fw={600}
              c={text.muted}
              px="xs"
              pb="xs"
              data-testid="compact-spine-header"
              style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}
            >
              Pipeline · {spine.stages.length}{' '}
              {spine.stages.length === 1 ? 'stage' : 'stages'}
            </Text>
          ) : (
            <>
              <SummaryStrip
                orchestrator={spine.orchestrator}
                workType={spine.workType}
                stageCount={spine.stages.length}
                health={spine.orchestrator?.health ?? 'unknown'}
                attentionCount={spine.attentionCount}
              />
              {attentionOnly && (
                <AttentionFilterNotice spine={spine} shown={shown} />
              )}

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
            </>
          )}

          {nothingNeedsAttention ? (
            // An empty inbox is a claim about a measurement, so it waits for
            // the measurement -- otherwise every filtered load flashes
            // "nothing was measured" on its way to the real answer.
            checkQuery.isPending ? (
              <Skeleton height={72} data-testid="attention-loading" />
            ) : (
              <AttentionEmptyState
                pack={pack}
                checkedVerbs={
                  checkQuery.data ? comparedVerbCount(checkQuery.data) : null
                }
              />
            )
          ) : attentionElsewhere ? (
            <Stack gap={4} py="xl" data-testid="attention-elsewhere">
              <Group gap="xs" wrap="nowrap">
                <Icons.checkCircle size={18} color={text.highContrast('ok')} />
                <Text fw={600} size="lg">
                  No pipeline stage needs attention.
                </Text>
              </Group>
              <Text size="xs" c={text.muted}>
                {spine.attentionCount}{' '}
                {spine.attentionCount === 1 ? 'skill' : 'skills'} outside the
                run order {spine.attentionCount === 1 ? 'does' : 'do'} — open
                the On-demand or Health tab to see{' '}
                {spine.attentionCount === 1 ? 'it' : 'them'}.
              </Text>
            </Stack>
          ) : (
            <>
              {!panelOpen && spine.orchestrator && (
                <Text size="xs" c={text.muted} pb="md" data-testid="spine-note">
                  The orchestrator reads the pipeline and runs each stage in
                  order. Stages compile into it, so they carry no artifact of
                  their own to check.
                </Text>
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
                      slim
                      compact={panelOpen}
                      selected={panelOpen && entry.key === selectedKey}
                      onOpen={() => setSelectedKey(entry.key)}
                    />
                  </Timeline.Item>
                ))}
              </Timeline>
            </>
          )}
        </>
      }
    />
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
  const attentionOnly = isAttentionOnly(useSearch());
  const [explicitPack, setExplicitPack] = useState<string | null>(null);
  const [explicitWorkType, setExplicitWorkType] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    'pipeline' | 'ondemand' | 'surface' | 'health'
  >('pipeline');
  // Health rows open a skill on the Pipeline tab's own panel rather than a
  // second one -- see `WiringSpineView`'s `pendingVerb` prop.
  const [pendingVerb, setPendingVerb] = useState<string | null>(null);
  const openSkillFromHealth = (verb: string) => {
    setActiveTab('pipeline');
    setPendingVerb(verb);
  };
  const attentionCount = useAttentionCount();

  const packs = packsQuery.data?.packs ?? [];
  const pack = explicitPack ?? packs[0]?.name ?? null;
  const packDir = packs.find(p => p.name === pack)?.dir ?? null;

  const snapshot = useCompositionSnapshot(pack);
  const workTypes = useMemo(
    () => Object.keys(snapshot.data?.pipelines ?? {}),
    [snapshot.data]
  );
  const workType =
    explicitWorkType && workTypes.includes(explicitWorkType)
      ? explicitWorkType
      : (workTypes[0] ?? null);

  // No pack means nothing for a tab to show yet -- the same gate the pack
  // picker and Surface action already used.
  const tabs: PageShellTab[] = pack
    ? [
        {
          id: 'pipeline',
          label: 'Pipeline',
          icon: 'zap',
          active: activeTab === 'pipeline',
          onClick: () => setActiveTab('pipeline'),
        },
        {
          id: 'ondemand',
          label: 'On-demand',
          icon: 'terminal',
          active: activeTab === 'ondemand',
          onClick: () => setActiveTab('ondemand'),
        },
        {
          id: 'surface',
          label: 'Surface',
          icon: 'layers',
          active: activeTab === 'surface',
          onClick: () => setActiveTab('surface'),
        },
        {
          id: 'health',
          label: 'Health',
          labelComponent: (
            <Group gap={4} wrap="nowrap">
              <span>Health</span>
              {attentionCount > 0 && (
                <Badge
                  size="xs"
                  variant="light"
                  // Main.dc.html `.tab.active .cnt.warn`: the amber tint is
                  // scoped to the active tab -- an inactive tab's count
                  // stays neutral so warn-orange doesn't bleed onto chrome
                  // that isn't Health.
                  color={activeTab === 'health' ? 'warn' : 'gray'}
                  radius="xl"
                  data-testid="health-tab-count"
                >
                  {attentionCount}
                </Badge>
              )}
            </Group>
          ),
          icon: 'checkCircle',
          active: activeTab === 'health',
          onClick: () => setActiveTab('health'),
        },
      ]
    : [];

  return (
    <PageShell
      title="Wiring"
      tabs={tabs}
      actions={
        <Group gap="sm" wrap="nowrap">
          <CommandProvenance
            command="rt skills composition"
            asOf={snapshot.dataUpdatedAt || undefined}
          />
          {packDir && (
            <Button
              size="xs"
              variant="default"
              component="a"
              href={`vscode://file${packDir}`}
              leftSection={<Icons.package size={14} />}
              data-testid="open-pack"
            >
              Open pack
            </Button>
          )}
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
        <>
          {activeTab === 'pipeline' && (
            <WiringErrorBoundary key={pack}>
              <LazyLoader>
                <WiringSpineView
                  pack={pack}
                  workType={workType}
                  attentionOnly={attentionOnly}
                  pendingVerb={pendingVerb}
                  onPendingVerbHandled={() => setPendingVerb(null)}
                />
              </LazyLoader>
            </WiringErrorBoundary>
          )}
          {activeTab === 'ondemand' && (
            <WiringErrorBoundary key={pack}>
              <LazyLoader>
                <OnDemandView
                  pack={pack}
                  workType={workType}
                  onGoToHealth={() => setActiveTab('health')}
                />
              </LazyLoader>
            </WiringErrorBoundary>
          )}
          {activeTab === 'surface' && <SurfaceTab pack={pack} />}
          {activeTab === 'health' && (
            <HealthTab pack={pack} onOpenSkill={openSkillFromHealth} />
          )}
        </>
      )}
    </PageShell>
  );
}
