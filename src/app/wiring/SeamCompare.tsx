import { useMemo } from 'react';

import { Alert, Group, Paper, Skeleton, Stack, Text } from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import { parseSeam, type Seam } from './parseSeam';
import { QuietBadge } from './QuietBadge';
import {
  attributeHunk,
  parseDiffHunks,
  type DiffHunk,
} from './seamAttribution';
import { SOFT_RULE } from './SlotRow';

/** Past this the drawer is a wall rather than a reading; the count of what
    was left out is the honest thing to say instead. */
const MAX_HUNKS = 150;

/** The seams of the body `rt skills compile --preview` printed. Read off the
    raw text rather than off `splitCompiledBody`'s sections, because a seam
    matters here even when the section under it is empty. */
export function seamsOf(body: string): Seam[] {
  const seams: Seam[] = [];
  for (const line of body.split('\n')) {
    const seam = parseSeam(line);
    if (seam) seams.push(seam);
  }
  return seams;
}

export interface AttributedHunk {
  hunk: DiffHunk;
  seam: Seam | null;
}

/**
 * Every hunk in the diff, each with the seam that contains it or null.
 *
 * Order is the diff's own. Grouping the attributed ones together would sort
 * a diff by provenance, and a reader comparing two versions is reading a
 * sequence of changes, not a report about seams.
 */
export function attributeDiff(diff: string, seams: Seam[]): AttributedHunk[] {
  return parseDiffHunks(diff).map(hunk => ({
    hunk,
    seam: attributeHunk(hunk, seams),
  }));
}

function spanOf(path: string, lines: [number, number]): string {
  return `${path}:${lines[0]}-${lines[1]}`;
}

/** One line of unified diff, coloured by its first character. The `light`
    variant's own fill and text, the same pair every Badge and Alert on this
    surface uses, so an addition reads as the same green as an in-sync row. */
function DiffLine({ line }: { line: string }) {
  const { bg, text } = useSchemeColors();
  const added = line.startsWith('+');
  const removed = line.startsWith('-');
  const color = added ? 'ok' : 'bad';

  return (
    <Text
      component="div"
      size="xs"
      ff="monospace"
      lh={1.6}
      c={added || removed ? text.highContrast(color) : undefined}
      bg={added || removed ? bg.color(color) : undefined}
      style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
    >
      {line === '' ? ' ' : line}
    </Text>
  );
}

/**
 * A hunk under the heading that says where its line numbers live.
 *
 * The attributed case names the SEAM's span, in the seam's own source file;
 * the unattributed case names the hunk's own. Never one label for both: the
 * whole point of the attribution is that those are two different files.
 */
function HunkBlock({ hunk, seam }: AttributedHunk) {
  const { bg, text } = useSchemeColors();

  return (
    <Stack
      gap="xs"
      data-testid={seam ? 'attributed-hunk' : 'unattributed-hunk'}
    >
      <Group gap="xs" wrap="nowrap">
        {seam ? (
          <>
            <Text size="xs" c={text.muted} style={{ flex: 'none' }}>
              {seam.kind === 'step' ? 'step' : `slot ${seam.slot}`}
            </Text>
            <Text size="sm" fw={600} style={{ flex: 'none' }}>
              {seam.ref}
            </Text>
            <QuietBadge>{seam.version}</QuietBadge>
            <Text
              size="xs"
              c={text.dimmed}
              truncate
              style={{ flex: 1 }}
              data-testid="hunk-span"
            >
              {spanOf(seam.path, seam.lines)}
            </Text>
          </>
        ) : (
          <>
            <Text size="xs" c={text.muted} style={{ flex: 'none' }}>
              no seam contains this
            </Text>
            <Text
              size="sm"
              c={text.muted}
              truncate
              style={{ flex: 1 }}
              data-testid="hunk-span"
            >
              {spanOf(hunk.path, hunk.lines)}
            </Text>
          </>
        )}
      </Group>

      <Paper
        bg={bg.level3}
        p="sm"
        radius="sm"
        style={{ border: `1px solid ${SOFT_RULE}` }}
      >
        {hunk.text.map((line, i) => (
          <DiffLine key={i} line={line} />
        ))}
      </Paper>

      {!seam && (
        <Text size="xs" c={text.muted} pl={2}>
          No part&apos;s body span contains these lines — they belong to the
          compile itself, or to a file no seam of this verb names.
        </Text>
      )}
    </Stack>
  );
}

export interface SeamCompareProps {
  /** The compiled body whose seams the hunks are attributed against. */
  body: string | undefined;
  /** Unified diff text from `/api/skills/diff`, pack-relative paths. */
  diff: string | undefined;
  /** True when the route cut the diff at its byte bound. */
  diffTruncated: boolean;
  isPending: boolean;
  error: string | null;
}

/**
 * A diff between two pack commits, each hunk placed against the seam whose
 * source it fell inside.
 *
 * Two things it must never imply. A hunk no seam contains renders as itself,
 * unattributed — that is the designed answer, not a gap. And the seams come
 * from a compile of the sources as they are NOW, so they are a map of where
 * text comes from today, laid over a change from then; the panel says so
 * where it is read rather than leaving it to a doc.
 */
export function SeamCompare({
  body,
  diff,
  diffTruncated,
  isPending,
  error,
}: SeamCompareProps) {
  const { text } = useSchemeColors();

  const attributed = useMemo(
    () => (diff === undefined ? [] : attributeDiff(diff, seamsOf(body ?? ''))),
    [diff, body]
  );
  const shown = attributed.slice(0, MAX_HUNKS);

  if (isPending) return <Skeleton height={320} data-testid="compare-loading" />;

  if (error) {
    return (
      <Alert
        variant="light"
        color="bad"
        icon={<Icons.error size={14} />}
        data-testid="compare-error"
      >
        <Text size="xs">{error}</Text>
      </Alert>
    );
  }

  return (
    <Stack gap="md" data-testid="seam-compare">
      {attributed.length === 0 ? (
        <Text size="xs" c={text.dimmed} data-testid="compare-empty">
          Nothing changed in this pack between these two commits.
        </Text>
      ) : (
        shown.map(({ hunk, seam }, i) => (
          <HunkBlock
            key={`${hunk.path}:${hunk.lines[0]}:${i}`}
            hunk={hunk}
            seam={seam}
          />
        ))
      )}

      {attributed.length > shown.length && (
        <Text size="xs" c={text.muted} data-testid="compare-hunk-cap">
          {attributed.length - shown.length} further hunks not drawn.
        </Text>
      )}
      {diffTruncated && (
        <Text size="xs" c={text.muted} data-testid="compare-truncated">
          The diff was larger than this surface reads and was cut — later
          changes are missing from the list above.
        </Text>
      )}

      <Group
        gap={6}
        wrap="nowrap"
        align="flex-start"
        pt="xs"
        style={{ borderTop: `1px solid ${SOFT_RULE}` }}
      >
        <Icons.info size={14} color={text.muted} style={{ flex: 'none' }} />
        <Text size="xs" c={text.muted}>
          A seam&apos;s line span is measured in its own source file, not in the
          compiled output — so each hunk above is placed against the file its
          header names, and the spans come from a fresh compile of today&apos;s
          sources. The step&apos;s source is in another repo and no hunk here
          can attribute to it.
        </Text>
      </Group>
    </Stack>
  );
}
