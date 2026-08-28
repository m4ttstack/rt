import { type MouseEvent } from 'react';
import type { BranchEnrichment } from '@mattstack/rt-client';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { navigate } from 'wouter/use-browser-location';

import { ActionIcon, Anchor, Group, Menu, Stack, Text } from '@mattstack/app-kit/core';
import { useClipboard, useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import { notifications } from '@mattstack/app-kit/notifications';
import { client } from '../api';
import { agingWarning } from './aging';
import type { BoardRun } from './bands';
import { LivenessChip } from './LivenessChip';
import { repoLabel } from './repoLabel';
import { StageProgress } from './StageProgress';

function formatElapsed(startedAt: number, endedAt: number | null): string {
  const ms = Math.max(0, (endedAt ?? Date.now()) - startedAt);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** `RunSummary` denormalizes only `ticket`/`branch` for the list; `worktree`
    lives in `RunDetail.fields` and is fetched on demand here rather than
    guessed from `branch` -- a wrong guess would send someone to a path that
    doesn't exist. Routed through `queryClient.fetchQuery` under the same
    `['run', repo, runId]` key `useRun` uses, so a second copy shares the
    first fetch instead of hitting the daemon again. `staleTime` is what
    makes that sharing real: without it the default `staleTime: 0` would
    still refetch on the second click even though the query key matches. */
async function fetchWorktreePath(
  queryClient: QueryClient,
  repo: string,
  runId: string
): Promise<string | null> {
  const detail = await queryClient.fetchQuery({
    queryKey: ['run', repo, runId],
    staleTime: 30_000,
    queryFn: async () => {
      const res = await client.api.runs[':repo'][':runId'].$get({
        param: { repo, runId },
      });
      if (!res.ok) throw new Error(`run detail failed: ${res.status}`);
      return res.json();
    },
  });
  return detail.fields.find(f => f.key === 'worktree')?.value ?? null;
}

export interface RunRowProps {
  run: BoardRun;
  /** Retention window in days, when known -- only the board passes this, so
      only board rows carry the aging warning (search states the window
      itself, once, rather than repeating it per row). */
  pruneDays?: number;
  /** This row's entry from the batched `/api/runs/enrich` join, keyed by
      `run.branch` at the board level -- absent for a branch the daemon has
      no cached Linear/MR data for yet, not only for a fetch that hasn't
      landed. */
  enrichment?: BranchEnrichment;
}

export function RunRow({ run, pruneDays, enrichment }: RunRowProps) {
  const { bg, text, border } = useSchemeColors();
  const clipboard = useClipboard();
  const queryClient = useQueryClient();
  const detailHref = `/runs/${run.repo}/${run.id}`;
  const aging = agingWarning(run, pruneDays);

  const title = enrichment?.ticket?.title;
  const mr = enrichment?.mr;
  const mrUrl = mr?.webUrl ?? null;
  const ticketUrl = enrichment?.ticket?.url ?? null;

  const stageName = run.current_stage ?? 'not started';
  // RunSummary's `stages` (list view) carry only name/status -- no per-stage
  // timestamp, unlike the detail view's `RunStageRow` -- so `last_event_at`
  // is the closest available proxy for how long the run has sat here.
  // A finished run's last event IS its ending, so last_event_at would read
  // as a meaningless sliver -- total runtime is the honest label there. The
  // running case keeps the last-event proxy (see the stages comment above).
  const stageElapsed =
    run.ended_at == null
      ? formatElapsed(run.last_event_at, run.ended_at)
      : formatElapsed(run.started_at, run.ended_at);

  async function handleCopyWorktree() {
    try {
      const value = await fetchWorktreePath(queryClient, run.repo, run.id);
      if (!value) {
        notifications.info('No worktree recorded for this run yet.');
        return;
      }
      clipboard.copy(value);
    } catch (err) {
      notifications.error(
        `Could not copy worktree path: ${(err as Error).message}`
      );
    }
  }

  function handleCopyBranch() {
    if (!run.branch) return;
    clipboard.copy(run.branch);
  }

  function handleOpenMr() {
    if (!mrUrl) return;
    window.open(mrUrl, '_blank', 'noopener');
  }

  function handleOpenTicket() {
    if (!ticketUrl) return;
    window.open(ticketUrl, '_blank', 'noopener');
  }

  return (
    <Group
      data-testid={`run-row-${run.id}`}
      wrap="nowrap"
      justify="space-between"
      align="center"
      bg={bg.monochrome}
      px="xxl"
      py="xl"
      onClick={() => navigate(detailHref)}
      style={{
        borderRadius: 'var(--mantine-radius-lg)',
        border: `1px solid ${border.default}`,
        cursor: 'pointer',
        // Seen rows sink to the bottom of their band, which is the real
        // de-emphasis. A light touch of transparency on top of that is all
        // the row can carry before its ticket and status stop being legible.
        opacity: run.seen ? 0.92 : 1,
      }}
    >
      <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
        {/* A real anchor, not just the row's own onClick, so the detail
            link is Tab-reachable, announced by a screen reader, and
            middle-click/open-in-new-tab work -- `stopPropagation` keeps its
            own navigate() from double-firing the row's onClick underneath
            it (both target the same href, so harmless either way, but the
            second call is pure noise). */}
        <Anchor
          component={Link}
          href={detailHref}
          onClick={(event: MouseEvent<HTMLAnchorElement>) =>
            event.stopPropagation()
          }
          style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
        >
          <Group gap="xs" wrap="nowrap">
            <Text fw={700} fz={14} c={text.highContrast('accent')} truncate>
              {run.ticket ?? run.id}
            </Text>
            {title && (
              <Text c={text.normal} fz={13} truncate style={{ minWidth: 0 }}>
                {title}
              </Text>
            )}
          </Group>
        </Anchor>
        <Text c={text.muted} fz={11} truncate>
          {repoLabel(run.repo)} · {run.branch ?? 'no branch'}
          {mr && ` · MR !${mr.iid} ${mr.state}`}
        </Text>
        {aging && (
          <Text
            c={text.highContrast('warn')}
            fz={11}
            data-testid="aging-warning"
          >
            {aging}
          </Text>
        )}
      </Stack>

      <Stack gap={6} style={{ width: 300, flexShrink: 0 }}>
        <Group gap="xs" wrap="nowrap">
          <Text fw={700} fz={14}>
            {stageName}
          </Text>
          <Text c={text.muted} fz={11}>
            {stageElapsed}
          </Text>
        </Group>
        <StageProgress stages={run.stages} />
      </Stack>

      {/* Fixed width: the chip's label length varies per state, and without
          this the stage column above lands at a different x on every row. */}
      <Group
        gap="xs"
        wrap="nowrap"
        justify="flex-end"
        style={{ width: 232, flexShrink: 0 }}
      >
        <LivenessChip run={run} />
        <Menu position="bottom-end">
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="run actions"
              onClick={event => event.stopPropagation()}
            >
              <Icons.moreHorizontal size={16} />
            </ActionIcon>
          </Menu.Target>
          {/* React re-dispatches a portalled child's bubbling event along the
              REACT tree, not the DOM tree the portal actually renders into --
              so without this, a click on any item here still reaches the
              row's onClick and navigates to the detail page underneath it. */}
          <Menu.Dropdown onClick={event => event.stopPropagation()}>
            <Menu.Item disabled={!mrUrl} onClick={handleOpenMr}>
              Open MR
            </Menu.Item>
            <Menu.Item disabled={!ticketUrl} onClick={handleOpenTicket}>
              Open ticket
            </Menu.Item>
            <Menu.Item onClick={() => void handleCopyWorktree()}>
              Copy worktree path
            </Menu.Item>
            <Menu.Item disabled={!run.branch} onClick={handleCopyBranch}>
              Copy branch
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Group>
  );
}
