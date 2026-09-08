import { Component, useEffect, useRef } from 'react';
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
import type { GateRow, RunFieldRow, RunSummary } from '@mattstack/rt-client';
import { useQueryClient } from '@tanstack/react-query';
import { useSearch } from 'wouter';

import { client } from '../api';
import { PAGE_ROW_HEIGHT } from '../chrome';
import { CommandProvenance } from './CommandProvenance';
import { EffectiveInputs } from './EffectiveInputs';
import { GateCard } from './GateCard';
import { LivenessChip, livenessSpec } from './LivenessChip';
import { mrRef } from './mrRef';
import { repoLabel } from './repoLabel';
import { fieldsByKey, RunContext, Timeline } from './Timeline';
import { activeGatesForRun, useGates } from './useGates';
import {
  useLinearWorkspace,
  useMarkSeen,
  useRun,
  useRunEvents,
  useRunsEnrich,
} from './useRuns';

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

function FocusPaneAction({ pane }: { pane: string }) {
  return (
    <Button
      size="xs"
      variant="light"
      leftSection={<Icons.terminal size={16} />}
      aria-label="focus pane"
      onClick={async () => {
        try {
          const res = await client.api.panes[':id'].focus.$post({
            param: { id: pane },
          });
          if (!res.ok) notifications.error("couldn't focus the pane");
        } catch {
          notifications.error("couldn't focus the pane");
        }
      }}
    >
      Focus pane
    </Button>
  );
}

/** Scrolls to the first ACTIONABLE `GateCard` rendered lower on the page,
    rather than duplicating its submit UI up here -- same "click points at
    the real control" affordance `SummaryStrip`'s fact links use, and
    `scrollIntoView` is polyfilled to a no-op in tests (vitest.setup.ts).
    `[data-actionable="true"]`, not just `[data-testid="gate-card"]`:
    `activeGatesForRun` orders cards by `openedAt` alone, so a more recently
    opened but already-`answered` (read-only) gate can sort ahead of an
    older still-`open` one -- landing on that one would show no submit
    control at all. */
function AnswerGateAction() {
  return (
    <Button
      size="xs"
      variant="light"
      leftSection={<Icons.questionCircle size={16} />}
      aria-label="answer gate"
      onClick={() =>
        document
          .querySelector('[data-testid="gate-card"][data-actionable="true"]')
          ?.scrollIntoView?.({ block: 'center' })
      }
    >
      Answer
    </Button>
  );
}

/** `/gates/:id` (`GateRedirect`) hands off here with `?gate=<id>` still on
    the URL, and it usually gets here before this run's gates query has
    caught up (the notification fires the instant the daemon opens the
    gate; the console's own `['gates']` fetch is a round trip behind). So
    the param is consumed only on a successful scroll, never merely because
    the query resolved: on every change of `gates`, if the target isn't
    rendered yet, do nothing and wait for the next gates update (a refetch
    via the websocket in `useRunEvents`, which invalidates `['gates']` on
    every pipeline event) to try again. A gate that never shows up leaves
    the param in place -- acceptable, and distinguishable from "already
    consumed" for anyone debugging the URL. `consumedRef` is the "once"
    guard once the scroll DOES fire: stripping the param flips `gateId` to
    null on the next render, and the ref additionally covers a refetch
    landing before that URL update commits. */
function useGateDeepLinkScroll(gates: GateRow[] | undefined) {
  const search = useSearch();
  const consumedRef = useRef<string | null>(null);

  useEffect(() => {
    const gateId = new URLSearchParams(search).get('gate');
    if (!gateId || gates === undefined || consumedRef.current === gateId) {
      return;
    }
    const el = document.querySelector(
      `[data-gate-id="${CSS.escape(gateId)}"]`
    );
    if (!el) return;
    consumedRef.current = gateId;
    el.scrollIntoView({ block: 'center' });
    const params = new URLSearchParams(search);
    params.delete('gate');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : ''));
  }, [search, gates]);
}

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
  gates,
}: {
  repo: string;
  run: RunSummary;
  fields: RunFieldRow[];
  gates: GateRow[];
}) {
  const { bg, border, text } = useSchemeColors();
  const clipboard = useClipboard();
  const byKey = fieldsByKey(fields);
  const enrichQuery = useRunsEnrich(run.branch ? [run.branch] : []);
  const workspace = useLinearWorkspace().data ?? null;
  const enrichment = run.branch ? enrichQuery.data?.[run.branch] : undefined;

  const values = new Map(
    HOTKEY_FIELDS.map(spec => [spec.key, byKey.get(spec.key)?.value ?? null])
  );
  // `m` must copy what the card SHOWS: the MR column renders enrichment when
  // present, so a field/enrichment divergence would otherwise leave the kbd
  // hint beside one URL while copying another. A field-only run already has
  // the field value in the map from the HOTKEY_FIELDS seed above.
  const mrField = byKey.get('mr')?.value ?? null;
  const mr = mrRef(enrichment?.mr, mrField);
  if (mr?.webUrl && enrichment?.mr) values.set('mr', mr.webUrl);

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
  // Enrichment's url wins (it carries the real title slug); the workspace
  // slug covers every ticket whose branch the board never cached, which is
  // any prefix outside `board.ticketPrefixes`. Linear resolves the bare
  // `/issue/<id>` form, so no title slug is needed.
  const ticketUrl =
    enrichment?.ticket?.url ??
    (workspace && ticketValue
      ? `https://linear.app/${workspace}/issue/${ticketValue}`
      : null);
  const mrLabel = mr
    ? (mr.text ??
      `${mr.iid ? `!${mr.iid}` : 'MR'}${mr.state ? ` ${mr.state}` : ''}`)
    : null;

  const showAbandon = run.attention.needs && run.attention.reason === 'stale';
  const showFocusPane = Boolean(run.agent && run.agent.status !== 'done');
  const showAnswerGate = gates.some(
    g => g.status === 'open' || g.status === 'parked'
  );
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
          {/* The accent color alone reads as a link while being inert text,
              so the ticket carries a real underline and the external-link
              glyph whenever enrichment knows its url. */}
          {ticketValue && ticketUrl ? (
            <Anchor
              href={ticketUrl}
              target="_blank"
              rel="noopener noreferrer"
              fw={700}
              fz={18}
              underline="always"
              data-testid="ticket-link"
            >
              <Group gap={4} wrap="nowrap" component="span">
                {ticketValue}
                <Icons.externalLink size={14} />
              </Group>
            </Anchor>
          ) : (
            <Text fw={700} fz={18} c={text.highContrast('accent')}>
              {ticketValue ?? run.id}
            </Text>
          )}
          <Kbd size="xs">t</Kbd>
          {title && (
            <Text fz={16} fw={500} truncate style={{ minWidth: 0 }}>
              {title}
            </Text>
          )}
        </Group>
        <Group gap="xs" wrap="nowrap">
          {/* The same chip the board row carries, so a run never reads
              "idle" on the board and "running" here; the timeline below
              already names the current stage. */}
          <LivenessChip run={run} size="md" />
          {showAnswerGate && <AnswerGateAction />}
          {showFocusPane && <FocusPaneAction pane={run.agent!.pane} />}
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
                  {mrLabel}
                </Anchor>
              ) : (
                <Text fz={13} truncate style={{ minWidth: 0 }}>
                  {mrLabel}
                </Text>
              )
            ) : (
              <Text c={text.dimmed} fz={13}>
                not recorded
              </Text>
            )}
            <Kbd size="xs">m</Kbd>
          </Group>
          {mr?.ciStatus && (
            <Text c={text.muted} fz={11}>
              {ciStatusLabel(mr.ciStatus)}
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
  const gatesQuery = useGates();
  const gates = activeGatesForRun(
    gatesQuery.data?.gates,
    runId,
    data.run.status
  );

  useEffect(() => {
    markSeen.mutate(runId);
    // Fires once per navigation to this run, not on every refetch of
    // ['run', ...] (e.g. after abandon) -- markSeen itself is excluded
    // because useMutation returns a new object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  useGateDeepLinkScroll(gatesQuery.data?.gates);

  return (
    <Stack gap="lg" data-testid="run-detail">
      <CommandProvenance
        command={`rt runs show ${runId} --repo ${repoLabel(repo)}`}
        asOf={runQuery.dataUpdatedAt}
      />
      <SummaryCard
        repo={repo}
        run={data.run}
        fields={data.fields}
        gates={gates}
      />
      {gates.map(g => (
        <GateCard key={g.id} gate={g} />
      ))}
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
