import { useMemo } from 'react';
import {
  Alert,
  Group,
  Paper,
  Skeleton,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';

import { parseSeam, type Seam } from './parseSeam';
import { QuietBadge } from './QuietBadge';
import {
  attributeHunk,
  parseDiffHunks,
  seamPackPath,
  type DiffHunk,
  type SeamSourceIndex,
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
  /** True when the hunk is this verb's own business: attributed to one of its
      seams, or inside the artifact it compiles to. Everything else is another
      verb's change that the pack-wide diff happens to include. */
  thisVerb: boolean;
}

export interface AttributedDiff {
  hunks: AttributedHunk[];
  /** Seams read out of the compiled body. Zero is a real state and a
      different one from "no seam matched" -- an rt that predates SKILLS-52
      emits seams with no `path=`/`lines=`, which parse to nothing. */
  seamCount: number;
  /** Of those, how many name a file this pack's repo actually holds. Zero
      here with a non-zero `seamCount` is the silent failure: every span
      belongs to another repo, so nothing can ever attribute. */
  placedSeamCount: number;
  attributedCount: number;
}

/**
 * Every hunk in the diff, each with the seam that contains it or null.
 *
 * Order is the diff's own within each group. The verb's own hunks lead, since
 * the panel is titled for a verb while the diff is over the whole pack; that
 * is grouping by provenance, not by health, so the spine's "health never
 * groups" law is untouched.
 */
export function attributeDiff(
  diff: string,
  seams: Seam[],
  index: SeamSourceIndex
): AttributedDiff {
  const placed = seams.map(seam => ({ seam, path: seamPackPath(seam, index) }));
  const artifactPrefix = index.artifactPath
    ? `${index.artifactPath}/`
    : `${index.packDir}/never`;

  const hunks = parseDiffHunks(diff).map(hunk => {
    const seam = attributeHunk(hunk, placed);
    const inArtifact = `${index.packDir}/${hunk.path}`.startsWith(
      artifactPrefix
    );
    return { hunk, seam, thisVerb: seam !== null || inArtifact };
  });

  return {
    hunks: [
      ...hunks.filter(h => h.thisVerb),
      ...hunks.filter(h => !h.thisVerb),
    ],
    seamCount: seams.length,
    placedSeamCount: placed.filter(p => p.path !== null).length,
    attributedCount: hunks.filter(h => h.seam !== null).length,
  };
}

function spanOf(path: string, lines: [number, number]): string {
  return `${path}:${lines[0]}-${lines[1]}`;
}

/**
 * How much of the attribution machinery actually had something to work with.
 *
 * Without this a structurally broken attribution and an honest run of
 * unattributed hunks render identically. Three distinct failures hide there:
 * a compile that emitted no parseable seams (an rt older than SKILLS-52
 * writes them without `path=`/`lines=`), a verb whose every source lives in
 * another repo, and the ordinary case where the commits simply did not touch
 * a fill.
 */
export function seamTally(result: AttributedDiff): string {
  if (result.seamCount === 0) {
    return 'No seam in this compile carries a source span, so no hunk below can be attributed.';
  }
  if (result.placedSeamCount === 0) {
    return `${result.seamCount} seams read, none of them naming a file this pack's repo holds — nothing below can attribute.`;
  }
  return `${result.attributedCount} of ${result.hunks.length} hunks matched a seam · ${result.placedSeamCount} of ${result.seamCount} seams name a file in this repo`;
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
function HunkBlock({ hunk, seam }: Pick<AttributedHunk, 'hunk' | 'seam'>) {
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
  /** The verb the panel is titled for -- the diff covers the whole pack, so
      this is what "elsewhere in this pack" is measured against. */
  verb: string;
  /** The compiled body whose seams the hunks are attributed against. */
  body: string | undefined;
  /** Unified diff text from `/api/skills/diff`, pack-relative paths. */
  diff: string | undefined;
  /** True when the route cut the diff at its byte bound. */
  diffTruncated: boolean;
  /** rt's own record of where this verb's sources are. Without it no hunk can
      be placed, so an absent index is rendered as no attribution rather than
      as no change. */
  index: SeamSourceIndex | null;
  isPending: boolean;
  error: string | null;
}

const NO_INDEX: SeamSourceIndex = {
  pack: '',
  packDir: '',
  artifactPath: null,
  stepSourcePath: null,
  fillSourcePaths: {},
};

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
  verb,
  body,
  diff,
  diffTruncated,
  index,
  isPending,
  error,
}: SeamCompareProps) {
  const { text } = useSchemeColors();

  const attributed = useMemo(
    () => attributeDiff(diff ?? '', seamsOf(body ?? ''), index ?? NO_INDEX),
    [diff, body, index]
  );
  const shown = attributed.hunks.slice(0, MAX_HUNKS);
  const ownCount = attributed.hunks.filter(h => h.thisVerb).length;
  const elsewhere = attributed.hunks.length - ownCount;

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
      <Text size="xs" c={text.muted} data-testid="seam-tally">
        {seamTally(attributed)}
      </Text>

      {attributed.hunks.length === 0 ? (
        <Text size="xs" c={text.dimmed} data-testid="compare-empty">
          Nothing changed in this pack between these two commits.
        </Text>
      ) : (
        shown.map(({ hunk, seam, thisVerb }, i) => (
          <div key={`${hunk.path}:${hunk.lines[0]}:${i}`}>
            {/* The heading sits with the first hunk it covers rather than
                above the group, so a capped list can never show it over
                nothing. */}
            {!thisVerb && i === ownCount && (
              <Text size="xs" c={text.muted} pb="md" data-testid="elsewhere">
                {elsewhere} more {elsewhere === 1 ? 'hunk' : 'hunks'} elsewhere
                in this pack — this diff covers the pack, not just {verb}.
              </Text>
            )}
            <HunkBlock hunk={hunk} seam={seam} />
          </div>
        ))
      )}

      {attributed.hunks.length > shown.length && (
        <Text size="xs" c={text.muted} data-testid="compare-hunk-cap">
          {attributed.hunks.length - shown.length} further hunks not drawn.
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
