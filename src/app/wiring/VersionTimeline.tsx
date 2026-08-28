import { useEffect, useMemo, useState } from 'react';

import {
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  Group,
  Paper,
  Skeleton,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import { CommandProvenance } from '../runs/CommandProvenance';
import type { SlotOutlineNode, WiringHealth } from './outline';
import { QuietBadge } from './QuietBadge';
import type { SeamSourceIndex } from './seamAttribution';
import { SeamCompare } from './SeamCompare';
import { SOFT_RULE } from './SlotRow';
import {
  useCompilePreview,
  useSkillsDiff,
  useSkillsHistory,
} from './useWiring';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'always' });

/**
 * A commit's age in words. `numeric: 'always'` on purpose: "yesterday" and
 * "last month" read as prose beside a sha, and a timeline of restamps is
 * scanned for distance, not for dates.
 *
 * An unparseable stamp answers with the raw text rather than a wrong age --
 * `%aI` cannot produce one, but a truncated read of the log can.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;

  const delta = at - now;
  const ago = Math.abs(delta);
  const [unit, size]: [Intl.RelativeTimeFormatUnit, number] =
    ago < HOUR
      ? ['minute', MINUTE]
      : ago < DAY
        ? ['hour', HOUR]
        : ago < MONTH
          ? ['day', DAY]
          : ago < YEAR
            ? ['month', MONTH]
            : ['year', YEAR];

  if (ago < MINUTE) return 'just now';
  return RELATIVE.format(Math.round(delta / size), unit);
}

/** The three theme colours a runtime dot can take. They are the Mantine
    colour names too, so a dot and the spine bullet for the same state read
    the same ramp. */
type DotColor = 'ok' | 'warn' | 'bad';

/** What `rt skills check` said about this verb's artifact, in the words this
    panel needs. Never invents a healthy answer: `unknown` is rt having said
    nothing, which is not the same as in-sync. */
function compiledOutputFact(
  health: WiringHealth,
  staleFiles: string[]
): { text: string; color: DotColor | null } {
  switch (health) {
    case 'in-sync':
      return { text: 'matches its sources', color: 'ok' };
    case 'source-newer':
      return {
        text: `${staleFiles.length > 0 ? staleFiles.join(', ') : 'the artifact'} on disk is older than its sources`,
        color: 'warn',
      };
    case 'never-compiled':
      return { text: 'no artifact on disk', color: 'bad' };
    default:
      return {
        text: 'rt skills check said nothing about this verb',
        color: null,
      };
  }
}

/**
 * One momentary fact. `color` absent means the fact carries no health at all
 * (a version number is neither good nor bad); `null` means it has one and it
 * was not measured, which is a different row from a healthy one.
 */
function RuntimeRow({
  label,
  color,
  children,
  first,
}: {
  label: string;
  color?: DotColor | null;
  children: string;
  first?: boolean;
}) {
  const { text } = useSchemeColors();

  return (
    <Group
      gap="sm"
      wrap="nowrap"
      px="sm"
      py={6}
      style={first ? undefined : { borderTop: `1px solid ${SOFT_RULE}` }}
      data-testid={`runtime-${label.replace(/\s+/g, '-')}`}
    >
      <Text size="sm" fw={600} w={148} style={{ flex: 'none' }}>
        {label}
      </Text>
      {color !== undefined && (
        <div
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            flex: 'none',
            background: color ? text.highContrast(color) : text.dimmed,
          }}
        />
      )}
      <Text size="sm" truncate style={{ flex: 1 }}>
        {children}
      </Text>
    </Group>
  );
}

export interface VersionTimelineProps {
  pack: string;
  /** The roster verb whose history this is; `null` renders nothing (a
      verb-less entry -- a pipeline stage -- has no artifact with a history). */
  verb: string | null;
  /** The verb's ref, for the panel heading. */
  refName: string | null;
  /** What `check` said about this verb, for the runtime region. */
  health: WiringHealth;
  staleFiles: string[];
  /** rt's ABSOLUTE paths for this verb's step source and its compiled
      artifact. The compare view places seams by these rather than by matching
      a plugin-relative seam path against a pack-relative diff path -- see
      `seamPackPath`. */
  sourcePath: string | null;
  artifactPath: string | null;
  slots: SlotOutlineNode[];
}

/**
 * A verb's pack history, and — on selecting two commits — the diff between
 * them with each hunk placed against the seam it fell inside. Folded out of
 * its old drawer into the detail panel's "History" tab.
 *
 * The panel's one structural rule: runtime facts and git history are two
 * regions on two surfaces, never one list. A commit row and a "working tree
 * is dirty" row look alike and mean nothing alike — one is ordered, immutable
 * and attributable, the other is momentary and true only of this machine.
 */
export function VersionTimeline({
  pack,
  verb,
  refName,
  health,
  staleFiles,
  sourcePath,
  artifactPath,
  slots,
}: VersionTimelineProps) {
  const { bg, text } = useSchemeColors();
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState<{
    from: string;
    to: string;
  } | null>(null);

  // A selection is about one verb's commits; carrying it to the next verb
  // would offer a compare between shas that never appeared in this list.
  useEffect(() => {
    setSelected([]);
    setComparing(null);
  }, [verb]);

  const history = useSkillsHistory(pack, verb);
  const commits = useMemo(() => history.data?.commits ?? [], [history.data]);
  const runtime = history.data?.runtime;

  const diff = useSkillsDiff(
    pack,
    comparing?.from ?? null,
    comparing?.to ?? null
  );
  // Only while comparing: the seams come from a fresh compile, which costs a
  // subprocess nobody browsing history should pay for.
  const preview = useCompilePreview(
    pack,
    comparing ? (verb ?? undefined) : undefined
  );

  const toggle = (sha: string) =>
    setSelected(current =>
      current.includes(sha) ? current.filter(s => s !== sha) : [...current, sha]
    );

  const compare = () => {
    // git lists newest first, so the later index is the older end.
    const [a, b] = selected.map(sha => commits.findIndex(c => c.sha === sha));
    if (a === -1 || b === -1) return;
    const older = commits[Math.max(a, b)];
    const newer = commits[Math.min(a, b)];
    setComparing({ from: older.shortSha, to: newer.shortSha });
  };

  const scope = history.data?.scope ?? `skills/${verb}`;
  const dirty = runtime?.dirtyFiles ?? null;
  const compiled = compiledOutputFact(health, staleFiles);

  // `packDir` comes off the diff payload, so the index is only complete once
  // the diff it places hunks for has landed.
  const index = useMemo<SeamSourceIndex | null>(
    () =>
      diff.data
        ? {
            pack,
            packDir: diff.data.packDir,
            artifactPath,
            stepSourcePath: sourcePath,
            fillSourcePaths: Object.fromEntries(
              slots.map(slot => [slot.name, slot.fillSourcePath])
            ),
          }
        : null,
    [diff.data, pack, artifactPath, sourcePath, slots]
  );

  if (verb === null) return null;

  return (
    <Stack gap="lg" data-testid="version-timeline">
      <Group gap="xs" wrap="nowrap" align="flex-start">
        {comparing && (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={() => setComparing(null)}
            aria-label="Back to history"
            style={{ flex: 'none', marginTop: 2 }}
          >
            <Icons.arrowLeft size={16} />
          </ActionIcon>
        )}
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" wrap="nowrap">
            <Text fz="xl" fw={700}>
              {verb}
            </Text>
            {comparing ? (
              <>
                <Text size="sm" c={text.muted} style={{ flex: 'none' }}>
                  {comparing.from}
                </Text>
                <Icons.arrowRight size={12} color={text.muted} />
                <Text size="sm" c={text.muted} style={{ flex: 'none' }}>
                  {comparing.to}
                </Text>
              </>
            ) : (
              refName && (
                <Text size="sm" c={text.muted} truncate>
                  {refName}
                </Text>
              )
            )}
          </Group>
          <CommandProvenance
            command={
              comparing
                ? `git diff ${comparing.from}..${comparing.to} -- .`
                : `git log -- ${scope}`
            }
            asOf={
              (comparing ? diff.dataUpdatedAt : history.dataUpdatedAt) ||
              undefined
            }
          />
        </Stack>
      </Group>

      {comparing ? (
        <Stack gap="md">
          {preview.isError && (
            <Alert
              variant="light"
              color="warn"
              icon={<Icons.warning size={14} />}
              data-testid="no-seams"
            >
              <Text size="xs">
                No compiled body for this verb, so no hunk below can be
                attributed to a seam: {(preview.error as Error).message}
              </Text>
            </Alert>
          )}
          <SeamCompare
            verb={verb ?? ''}
            body={preview.data?.content}
            diff={diff.data?.diff}
            diffTruncated={diff.data?.truncated ?? false}
            index={index}
            isPending={diff.isPending || preview.isPending}
            error={diff.isError ? (diff.error as Error).message : null}
          />
        </Stack>
      ) : (
        <Stack gap="lg">
          <Stack gap="xs">
            <Text size="xs" c={text.muted}>
              Right now — this machine, not history
            </Text>
            <Paper
              bg={bg.level3}
              radius="sm"
              style={{ border: `1px solid ${SOFT_RULE}` }}
              data-testid="runtime-facts"
            >
              <RuntimeRow
                first
                label="working tree"
                color={
                  dirty === null ? null : dirty.length === 0 ? 'ok' : 'warn'
                }
              >
                {dirty === null
                  ? 'not measured — git status did not answer'
                  : dirty.length === 0
                    ? `clean under ${scope}`
                    : `${dirty.length}${runtime?.moreDirtyFiles ? '+' : ''} uncommitted ${dirty.length === 1 ? 'file' : 'files'} under ${scope}`}
              </RuntimeRow>
              {/* Not `installed`: what was read is the pack's own
                  `.claude-plugin/plugin.json`. The version Claude will load
                  lives in the plugin cache, which this request never opened,
                  and the two can differ between an edit and its install. */}
              <RuntimeRow label="pack manifest">
                {runtime?.packVersion
                  ? `declares ${pack} ${runtime.packVersion}`
                  : 'no plugin manifest in this pack — nothing states a version'}
              </RuntimeRow>
              <RuntimeRow label="compiled output" color={compiled.color}>
                {compiled.text}
              </RuntimeRow>
            </Paper>
          </Stack>

          <Stack gap="xs">
            <Group justify="space-between" wrap="nowrap">
              <Text size="xs" c={text.muted} data-testid="history-count">
                History — {commits.length} of {history.data?.limit ?? 0}{' '}
                requested
              </Text>
              <Button
                size="xs"
                disabled={selected.length !== 2}
                onClick={compare}
                data-testid="compare-commits"
              >
                Compare 2 commits
              </Button>
            </Group>

            {history.isPending && <Skeleton height={240} />}
            {history.isError && (
              <Alert
                variant="light"
                color="bad"
                icon={<Icons.error size={14} />}
                data-testid="history-error"
              >
                <Text size="xs">{(history.error as Error).message}</Text>
              </Alert>
            )}
            {history.data && commits.length === 0 && (
              <Text size="xs" c={text.dimmed} data-testid="history-empty">
                No commit in this repo has touched {scope}.
              </Text>
            )}

            {commits.length > 0 && (
              <Paper
                bg={bg.level3}
                radius="sm"
                style={{ border: `1px solid ${SOFT_RULE}` }}
                data-testid="commit-list"
              >
                {commits.map((commit, i) => (
                  <div
                    key={commit.sha}
                    style={{
                      padding: '7px var(--mantine-spacing-sm)',
                      background: selected.includes(commit.sha)
                        ? bg.color('accent')
                        : undefined,
                      borderTop: i === 0 ? undefined : `1px solid ${SOFT_RULE}`,
                    }}
                    data-testid={`commit-${commit.shortSha}`}
                  >
                    <Checkbox
                      size="xs"
                      checked={selected.includes(commit.sha)}
                      onChange={() => toggle(commit.sha)}
                      styles={{
                        body: { alignItems: 'flex-start' },
                        labelWrapper: { flex: 1, minWidth: 0 },
                      }}
                      aria-label={`select ${commit.shortSha}`}
                      label={
                        <Stack gap={1} style={{ minWidth: 0 }}>
                          <Group gap="xs" wrap="nowrap">
                            <Text size="sm" fw={600} style={{ flex: 'none' }}>
                              {commit.shortSha}
                            </Text>
                            <Text
                              size="xs"
                              c={text.muted}
                              style={{ flex: 'none' }}
                            >
                              {relativeTime(commit.authoredAt)}
                            </Text>
                            {i === 0 && <QuietBadge>newest</QuietBadge>}
                          </Group>
                          <Text size="sm" truncate>
                            {commit.subject}
                          </Text>
                          <Text size="xs" c={text.muted} truncate>
                            {commit.files.join(', ')}
                          </Text>
                        </Stack>
                      }
                    />
                  </div>
                ))}
              </Paper>
            )}

            {history.data?.truncated && (
              <Text size="xs" c={text.muted} data-testid="history-truncated">
                The repo holds more history than this list bounds.
              </Text>
            )}
          </Stack>

          <Group gap={6} wrap="nowrap" align="flex-start">
            <Icons.info size={14} color={text.muted} style={{ flex: 'none' }} />
            <Text size="xs" c={text.muted}>
              This pack&apos;s repo holds the fills and the compiled output. The
              step&apos;s own source lives in the mattstack plugin, a different
              repo — its changes are not in this list.
            </Text>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
