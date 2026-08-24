import { Component, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import {
  Alert,
  Anchor,
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
  UnstyledButton,
} from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import { Link } from '../router/Link';
import { navigate, useSearch } from '../router/navigation';
import { CommandProvenance } from '../runs/CommandProvenance';
import { AttentionEmptyState } from './AttentionEmptyState';
import {
  comparedVerbCount,
  isAttentionOnly,
  onlyNeedsAttention,
  WIRING_ATTENTION_HREF,
  WIRING_HREF,
} from './attentionFilter';
import { CompileDrawer } from './CompileDrawer';
import { InverseIndex } from './InverseIndex';
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
import { QuietBadge } from './QuietBadge';
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

function OrphanFillRow({
  node,
  onShowSites,
}: {
  node: OrphanFillEntry;
  onShowSites: (binding: string) => void;
}) {
  const { text } = useSchemeColors();

  return (
    <Stack gap={1} data-testid={`orphan-fill-${node.fill}`}>
      <UnstyledButton
        onClick={() => onShowSites(node.fill)}
        aria-label={`what binds ${node.fill}`}
        data-testid="open-inverse-index"
      >
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
      </UnstyledButton>
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
  onShowSites,
}: {
  spine: WiringSpine;
  previewVerb: string | null;
  onPreview: (entry: SpineEntry) => void;
  onShowSites: (binding: string) => void;
}) {
  const { text } = useSchemeColors();

  return (
    <Stack gap="sm" mt="sm" data-testid="outside-the-pipeline">
      <Text size="xs" c={text.muted}>
        Skills the pipeline never calls — you invoke these directly, or another
        plugin does. No order to run in.
      </Text>
      {spine.outside.map(entry => (
        <SkillRow
          key={entry.key}
          entry={entry}
          withDot
          previewOpen={previewVerb === entry.verb}
          onPreview={() => onPreview(entry)}
          onShowSites={onShowSites}
        />
      ))}
      {spine.orphans.map(node => (
        <OrphanFillRow key={node.fill} node={node} onShowSites={onShowSites} />
      ))}
    </Stack>
  );
}

/**
 * The panel's header. While the filter is on it describes the rows actually
 * rendered, not the pack -- a "8 stages" claim over a spine drawing none is
 * the summary and the list disagreeing about the same set. The stages are
 * still named, and named as HIDDEN rather than dropped, because the reason
 * they never survive the filter is a fact about what `check` covers, not the
 * pipeline going away.
 */
function SpineSummary({
  spine,
  shown,
  attentionOnly,
}: {
  spine: WiringSpine;
  shown: WiringSpine;
  attentionOnly: boolean;
}) {
  const { text } = useSchemeColors();
  const hiddenStages = spine.stages.length - shown.stages.length;

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
      {attentionOnly ? (
        <>
          <Text size="sm" c={text.muted} data-testid="shown-of-total">
            showing {spineRows(shown).length} of {spineRows(spine).length} rows
          </Text>
          {hiddenStages > 0 && (
            <>
              <Text size="sm" c={text.muted}>
                ·
              </Text>
              {/* Deliberately shorter than the unfiltered caveat beside it:
                  the filtered header also carries the row count and two
                  controls, and at 1440 the longer wording truncated
                  mid-sentence -- which loses the reason and leaves the
                  stages looking dropped. */}
              <Text size="xs" c={text.muted} truncate>
                {hiddenStages} stages hidden — check covers no artifact of a
                stage to flag
              </Text>
            </>
          )}
        </>
      ) : (
        <>
          <Text size="sm" c={text.muted}>
            {spine.stages.length} stages
          </Text>
          {spine.stages.length > 0 && (
            <>
              <Text size="sm" c={text.muted}>
                ·
              </Text>
              <Text size="xs" c={text.muted} truncate>
                stages compile into the orchestrator, so they carry no artifact
                of their own to check
              </Text>
            </>
          )}
        </>
      )}
      <div style={{ flex: 1 }} />
      {attentionOnly ? (
        // Always offered while filtered, including at zero rows -- otherwise
        // an empty inbox would have no way back to the full spine.
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
      ) : (
        spine.attentionCount > 0 && (
          <Badge
            component={Link}
            href={WIRING_ATTENTION_HREF}
            size="sm"
            variant="light"
            color="warn"
            style={{ cursor: 'pointer' }}
            data-testid="attention-count"
          >
            {spine.attentionCount} need attention
          </Badge>
        )
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
}: {
  pack: string;
  workType: string | null;
  attentionOnly: boolean;
}) {
  const { bg, text, border } = useSchemeColors();
  const compositionQuery = useComposition(pack);
  const checkQuery = useSkillsCheck(pack);
  const bulletStyles = useBulletStyles();
  const [preview, setPreview] = useState<{
    verb: string;
    changedFiles: string[];
  } | null>(null);
  const [indexFill, setIndexFill] = useState<string | null>(null);

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

  // Same rows, same order, same components -- the healthy ones simply are
  // not rendered. `spine` itself stays whole: the header's count, the
  // binding-site index and the drawers all answer about the pack, not about
  // what is currently on screen.
  const shown = attentionOnly ? onlyNeedsAttention(spine) : spine;

  const spineEntries: SpineEntry[] = [
    ...(shown.orchestrator ? [shown.orchestrator] : []),
    ...shown.stages,
  ];
  const showOutside = !attentionOnly || shown.outside.length > 0;
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

  return (
    <Paper
      bg={bg.level2}
      p="xl"
      radius="md"
      style={{ border: `1px solid ${border.default}` }}
      data-testid="wiring-spine"
    >
      <SpineSummary spine={spine} shown={shown} attentionOnly={attentionOnly} />

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
                onShowSites={setIndexFill}
              />
            </Timeline.Item>
          ))}

          {showOutside && (
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
                spine={shown}
                previewVerb={preview?.verb ?? null}
                onPreview={openPreview}
                onShowSites={setIndexFill}
              />
            </Timeline.Item>
          )}
        </Timeline>
      )}

      {!attentionOnly &&
        spine.outside.length === 0 &&
        spine.orphans.length === 0 && (
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

      <InverseIndex
        pack={pack}
        fill={indexFill}
        sites={indexFill ? (spine.bindingSites[indexFill] ?? []) : []}
        sourcePath={
          compositionQuery.data.fills.find(f => f.binding === indexFill)
            ?.sourcePath ?? null
        }
        asOf={compositionQuery.dataUpdatedAt || undefined}
        onShowInMap={site => {
          const key = rowKeyFor(site);
          setIndexFill(null);
          if (!key) return;
          // The target row is usually a healthy one, which the filter is
          // hiding -- so leave the filter before looking for it, and look on
          // the next frame, once that navigation has rendered.
          if (attentionOnly) navigate(WIRING_HREF);
          requestAnimationFrame(() =>
            document
              .querySelector(`[data-testid="skill-row-${key}"]`)
              ?.scrollIntoView?.({ block: 'center' })
          );
        }}
        onClose={() => setIndexFill(null)}
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
  const attentionOnly = isAttentionOnly(useSearch());
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
            <WiringSpineView
              pack={pack}
              workType={workType}
              attentionOnly={attentionOnly}
            />
          </LazyLoader>
        </WiringErrorBoundary>
      )}
    </PageShell>
  );
}
