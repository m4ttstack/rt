import { Component, useEffect } from 'react';
import type { ReactNode } from 'react';
import {
  Anchor,
  Button,
  CopyActionIcon,
  GenericError,
  Group,
  Kbd,
  LazyLoader,
  PageShell,
  Paper,
  Stack,
  Tabs,
  Text,
} from '@mattstack/app-kit/core';
import {
  useClipboard,
  useHotkeys,
  useSchemeColors,
} from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import { modals } from '@mattstack/app-kit/modals';
import { notifications } from '@mattstack/app-kit/notifications';
import type { RunFieldRow, RunSummary } from '@mattstack/rt-client';
import { useQueryClient } from '@tanstack/react-query';

import { client } from '../api';
import { PAGE_ROW_HEIGHT } from '../chrome';
import { CommandProvenance } from './CommandProvenance';
import { EffectiveInputs } from './EffectiveInputs';
import { LivenessChip, livenessSpec, Pill } from './LivenessChip';
import { repoLabel } from './repoLabel';
import { fieldsByKey, RunContext, Timeline } from './Timeline';
import { useMarkSeen, useRun, useRunEvents, useRunsEnrich } from './useRuns';

function formatLocalTime(ms: number): string {
  return new Date(ms).toLocaleTimeString();
}

/** Same open/closed-range breakdown the board row's elapsed label uses:
    minutes under an hour, hours+minutes under a day, else days+hours. */
function formatDuration(
  startedAt: number,
  endedAt: number | null,
  now: number = Date.now()
): string {
  const ms = Math.max(0, (endedAt ?? now) - startedAt);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function formatAgo(at: number, now: number = Date.now()): string {
  return `${formatDuration(at, null, now)} ago`;
}

interface HotkeyFieldSpec {
  key: string;
  label: string;
  hotkey: string;
}

// Order fixes the hotkey each field answers to -- t/b/w/m/c, no modifier.
const HOTKEY_FIELDS: HotkeyFieldSpec[] = [
  { key: 'ticket', label: 'Ticket', hotkey: 't' },
  { key: 'branch', label: 'Branch', hotkey: 'b' },
  { key: 'worktree', label: 'Worktree', hotkey: 'w' },
  { key: 'mr', label: 'MR', hotkey: 'm' },
  { key: 'commits', label: 'Commits', hotkey: 'c' },
];

function AbandonAction({ repo, runId }: { repo: string; runId: string }) {
  const queryClient = useQueryClient();

  return (
    <Button
      size="xs"
      color="bad"
      variant="light"
      leftSection={<Icons.warning size={16} />}
      onClick={() =>
        modals.prompt({
          title: 'Mark run abandoned',
          message:
            'rt records the run as abandoned so the database stops claiming it is ' +
            'still going. Same as `rt runs abandon <id>` from the terminal.',
          label: 'Why is this run dead?',
          placeholder: 'wedged overnight, no owning process',
          required: true,
          confirmLabel: 'Mark abandoned',
          confirmProps: { color: 'bad' },
          onSubmit: async reason => {
            await client.api.runs[':repo'][':runId'].abandon.$post({
              param: { repo, runId },
              json: { reason },
            });
            await queryClient.invalidateQueries({
              queryKey: ['run', repo, runId],
            });
            await queryClient.invalidateQueries({ queryKey: ['runs'] });
          },
        })
      }
    >
      Mark abandoned
    </Button>
  );
}

/** The fact strip's column labels: small caps, tracked out, so four of them
    read as one header band rather than four sentences. */
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

/** GitLab reports pipeline state as an enum; the card shows prose. */
function ciStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

/** `commits` is written as a sentence by the pipeline ("<sha> (5 commits:
    badge, jsdoc, ...)"); the card has room for the count and the sha only,
    and truncating the sentence cuts mid-word instead. */
function commitsSummary(value: string): string {
  const sha = value.match(/^([0-9a-f]{7,40})/i)?.[1];
  const count = value.match(/(\d+)\s+commits?/i)?.[1];
  if (sha && count) return `${count} commits @ ${sha.slice(0, 7)}`;
  if (sha) return sha.slice(0, 7);
  return value;
}

function SummaryCard({
  repo,
  run,
  fields,
}: {
  repo: string;
  run: RunSummary;
  fields: RunFieldRow[];
}) {
  const { bg, border, text } = useSchemeColors();
  const clipboard = useClipboard();
  const byKey = fieldsByKey(fields);
  const enrichQuery = useRunsEnrich(run.branch ? [run.branch] : []);
  const enrichment = run.branch ? enrichQuery.data?.[run.branch] : undefined;

  const values = new Map(
    HOTKEY_FIELDS.map(spec => [spec.key, byKey.get(spec.key)?.value ?? null])
  );
  // `m` must copy what the card SHOWS: the MR column renders enrichment when
  // present, so a field/enrichment divergence would otherwise leave the kbd
  // hint beside one URL while copying another.
  if (enrichment?.mr?.webUrl) values.set('mr', enrichment.mr.webUrl);

  // Independent of the click-to-copy affordances below: every hotkey writes
  // the clipboard directly, same behavior HandoffField pinned before the
  // card absorbed it.
  useHotkeys(
    HOTKEY_FIELDS.map(spec => [
      spec.hotkey,
      () => {
        const value = values.get(spec.key) ?? null;
        if (!value) return;
        clipboard.copy(value);
        notifications.success(`Copied ${spec.label.toLowerCase()}`);
      },
    ])
  );

  const ticketValue = values.get('ticket') ?? null;
  const branchValue = values.get('branch') ?? null;
  const worktreeValue = values.get('worktree') ?? null;
  const commitsValue = values.get('commits') ?? null;

  const title = enrichment?.ticket?.title;
  const mr = enrichment?.mr;

  const showAbandon = run.attention.needs && run.attention.reason === 'stale';
  // A run that needs attention or has already finished has more useful
  // things to say than "which stage" -- the liveness chip takes over there so
  // the card never shows two pills disagreeing about the same run.
  const showStagePill = !run.attention.needs && run.ended_at == null;
  const { color: livenessColor, label: livenessLabel } = livenessSpec(run);

  return (
    <Stack
      gap="sm"
      bg={bg.level2}
      p="xxxl"
      data-testid="summary-card"
      style={{
        borderRadius: 'var(--mantine-radius-xl)',
        border: `1px solid ${border.default}`,
        flex: 1,
      }}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <Text fw={700} fz={18} c={text.highContrast('accent')}>
            {ticketValue ?? run.id}
          </Text>
          <Kbd size="xs">t</Kbd>
          {title && (
            <Text fz={16} fw={500} truncate style={{ minWidth: 0 }}>
              {title}
            </Text>
          )}
        </Group>
        <Group gap="xs" wrap="nowrap">
          {showStagePill ? (
            <Pill color="accent" size="md" data-testid="stage-status-pill">
              {run.current_stage ?? 'not started'} · {run.status}
            </Pill>
          ) : (
            <LivenessChip run={run} size="md" />
          )}
          {showAbandon && <AbandonAction repo={repo} runId={run.id} />}
        </Group>
      </Group>

      <Text c={text.muted} fz={12}>
        {run.pipeline} pipeline · started {formatLocalTime(run.started_at)} ·{' '}
        {formatDuration(run.started_at, run.ended_at)}
      </Text>

      <Group gap="lg" align="flex-start" wrap="nowrap">
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }} data-testid="fact-mr">
          <FactLabel>MR · CI</FactLabel>
          <Group gap={4} wrap="nowrap">
            {mr ? (
              mr.webUrl ? (
                <Anchor
                  href={mr.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  fz={13}
                  data-testid="mr-link"
                >
                  !{mr.iid} {mr.state}
                </Anchor>
              ) : (
                <Text fz={13}>
                  !{mr.iid} {mr.state}
                </Text>
              )
            ) : (
              <Text c={text.dimmed} fz={13}>
                not recorded
              </Text>
            )}
            <Kbd size="xs">m</Kbd>
          </Group>
          {mr?.pipeline?.status && (
            <Text c={text.muted} fz={11}>
              {ciStatusLabel(mr.pipeline.status)}
            </Text>
          )}
        </Stack>

        <Stack
          gap={4}
          style={{
            flex: 1,
            minWidth: 0,
            borderLeft: `1px solid ${border.default}`,
            paddingLeft: 12,
          }}
          data-testid="fact-branch"
        >
          <FactLabel>Branch</FactLabel>
          <Group gap={4} wrap="nowrap">
            <Text fz={13} truncate style={{ minWidth: 0 }}>
              {branchValue ?? 'not recorded'}
            </Text>
            <Kbd size="xs">b</Kbd>
            {branchValue && (
              <CopyActionIcon
                value={branchValue}
                size="sm"
                label="Copy branch"
              />
            )}
          </Group>
          <Group gap={4} wrap="nowrap">
            <Text c={text.muted} fz={11} truncate style={{ minWidth: 0 }}>
              {commitsValue ? commitsSummary(commitsValue) : 'not recorded'}
            </Text>
            <Kbd size="xs">c</Kbd>
          </Group>
        </Stack>

        <Stack
          gap={4}
          style={{
            flex: 1,
            minWidth: 0,
            borderLeft: `1px solid ${border.default}`,
            paddingLeft: 12,
          }}
          data-testid="fact-worktree"
        >
          <FactLabel>Worktree</FactLabel>
          <Group gap={4} wrap="nowrap">
            <Text fz={13} truncate="start" style={{ minWidth: 0 }}>
              {worktreeValue ?? 'not recorded'}
            </Text>
            <Kbd size="xs">w</Kbd>
            {worktreeValue && (
              <CopyActionIcon
                value={worktreeValue}
                size="sm"
                label="Copy worktree"
              />
            )}
          </Group>
          <Text c={text.muted} fz={11}>
            {repoLabel(repo)}
          </Text>
        </Stack>

        <Stack
          gap={4}
          style={{
            flex: 1,
            minWidth: 0,
            borderLeft: `1px solid ${border.default}`,
            paddingLeft: 12,
          }}
          data-testid="fact-liveness"
        >
          <FactLabel>Liveness</FactLabel>
          <Text fw={600} fz={13} c={text.highContrast(livenessColor)}>
            {livenessLabel}
          </Text>
          <Text c={text.muted} fz={11}>
            last pipeline event {formatAgo(run.last_event_at)}
          </Text>
        </Stack>
      </Group>
    </Stack>
  );
}

function RunDetailContent({ repo, runId }: { repo: string; runId: string }) {
  const { bg, border } = useSchemeColors();
  useRunEvents();
  const runQuery = useRun(repo, runId);
  const { data } = runQuery;
  const markSeen = useMarkSeen();

  useEffect(() => {
    markSeen.mutate(runId);
    // Fires once per navigation to this run, not on every refetch of
    // ['run', ...] (e.g. after abandon) -- markSeen itself is excluded
    // because useMutation returns a new object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return (
    <Stack gap="lg" data-testid="run-detail">
      <CommandProvenance
        command={`rt runs show ${runId} --repo ${repoLabel(repo)}`}
        asOf={runQuery.dataUpdatedAt}
      />
      <SummaryCard repo={repo} run={data.run} fields={data.fields} />
      {/* One surface, three readings of the same run: what it did, what was
          recorded around it, what it was told. Stacking them made the page
          three competing containers and buried the last one. */}
      <Paper
        bg={bg.level2}
        p="xxxl"
        radius="xl"
        style={{ border: `1px solid ${border.default}` }}
        data-testid="run-panels"
      >
        <Tabs defaultValue="pipeline" keepMounted={false}>
          <Tabs.List mb="lg">
            <Tabs.Tab value="pipeline">Pipeline</Tabs.Tab>
            <Tabs.Tab value="context">Run context</Tabs.Tab>
            <Tabs.Tab value="inputs">Effective inputs</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="pipeline">
            <Timeline
              repo={repo}
              runId={runId}
              stages={data.stages}
              fields={data.fields}
              decisions={data.decisions}
              currentStage={data.run.current_stage}
            />
          </Tabs.Panel>
          <Tabs.Panel value="context">
            <RunContext
              stages={data.stages}
              fields={data.fields}
              decisions={data.decisions}
            />
          </Tabs.Panel>
          <Tabs.Panel value="inputs">
            <EffectiveInputs
              repo={repo}
              runId={runId}
              decisions={data.decisions}
            />
          </Tabs.Panel>
        </Tabs>
      </Paper>
    </Stack>
  );
}

/**
 * Scoped to this route (not the app-wide `RouteErrorBoundary` in App.tsx),
 * so a thrown `useRun` query loses only the fields it fetched -- the run id
 * heading (`PageShell`'s title, rendered by the caller outside this
 * boundary) and the command that would fetch them by hand both survive the
 * fallback.
 */
class RunDetailErrorBoundary extends Component<
  { repo: string; runId: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error) {
      const { repo, runId } = this.props;
      return (
        <Stack gap="lg" data-testid="run-detail-error">
          <CommandProvenance
            command={`rt runs show ${runId} --repo ${repoLabel(repo)}`}
            asOf={undefined}
          />
          <GenericError
            title="This run failed to load"
            message={error.message}
            onRetry={() => this.setState({ error: null })}
          />
        </Stack>
      );
    }
    return this.props.children;
  }
}

/** The run id rides the page title but is not its subject: the repo names
    the place, the id only disambiguates within it. */
function RunIdInTitle({ runId }: { runId: string }) {
  const { text } = useSchemeColors();
  return (
    <Text span c={text.muted} fw={500} fz="md" style={{ letterSpacing: 0 }}>
      {`/ ${runId}`}
    </Text>
  );
}

export function RunDetail({ repo, runId }: { repo: string; runId: string }) {
  return (
    <PageShell
      headerHeight={PAGE_ROW_HEIGHT}
      compactHeader
      title={
        <>
          {repoLabel(repo)} <RunIdInTitle runId={runId} />
        </>
      }
    >
      <RunDetailErrorBoundary repo={repo} runId={runId}>
        <LazyLoader>
          <RunDetailContent repo={repo} runId={runId} />
        </LazyLoader>
      </RunDetailErrorBoundary>
    </PageShell>
  );
}
