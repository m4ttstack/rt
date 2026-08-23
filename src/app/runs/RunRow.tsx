import { useState } from 'react';

import {
  ActionIcon,
  Badge,
  CopyActionIcon,
  Group,
  Stack,
  Text,
  Tooltip,
} from '@ui/core';
import type { MantineColor } from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import { notifications } from '@ui/notifications';
import { client } from '../api';
import { Link } from '../router/Link';
import type { BoardRun } from './bands';

const STATUS_COLOR: Record<string, MantineColor> = {
  running: 'accent',
  done: 'ok',
  failed: 'bad',
  abandoned: 'warn',
};

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
    and `mr` live in `RunDetail.fields` and are fetched on demand here rather
    than guessed from `branch` -- a wrong guess would send someone to a path
    or MR that doesn't exist. */
async function openDetailField(
  repo: string,
  runId: string,
  key: 'worktree' | 'mr'
): Promise<string | null> {
  const res = await client.api.runs[':repo'][':runId'].$get({
    param: { repo, runId },
  });
  if (!res.ok) throw new Error(`run detail failed: ${res.status}`);
  const detail = await res.json();
  return detail.fields.find(f => f.key === key)?.value ?? null;
}

export function RunRow({ run }: { run: BoardRun }) {
  const { bg, text, border } = useSchemeColors();
  const [opening, setOpening] = useState<'worktree' | 'mr' | null>(null);
  const detailHref = `/runs/${run.repo}/${run.id}`;
  const statusColor = STATUS_COLOR[run.status] ?? 'accent';

  async function handleOpen(key: 'worktree' | 'mr') {
    setOpening(key);
    try {
      const value = await openDetailField(run.repo, run.id, key);
      if (!value) {
        notifications.info(`No ${key} recorded for this run yet.`);
        return;
      }
      window.open(
        key === 'worktree' ? `file://${value}` : value,
        '_blank',
        'noopener'
      );
    } catch (err) {
      notifications.error(`Could not open ${key}: ${(err as Error).message}`);
    } finally {
      setOpening(null);
    }
  }

  return (
    <Group
      data-testid={`run-row-${run.id}`}
      wrap="nowrap"
      justify="space-between"
      align="center"
      bg={bg.level2}
      p="sm"
      style={{
        borderRadius: 6,
        border: `1px solid ${border.default}`,
        // Seen-but-unresolved rows sink to the bottom of their band; opacity
        // (not a different color) is what marks them de-emphasised so the
        // palette stays intact.
        opacity: run.seen ? 0.6 : 1,
      }}
    >
      <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
        <Group gap="xs" wrap="nowrap">
          <Text fw={600} c={text.normal} truncate>
            {run.ticket ?? run.id}
          </Text>
          <Text c={text.muted} size="sm">
            {run.repo}
          </Text>
          <Badge color={statusColor} variant="light" size="sm">
            {run.status}
          </Badge>
          {run.attention.needs && (
            <Text c={text.highContrast('bad')} size="sm">
              {run.attention.reason}
            </Text>
          )}
        </Group>
        <Group gap="xs" wrap="nowrap">
          <Text c={text.muted} size="xs">
            {run.work_type}
          </Text>
          <Text c={text.muted} size="xs">
            {run.current_stage ?? 'not started'}
          </Text>
          <Text c={text.muted} size="xs">
            {formatElapsed(run.started_at, run.ended_at)}
          </Text>
        </Group>
      </Stack>

      <Group gap="xs" wrap="nowrap">
        <Tooltip label="Open run detail">
          <ActionIcon
            component={Link}
            href={detailHref}
            variant="subtle"
            color="gray"
            aria-label="open run detail"
          >
            <Icons.externalLink size={16} />
          </ActionIcon>
        </Tooltip>
        {run.branch && (
          <CopyActionIcon
            value={`git checkout ${run.branch}`}
            label="Copy resume command"
          />
        )}
        <Tooltip label="Open worktree">
          <ActionIcon
            variant="subtle"
            color="gray"
            loading={opening === 'worktree'}
            onClick={() => void handleOpen('worktree')}
            aria-label="open worktree"
          >
            <Icons.externalLink size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Open MR">
          <ActionIcon
            variant="subtle"
            color="gray"
            loading={opening === 'mr'}
            onClick={() => void handleOpen('mr')}
            aria-label="open MR"
          >
            <Icons.externalLink size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}
