import { Component, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { RunFieldRow } from '@mattstack/rt-client';
import { useQueryClient } from '@tanstack/react-query';

import {
  Button,
  CopyButton,
  GenericError,
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
import { CommandProvenance } from './CommandProvenance';
import { EffectiveInputs } from './EffectiveInputs';
import { repoLabel } from './repoLabel';
import { fieldsByKey, Timeline } from './Timeline';
import { useMarkSeen, useRun } from './useRuns';

interface HandoffFieldSpec {
  key: string;
  label: string;
  hotkey: string;
}

// Order fixes the hotkey each field answers to -- t/b/w/m/c, no modifier.
const HANDOFF_FIELDS: HandoffFieldSpec[] = [
  { key: 'ticket', label: 'Ticket', hotkey: 't' },
  { key: 'branch', label: 'Branch', hotkey: 'b' },
  { key: 'worktree', label: 'Worktree', hotkey: 'w' },
  { key: 'mr', label: 'MR', hotkey: 'm' },
  { key: 'commits', label: 'Commits', hotkey: 'c' },
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

  // Independent of CopyButton's own click handler below: this hotkey writes
  // the clipboard directly rather than triggering the button (a plain
  // function component, not ref-forwarded, so it can't be clicked
  // programmatically).
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
  const byKey = fieldsByKey(fields);

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
          value={byKey.get(spec.key)?.value ?? null}
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

  const showAbandon =
    data.run.attention.needs && data.run.attention.reason === 'stale';

  return (
    <Stack gap="lg" data-testid="run-detail">
      <CommandProvenance
        command={`rt runs show ${runId} --repo ${repoLabel(repo)}`}
        asOf={runQuery.dataUpdatedAt}
      />
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
      <EffectiveInputs repo={repo} runId={runId} decisions={data.decisions} />
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

export function RunDetail({ repo, runId }: { repo: string; runId: string }) {
  return (
    <PageShell title={`${repoLabel(repo)} / ${runId}`}>
      <RunDetailErrorBoundary repo={repo} runId={runId}>
        <LazyLoader>
          <RunDetailContent repo={repo} runId={runId} />
        </LazyLoader>
      </RunDetailErrorBoundary>
    </PageShell>
  );
}
