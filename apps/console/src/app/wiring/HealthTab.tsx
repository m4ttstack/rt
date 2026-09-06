import type { KeyboardEvent, ReactNode } from 'react';
import { useMemo } from 'react';
import {
  Badge,
  GenericError,
  Group,
  Paper,
  Skeleton,
  Stack,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import type { MantineColor } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';

import {
  buildSpine,
  spineRows,
  suffixOf,
  type OrphanFillEntry,
  type SpineEntry,
  type WiringSpine,
} from './outline';
import { QuietBadge } from './QuietBadge';
import { SOFT_RULE } from './SlotRow';
import { useCompositionSnapshot, useSkillsCheck } from './useWiring';

export interface HealthTabProps {
  pack: string;
  onOpenSkill?: (verb: string) => void;
}

/**
 * `check` and the binder graph answer two independent questions -- "did the
 * source drift" and "does anything bind this" -- so a verb can land in both
 * `staleEntries`/`neverCompiledEntries` AND `unwiredEntries` at once. The
 * stat cards and groups below never dedupe across that overlap on purpose;
 * `Health.dc.html`'s sample data just never has one.
 */
function computeHealthGroups(spine: WiringSpine) {
  const all = spineRows(spine);
  const staleEntries = all.filter(entry => entry.health === 'source-newer');
  const neverCompiledEntries = all.filter(
    entry => entry.health === 'never-compiled'
  );
  const unwiredEntries = spine.outside.filter(entry => entry.unwired);

  return {
    inSyncCount: all.filter(entry => entry.health === 'in-sync').length,
    staleEntries,
    neverCompiledEntries,
    unwiredEntries,
    // Fills nothing binds. Grouped WITH the unwired verbs below: both are
    // "nothing binds this, safe to prune", and the On-demand tab's pointer
    // counts the two together, so Health has to list the two together or the
    // count it points at would be a claim about rows that were never shown.
    orphanFills: spine.orphans,
  };
}

/** `check` reports which files it found stale, never a timestamp -- the
    design mock's "source 2h newer than artifact" wording is not derivable
    from what rt actually sends, so the honest version states the count. */
function issueWhy(entry: SpineEntry): string {
  const n = entry.staleFiles.length;
  if (n > 0) return n === 1 ? '1 stale file' : `${n} stale files`;
  return entry.health === 'never-compiled'
    ? 'no artifact on disk yet'
    : 'source newer than artifact';
}

function unwiredWhy(entry: SpineEntry): string {
  const n = entry.slots.length;
  const slotPart = n === 0 ? 'no slots' : n === 1 ? '1 slot' : `${n} slots`;
  return `${slotPart} · nothing binds it`;
}

function orphanWhy(orphan: OrphanFillEntry): string {
  return orphan.registered
    ? 'fill · nothing binds it'
    : 'unregistered fill · nothing binds it';
}

function slugify(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '-');
}

interface StatCardProps {
  count: number;
  label: string;
  /** `null` renders the quiet/uncolored stat (Unwired) -- the same
      dot-or-nothing fallback `HealthDot`/`HealthChip` already use for a
      state with no assigned intent color. */
  color: MantineColor | null;
}

function StatCard({ count, label, color }: StatCardProps) {
  const { bg, text, border } = useSchemeColors();
  const tone = color ? text.highContrast(color) : text.muted;

  return (
    <Paper
      bg={bg.level2}
      radius="xl"
      // Health.dc.html `.stat` padding (15px 16px) has no matching spacing
      // step at this theme's scale.
      style={{ border: `1px solid ${border.default}`, padding: '15px 16px' }}
      data-testid={`health-stat-${slugify(label)}`}
    >
      <Text fz={26} fw={700} lh={1} c={tone}>
        {count}
      </Text>
      <Group gap={7} align="center" wrap="nowrap" mt={8}>
        <div
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            flex: 'none',
            background: tone,
          }}
        />
        <Text fz={11} c={text.muted}>
          {label}
        </Text>
      </Group>
    </Paper>
  );
}

interface HealthIssueRowProps {
  testId: string;
  name: string;
  reference: string | null;
  why: string;
  /** A verb row opens its detail panel; an orphan FILL has no panel to open,
      so it renders as a plain, non-interactive line (no button, no chevron). */
  onOpen?: () => void;
  /** Only the recompile/never-compiled groups offer this -- Unwired rows
      have nothing to preview compiling. */
  onPreviewCompile?: () => void;
}

function HealthIssueRow({
  testId,
  name,
  reference,
  why,
  onOpen,
  onPreviewCompile,
}: HealthIssueRowProps) {
  const { bg, text, border } = useSchemeColors();

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onOpen) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen();
    }
  };

  return (
    <Group
      gap={11}
      align="center"
      wrap="nowrap"
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={onOpen ? handleKeyDown : undefined}
      aria-label={onOpen ? `open ${name}` : undefined}
      style={{ padding: '11px 16px', cursor: onOpen ? 'pointer' : 'default' }}
      data-testid={`health-row-${testId}`}
    >
      <Text fz={13} fw={700} style={{ flex: 'none' }}>
        {name}
      </Text>
      {reference && (
        <Text fz={11} c={text.muted} truncate style={{ flex: 'none' }}>
          {reference}
        </Text>
      )}
      <div style={{ flex: 1, minWidth: 0 }} />
      <Text
        fz={11}
        c={text.muted}
        truncate
        style={{ flex: 'none', maxWidth: 260 }}
      >
        {why}
      </Text>
      {onPreviewCompile && (
        <UnstyledButton
          type="button"
          onClick={event => {
            event.stopPropagation();
            onPreviewCompile();
          }}
          data-testid={`health-preview-compile-${testId}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 26,
            padding: '0 10px',
            border: `1px solid ${border.default}`,
            borderRadius: 7,
            background: bg.level3,
            fontSize: 11,
            flex: 'none',
          }}
        >
          <Icons.zap size={13} color={text.muted} aria-hidden />
          Preview compile
        </UnstyledButton>
      )}
      {onOpen && (
        <Icons.chevronRight
          size={16}
          color={text.muted}
          aria-hidden
          style={{ flex: 'none' }}
        />
      )}
    </Group>
  );
}

interface HealthGroupCardProps<T> {
  title: string;
  /** `null` renders the neutral pill (Unwired, informational) via
      `QuietBadge` instead of a tinted `Badge`. */
  intent: MantineColor | null;
  caption: string;
  entries: T[];
  getKey: (entry: T) => string;
  renderRow: (entry: T) => ReactNode;
}

function HealthGroupCard<T>({
  title,
  intent,
  caption,
  entries,
  getKey,
  renderRow,
}: HealthGroupCardProps<T>) {
  const { bg, text, border } = useSchemeColors();
  const dotColor = intent ? text.highContrast(intent) : text.muted;

  return (
    <Paper
      bg={bg.level2}
      radius="xl"
      style={{ border: `1px solid ${border.default}`, overflow: 'hidden' }}
      data-testid={`health-group-${slugify(title)}`}
    >
      <Group
        gap={9}
        align="center"
        wrap="nowrap"
        bg={bg.level3}
        // Health.dc.html `.grouphead` padding (13px 16px) has no matching
        // spacing step at this theme's scale.
        style={{ padding: '13px 16px', borderBottom: `1px solid ${SOFT_RULE}` }}
      >
        <div
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            flex: 'none',
            background: dotColor,
          }}
        />
        <Text fz={12.5} fw={700} style={{ flex: 'none' }}>
          {title}
        </Text>
        {intent ? (
          <Badge
            size="xs"
            variant="light"
            color={intent}
            radius="xl"
            style={{ flex: 'none' }}
            data-testid={`health-group-count-${slugify(title)}`}
          >
            {entries.length}
          </Badge>
        ) : (
          <QuietBadge>{entries.length}</QuietBadge>
        )}
        <div style={{ flex: 1 }} />
        <Text fz={11} c={text.muted} style={{ flex: 'none' }}>
          {caption}
        </Text>
      </Group>
      <Stack gap={0}>
        {entries.map((entry, i) => (
          <div
            key={getKey(entry)}
            style={
              i === 0 ? undefined : { borderTop: `1px solid ${SOFT_RULE}` }
            }
          >
            {renderRow(entry)}
          </div>
        ))}
      </Stack>
    </Paper>
  );
}

/**
 * `rt skills check` grouped: four stat cards, then the same drift split
 * three ways -- stale, never compiled, and (from the binder graph rather
 * than `check`) unwired. Fetches its own data, same as `SurfaceTab`: being
 * the active tab IS the fetch trigger.
 */
export function HealthTab({ pack, onOpenSkill }: HealthTabProps) {
  const { bg, text, border } = useSchemeColors();
  const compositionQuery = useCompositionSnapshot(pack);
  const checkQuery = useSkillsCheck(pack);

  // Both inputs are required: buildSpine with an empty check would report
  // every verb as healthy, so a failed or pending `check` must NOT produce
  // stat cards -- it stays null until real health data lands.
  const spine = useMemo(
    () =>
      compositionQuery.data && checkQuery.data
        ? buildSpine(compositionQuery.data, checkQuery.data, null)
        : null,
    [compositionQuery.data, checkQuery.data]
  );
  const groups = useMemo(
    () => (spine ? computeHealthGroups(spine) : null),
    [spine]
  );

  if (compositionQuery.isError) {
    return (
      <GenericError
        title="Couldn't load this pack's composition"
        message={(compositionQuery.error as Error).message}
        onRetry={() => void compositionQuery.refetch()}
      />
    );
  }

  if (checkQuery.isError) {
    return (
      <GenericError
        title="Couldn't measure this pack's health"
        message={(checkQuery.error as Error).message}
        onRetry={() => void checkQuery.refetch()}
      />
    );
  }

  if (!groups) {
    return <Skeleton height={220} data-testid="health-tab-loading" />;
  }

  const openSkill = (verb: string | null) => {
    if (verb) onOpenSkill?.(verb);
  };

  // Unwired verbs and orphan fills share one group: both are "nothing binds
  // this". Verb rows open their detail panel; orphan-fill rows are inert (no
  // panel exists for a fill).
  const unwiredRows = [
    ...groups.unwiredEntries.map(entry => ({
      kind: 'verb' as const,
      key: entry.key,
      entry,
    })),
    ...groups.orphanFills.map(orphan => ({
      kind: 'orphan' as const,
      key: `orphan:${orphan.fill}`,
      orphan,
    })),
  ];

  const clean =
    groups.staleEntries.length === 0 &&
    groups.neverCompiledEntries.length === 0 &&
    unwiredRows.length === 0;

  return (
    <Stack gap={0} data-testid="health-tab">
      <div
        // Health.dc.html `.stats` gap (14px) has no matching spacing step.
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0,1fr))',
          gap: 14,
        }}
        data-testid="health-stats"
      >
        <StatCard count={groups.inSyncCount} label="In sync" color="ok" />
        <StatCard
          count={groups.staleEntries.length}
          label="Source newer"
          color="warn"
        />
        <StatCard
          count={groups.neverCompiledEntries.length}
          label="Never compiled"
          color="bad"
        />
        <StatCard count={unwiredRows.length} label="Unwired" color={null} />
      </div>

      <div style={{ marginTop: 18 }}>
        {clean ? (
          <Paper
            bg={bg.level2}
            radius="xl"
            p="xl"
            style={{ border: `1px solid ${border.default}` }}
            data-testid="health-empty"
          >
            <Group gap="xs" wrap="nowrap">
              <Icons.checkCircle size={18} color={text.highContrast('ok')} />
              <Text fw={600} size="lg" c={text.highContrast('ok')}>
                All in sync.
              </Text>
            </Group>
            <Text size="xs" c={text.muted} mt={4}>
              Every roster verb in {pack} compiled fresh and every internal
              skill is bound by something in the pack.
            </Text>
          </Paper>
        ) : (
          <Stack gap={14}>
            {groups.staleEntries.length > 0 && (
              <HealthGroupCard
                title="Recompile needed"
                intent="warn"
                caption="source edited since the artifact was last built"
                entries={groups.staleEntries}
                getKey={entry => entry.key}
                renderRow={entry => (
                  <HealthIssueRow
                    testId={entry.key}
                    name={entry.label}
                    reference={entry.ref}
                    why={issueWhy(entry)}
                    onOpen={() => openSkill(entry.verb)}
                    onPreviewCompile={() => openSkill(entry.verb)}
                  />
                )}
              />
            )}

            {groups.neverCompiledEntries.length > 0 && (
              <HealthGroupCard
                title="Never compiled"
                intent="bad"
                caption="wired into a verb but has no built artifact yet"
                entries={groups.neverCompiledEntries}
                getKey={entry => entry.key}
                renderRow={entry => (
                  <HealthIssueRow
                    testId={entry.key}
                    name={entry.label}
                    reference={entry.ref}
                    why={issueWhy(entry)}
                    onOpen={() => openSkill(entry.verb)}
                    onPreviewCompile={() => openSkill(entry.verb)}
                  />
                )}
              />
            )}

            {unwiredRows.length > 0 && (
              <HealthGroupCard
                title="Unwired"
                intent={null}
                caption="skills and fills nothing in the roster binds (safe to keep or prune)"
                entries={unwiredRows}
                getKey={row => row.key}
                renderRow={row =>
                  row.kind === 'verb' ? (
                    <HealthIssueRow
                      testId={row.entry.key}
                      name={row.entry.label}
                      reference={row.entry.ref}
                      why={unwiredWhy(row.entry)}
                      onOpen={() => openSkill(row.entry.verb)}
                    />
                  ) : (
                    <HealthIssueRow
                      testId={`orphan-${row.orphan.fill}`}
                      name={suffixOf(row.orphan.fill)}
                      reference={row.orphan.provides}
                      why={orphanWhy(row.orphan)}
                    />
                  )
                }
              />
            )}
          </Stack>
        )}
      </div>
    </Stack>
  );
}
