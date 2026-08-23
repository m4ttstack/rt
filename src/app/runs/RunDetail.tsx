import { useEffect } from 'react';
import type { RunFieldRow } from '@mattstack/rt-client';
import { useQueryClient } from '@tanstack/react-query';

import {
  Button,
  CopyButton,
  Group,
  Kbd,
  LazyLoader,
  PageShell,
  Stack,
  Text,
} from '@ui/core';
import { useClipboard, useHotkeys, useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import { modals } from '@ui/modals';
import { notifications } from '@ui/notifications';
import { client } from '../api';
import { latestFields, Timeline } from './Timeline';
import { useMarkSeen, useRun } from './useRuns';

interface HandoffFieldSpec {
  key: string;
  label: string;
  hotkey: string;
}

// Order fixes the hotkey each field answers to -- t/b/w/m/p, no modifier.
const HANDOFF_FIELDS: HandoffFieldSpec[] = [
  { key: 'ticket', label: 'Ticket', hotkey: 't' },
  { key: 'branch', label: 'Branch', hotkey: 'b' },
  { key: 'worktree', label: 'Worktree', hotkey: 'w' },
  { key: 'mr', label: 'MR', hotkey: 'm' },
  { key: 'plan', label: 'Plan path', hotkey: 'p' },
];

function HandoffField({
  label,
  hotkey,
  value,
}: {
  label: string;
  hotkey: string;
  value: string | null;
}) {
  const { text } = useSchemeColors();
  const clipboard = useClipboard();

  // Independent of CopyButton's own click handler -- this is the
  // single-key path, CopyButton below is the click path. Both write the
  // same value; they don't need to share state to satisfy "click-to-copy
  // AND single-key-copy".
  useHotkeys([
    [
      hotkey,
      () => {
        if (!value) return;
        clipboard.copy(value);
        notifications.success(`Copied ${label.toLowerCase()}`);
      },
    ],
  ]);

  return (
    <Group justify="space-between" wrap="nowrap" gap="sm">
      <Group gap={6} wrap="nowrap">
        <Text c={text.muted} size="sm">
          {label}
        </Text>
        <Kbd size="xs">{hotkey}</Kbd>
      </Group>
      {value ? (
        <CopyButton value={value} codeStyle>
          {value}
        </CopyButton>
      ) : (
        <Text c={text.dimmed} size="sm">
          not recorded
        </Text>
      )}
    </Group>
  );
}

function HandoffCard({ fields }: { fields: RunFieldRow[] }) {
  const { bg, border, text } = useSchemeColors();
  const latest = latestFields(fields);

  return (
    <Stack
      gap="xs"
      bg={bg.level2}
      p="md"
      data-testid="handoff-card"
      style={{
        borderRadius: 8,
        border: `1px solid ${border.default}`,
        flex: 1,
      }}
    >
      <Text fw={700} c={text.normal}>
        Handoff
      </Text>
      {HANDOFF_FIELDS.map(spec => (
        <HandoffField
          key={spec.key}
          label={spec.label}
          hotkey={spec.hotkey}
          value={latest.get(spec.key)?.current.value ?? null}
        />
      ))}
    </Stack>
  );
}

function AbandonAction({ repo, runId }: { repo: string; runId: string }) {
  const queryClient = useQueryClient();

  return (
    <Button
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

function RunDetailContent({ repo, runId }: { repo: string; runId: string }) {
  const { data } = useRun(repo, runId);
  const markSeen = useMarkSeen();

  useEffect(() => {
    markSeen.mutate(runId);
    // Fires once per navigation to this run, not on every refetch of
    // ['run', ...] (e.g. after abandon) -- markSeen itself is excluded
    // because useMutation returns a new object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const showAbandon =
    data.run.attention.needs && data.run.attention.reason === 'stale';

  return (
    <Stack gap="lg" data-testid="run-detail">
      <Group align="flex-start" wrap="nowrap">
        <HandoffCard fields={data.fields} />
        {showAbandon && <AbandonAction repo={repo} runId={runId} />}
      </Group>
      <Timeline
        repo={repo}
        runId={runId}
        stages={data.stages}
        fields={data.fields}
        decisions={data.decisions}
      />
    </Stack>
  );
}

export function RunDetail({ repo, runId }: { repo: string; runId: string }) {
  return (
    <PageShell title={`${repo} / ${runId}`}>
      <LazyLoader>
        <RunDetailContent repo={repo} runId={runId} />
      </LazyLoader>
    </PageShell>
  );
}
