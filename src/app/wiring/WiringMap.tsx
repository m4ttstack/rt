import { Component, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  Alert,
  Anchor,
  Badge,
  Collapse,
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
  UnstyledButton,
} from '@ui/core';
import type { PageShellTab } from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { AnimatedChevron, Icons } from '@ui/icons';
import { notifications } from '@ui/notifications';
import { Link } from '../router/Link';
import { navigate, useSearch } from '../router/navigation';
import { CommandProvenance } from '../runs/CommandProvenance';
import { buildAgentContext } from './agentContext';
import { AttentionEmptyState } from './AttentionEmptyState';
import {
  comparedVerbCount,
  isAttentionOnly,
  onlyNeedsAttention,
  WIRING_HREF,
} from './attentionFilter';
import { HEALTH_COLOR } from './HealthChip';
import { HealthTab } from './HealthTab';
import {
  buildSpine,
  pluginOf,
  spineRows,
  suffixOf,
  type BindingSite,
  type OrphanFillEntry,
  type SpineEntry,
  type WiringHealth,
  type WiringSpine,
} from './outline';
import { splitCompiledBody } from './parseSeam';
import { QuietBadge } from './QuietBadge';
import { SkillDetailPanel } from './SkillDetailPanel';
import { SkillRow } from './SkillRow';
import { SummaryStrip } from './SummaryStrip';
import { SurfaceTab } from './SurfaceTab';
import {
  fetchCompilePreview,
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
 * A fill nothing binds. Now that the inverse index lives in the detail panel's
 * Used-by tab (and a fill has no panel of its own), the row states the whole
 * answer inline rather than opening a drawer onto "bound by nothing".
 */
function OrphanFillRow({ node }: { node: OrphanFillEntry }) {
  const { text } = useSchemeColors();

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
          {suffixOf(node.fill)}
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
 * Collapsed by default: this list answers "what's outside the run order?",
 * a question most visits to the page never ask.
 */
function OutsideThePipeline({
  spine,
  onOpen,
  compact = false,
  selectedKey = null,
}: {
  spine: WiringSpine;
  onOpen: (entry: SpineEntry) => void;
  /** The split view's compact left column: rows shrink to the mini shape and
      the verbose orphan-fill rows drop out (they open no panel to navigate to). */
  compact?: boolean;
  selectedKey?: string | null;
}) {
  const { text } = useSchemeColors();
  const [opened, setOpened] = useState(false);

  // `external` groups are already one row per OTHER plugin (see
  // `buildSpine`'s `externalGroups`), so this length IS the plugin count --
  // no separate dedupe needed.
  const externalCount = spine.outside.filter(entry => entry.external).length;
  const unwiredCount = spine.outside.filter(entry => entry.unwired).length;

  return (
    <Stack gap={0} mt="sm" data-testid="outside-the-pipeline">
      <UnstyledButton
        onClick={() => setOpened(current => !current)}
        aria-expanded={opened}
        aria-label="toggle not run by this pipeline"
        data-testid="offpipe-toggle"
        style={{ width: '100%' }}
      >
        <Group gap="sm" wrap="nowrap" py="sm">
          <AnimatedChevron
            size={16}
            opened={opened}
            color={text.muted}
            aria-hidden
            style={{ flex: 'none' }}
          />
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text fw={700} size="sm">
              Not run by this pipeline
            </Text>
            <Text size="xs" c={text.muted}>
              {spine.outside.length} skills you invoke directly, plus fills
              another plugin binds. No run order.
            </Text>
          </Stack>
          <Group gap="xs" wrap="nowrap">
            {externalCount > 0 && (
              <Badge
                size="sm"
                variant="light"
                color="purple"
                data-testid="offpipe-external-count"
              >
                {externalCount} other plugin
              </Badge>
            )}
            {unwiredCount > 0 && (
              <Badge
                size="sm"
                variant="light"
                color="bad"
                data-testid="offpipe-unwired-count"
              >
                {unwiredCount} unwired
              </Badge>
            )}
          </Group>
        </Group>
      </UnstyledButton>
      <Collapse expanded={opened} data-testid="offpipe-body">
        <Stack gap={compact ? 2 : 'sm'} pt="xs">
          {spine.outside.map(entry => (
            <SkillRow
              key={entry.key}
              entry={entry}
              slim
              compact={compact}
              selected={compact && entry.key === selectedKey}
              onOpen={() => onOpen(entry)}
            />
          ))}
          {!compact &&
            spine.orphans.map(node => (
              <OrphanFillRow key={node.fill} node={node} />
            ))}
        </Stack>
      </Collapse>
    </Stack>
  );
}

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
        showing {spineRows(shown).length} of {spineRows(spine).length} rows
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
  const { bg, text, border } = useSchemeColors();
  const queryClient = useQueryClient();
  const compositionQuery = useComposition(pack);
  const checkQuery = useSkillsCheck(pack);
  const bulletStyles = useBulletStyles();
  // The panel keys on the ref, not a snapshot: a rebind or surface change
  // refetches the composition and rebuilds the spine, and the panel has to
  // read the fresh entry rather than the one captured when the row was clicked.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const spine = useMemo(
    () =>
      buildSpine(
        compositionQuery.data,
        checkQuery.data ?? { verbs: [] },
        workType
      ),
    [compositionQuery.data, checkQuery.data, workType]
  );

  // Every roster verb gets exactly one row in every work type (see
  // `buildSpine`'s own comment on `attentionCount`), so this always finds a
  // pending verb regardless of which work type is currently selected.
  useEffect(() => {
    if (!pendingVerb) return;
    const target = spineRows(spine).find(entry => entry.verb === pendingVerb);
    if (target) setSelectedKey(target.key);
    onPendingVerbHandled?.();
  }, [pendingVerb, spine, onPendingVerbHandled]);

  // Fetches the compiled preview on demand and reads its seams the same way
  // `CompiledView` does, so the copied blob and the panel's own reading of
  // this verb's seams can never disagree.
  const copyAgentContext = async (entry: SpineEntry) => {
    if (!entry.verb) return;
    const verbEntry = compositionQuery.data.verbs.find(
      v => v.name === entry.verb
    );
    if (!verbEntry) return;
    try {
      const preview = await fetchCompilePreview(queryClient, pack, entry.verb);
      const seams = splitCompiledBody(preview.content).map(
        section => section.seam
      );
      await navigator.clipboard.writeText(
        buildAgentContext({ verb: verbEntry, seams })
      );
      notifications.success('Copied agent context');
    } catch (err) {
      notifications.error(
        `Could not copy agent context: ${(err as Error).message}`
      );
    }
  };

  // Same rows, same order, same components -- the healthy ones simply are
  // not rendered. `spine` itself stays whole: the header's count and the
  // panel's binding-site index answer about the pack, not about what is
  // currently on screen.
  const shown = attentionOnly ? onlyNeedsAttention(spine) : spine;

  const spineEntries: SpineEntry[] = [
    ...(shown.orchestrator ? [shown.orchestrator] : []),
    ...shown.stages,
  ];
  // Resolved from the whole spine, never `shown`: the attention filter can
  // hide the selected row while its panel stays open and correct.
  const selectedEntry =
    selectedKey !== null
      ? (spineRows(spine).find(entry => entry.key === selectedKey) ?? null)
      : null;
  const panelOpen = selectedEntry !== null;
  // Only render the section when it has something in it: in the normal view an
  // empty section would otherwise draw its "0" header next to the
  // "Nothing outside the pipeline" empty-state below. Attention mode never
  // shows orphans, so it keys on the filtered outside list alone.
  const showOutside = attentionOnly
    ? shown.outside.length > 0
    : spine.outside.length > 0 || spine.orphans.length > 0;
  const nothingNeedsAttention =
    attentionOnly && spineEntries.length === 0 && shown.outside.length === 0;

  // A cross-plugin binder has no row of its own: it is one line inside its
  // plugin's grouped row, keyed by the plugin rather than the ref.
  const rowKeys = useMemo(
    () =>
      new Set(
        [spine.orchestrator, ...spine.stages, ...spine.outside]
          .filter((entry): entry is SpineEntry => entry !== null)
          .map(entry => entry.key)
      ),
    [spine]
  );
  const rowKeyFor = (site: BindingSite): string | null => {
    if (rowKeys.has(site.ref)) return site.ref;
    const grouped = `external:${pluginOf(site.ref)}`;
    return rowKeys.has(grouped) ? grouped : null;
  };

  // The Used-by tab's "show in map" jumps the split view to that site's own
  // skill. A cross-plugin binder rides in its grouped row, so resolve the ref
  // to whatever key actually owns a row before selecting it.
  const showInMap = (site: BindingSite) => {
    const key = rowKeyFor(site);
    if (!key) return;
    // The target row may be a healthy one the filter is hiding -- leave the
    // filter first, then scroll on the next frame once it has rendered.
    if (attentionOnly) navigate(WIRING_HREF);
    setSelectedKey(key);
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-testid="skill-row-${key}"]`)
        ?.scrollIntoView?.({ block: 'center' })
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        // Detail.dc.html: 18px gutter between the spine and the panel (= xxl).
        gap: 'var(--mantine-spacing-xxl)',
      }}
      data-testid="wiring-split"
    >
      <Paper
        bg={bg.level2}
        p={panelOpen ? 'md' : 'xl'}
        radius="xl"
        style={{
          // Detail.dc.html: the condensed left column is a fixed 400px rail
          // once the panel is open; full-width otherwise.
          flex: panelOpen ? '0 0 400px' : '1 1 0',
          minWidth: 0,
          border: `1px solid ${border.default}`,
        }}
        data-testid="wiring-spine"
      >
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
          // An empty inbox is a claim about a measurement, so it waits for the
          // measurement -- otherwise every filtered load flashes "nothing was
          // measured" on its way to the real answer.
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

              {showOutside && (
                <Timeline.Item
                  bullet={<Icons.link size={12} />}
                  styles={{ itemBullet: bulletStyles('unknown') }}
                  data-testid="timeline-item-outside"
                >
                  <OutsideThePipeline
                    spine={shown}
                    compact={panelOpen}
                    selectedKey={selectedKey}
                    onOpen={entry => setSelectedKey(entry.key)}
                  />
                </Timeline.Item>
              )}
            </Timeline>
          </>
        )}

        {!panelOpen &&
          !attentionOnly &&
          spine.outside.length === 0 &&
          spine.orphans.length === 0 && (
            <Text size="xs" c={text.dimmed}>
              Nothing outside the pipeline: every binder in this pack is a
              stage.
            </Text>
          )}
      </Paper>

      {selectedEntry && (
        <div style={{ flex: '1 1 0', minWidth: 0 }}>
          <SkillDetailPanel
            key={selectedEntry.key}
            pack={pack}
            entry={selectedEntry}
            composition={compositionQuery.data}
            bindingSites={spine.bindingSites}
            asOf={compositionQuery.dataUpdatedAt || undefined}
            onClose={() => setSelectedKey(null)}
            onCopyContext={() => void copyAgentContext(selectedEntry)}
            onShowInMap={showInMap}
          />
        </div>
      )}
    </div>
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
  const [activeTab, setActiveTab] = useState<'pipeline' | 'surface' | 'health'>(
    'pipeline'
  );
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
          {activeTab === 'surface' && <SurfaceTab pack={pack} />}
          {activeTab === 'health' && (
            <HealthTab pack={pack} onOpenSkill={openSkillFromHealth} />
          )}
        </>
      )}
    </PageShell>
  );
}
