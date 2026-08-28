import { useQuery } from '@tanstack/react-query';

import {
  Anchor,
  Code,
  Group,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import { client } from '../api';

const MAX_HEIGHT = 240;

export interface FailureExcerptProps {
  repo: string;
  runId: string;
  detailPath: string;
}

/** Thrown for the 403 case specifically, so the render branch can tell
    "outside every allowed root" apart from a genuine fetch failure and word
    each one honestly instead of surfacing a raw status string. */
class ArtifactOutsideRunError extends Error {}

/**
 * The spec's one concession to a log surface: a bounded, one-shot excerpt.
 * No `refetchInterval`, no follow, no auto-scroll -- adding any of those
 * reopens a decision the spec already made against a log viewer.
 */
export function FailureExcerpt({
  repo,
  runId,
  detailPath,
}: FailureExcerptProps) {
  const { bg, border, text } = useSchemeColors();

  const query = useQuery({
    queryKey: ['artifact', repo, runId, detailPath],
    queryFn: async () => {
      const res = await client.api.runs[':repo'][':runId'].artifact.$get({
        param: { repo, runId },
        query: { path: detailPath },
      });
      if (res.status === 403) throw new ArtifactOutsideRunError();
      if (!res.ok) throw new Error(`artifact read failed: ${res.status}`);
      return res.json();
    },
  });

  // No extra slash: `detailPath` is already an absolute path (leading `/`),
  // and vscode's URI form is `vscode://file` + that absolute path.
  const editorLink = (
    <Anchor
      href={`vscode://file${detailPath}`}
      size="xs"
      c={text.muted}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        flexShrink: 0,
      }}
    >
      <Icons.externalLink size={12} />
      open full artifact in editor
    </Anchor>
  );

  if (query.isPending) {
    return (
      <Skeleton height={MAX_HEIGHT} data-testid="failure-excerpt-loading" />
    );
  }

  if (query.isError) {
    const outsideRun = query.error instanceof ArtifactOutsideRunError;
    return (
      <Group
        justify="space-between"
        wrap="nowrap"
        data-testid="failure-excerpt-error"
      >
        <Text c={text.highContrast('bad')} size="sm">
          {outsideRun
            ? 'This artifact lives outside the run directory.'
            : `Could not load ${detailPath}: ${(query.error as Error).message}`}
        </Text>
        {editorLink}
      </Group>
    );
  }

  const { lines, truncated } = query.data;

  return (
    <Stack gap={4} data-testid="failure-excerpt">
      <Group justify="space-between" wrap="nowrap">
        <Text c={text.muted} size="xs" truncate>
          {truncated ? `last ${lines.length} lines · ` : ''}
          {detailPath}
        </Text>
        {editorLink}
      </Group>
      <ScrollArea
        h={MAX_HEIGHT}
        bg={bg.level1}
        style={{ border: `1px solid ${border.default}`, borderRadius: 4 }}
      >
        {lines.length === 0 ? (
          <Text c={text.dimmed} size="sm" p="xs">
            no artifact recorded
          </Text>
        ) : (
          <Code block>{lines.join('\n')}</Code>
        )}
      </ScrollArea>
    </Stack>
  );
}
