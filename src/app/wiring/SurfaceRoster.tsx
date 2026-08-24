import { useEffect, useMemo, useState } from 'react';

import {
  Alert,
  Button,
  Drawer,
  Group,
  Paper,
  Stack,
  Switch,
  Text,
} from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import { useDrawerSurface } from './drawerSurface';
import { QuietBadge } from './QuietBadge';
import { SOFT_RULE } from './SlotRow';
import type { SkillsSurfaceRow } from './useWiring';

/** Mirrors `SurfaceDelta` from rt's `commands/skills.ts` exactly -- this is
    not a parallel type, it is the same shape the CLI already exports. */
export interface SurfaceDelta {
  toPublic: string[];
  toInternal: string[];
}

const KIND_BADGE: Record<SkillsSurfaceRow['kind'], string> = {
  compiled: 'compiled',
  'hand-authored': 'fill',
  missing: 'missing',
};

/**
 * What Apply actually does to this row, in the reader's own words -- a
 * compiled row is never git-mv'd (`runApply` skips `classify === 'compiled'`
 * entirely; going internal just deletes its directory and stops regenerating
 * it, going public compiles it into existence), so it cannot share the
 * hand-authored row's "moves to attachments/" wording without lying about
 * one of the two kinds.
 */
function effectLine(
  row: SkillsSurfaceRow,
  next: 'public' | 'internal'
): string {
  if (row.kind === 'compiled') {
    return next === 'internal'
      ? `skills/${row.name}/ stops being compiled and is removed`
      : `compiled into skills/${row.name}/`;
  }
  if (row.kind === 'missing') {
    return `${row.name} has no files on disk -- rt will reject this name`;
  }
  return next === 'public'
    ? `attachments/${row.name}/ → skills/${row.name}/`
    : `skills/${row.name}/ → attachments/${row.name}/`;
}

/** One direction of the delta as the CLI would run it. Every name going the
    same direction lands in ONE `rt skills surface set` call -- the shipped
    fix for the per-row N-compile cost -- so a whole direction is one line,
    never one line per row. */
function commandLine(
  names: string[],
  direction: 'public' | 'internal'
): string | null {
  if (names.length === 0) return null;
  // `names` is already sorted -- it comes straight out of `delta`.
  return `rt skills surface set ${names.join(' ')} --${direction}`;
}

/** Stable across re-renders with the same rows so the staging-reset effect
    below does not fire on every render -- only when the server truth the
    rows describe actually changes. */
function rowsSignature(rows: SkillsSurfaceRow[]): string {
  return rows.map(row => `${row.name}:${row.status}`).join('|');
}

interface RosterRowProps {
  row: SkillsSurfaceRow;
  next: 'public' | 'internal';
  onToggle: (name: string) => void;
}

function RosterRow({ row, next, onToggle }: RosterRowProps) {
  const { text, bg } = useSchemeColors();
  const staged = next !== row.status;

  return (
    <Group
      gap="sm"
      wrap="nowrap"
      px="sm"
      py={6}
      bg={staged ? bg.color('accent') : undefined}
      data-testid={`surface-row-${row.name}`}
    >
      <Switch
        checked={next === 'public'}
        onChange={() => onToggle(row.name)}
        aria-label={row.name}
        size="sm"
      />
      <QuietBadge>{KIND_BADGE[row.kind]}</QuietBadge>
      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" truncate>
          {row.name}
        </Text>
        {staged && (
          <Text size="xs" c={text.muted} truncate>
            {effectLine(row, next)}
          </Text>
        )}
      </Stack>
      {staged && (
        <Group gap={4} wrap="nowrap" style={{ flex: 'none' }}>
          <Text size="xs" c={text.muted}>
            {row.status}
          </Text>
          <Icons.arrowRight size={11} color={text.muted} />
          <Text size="xs" fw={600}>
            {next}
          </Text>
        </Group>
      )}
    </Group>
  );
}

export interface SurfaceRosterProps {
  pack: string;
  /** Every row's status as it is on disk right now -- the baseline the
      staged delta is computed against. Passing a fresh `rows` (after a
      successful apply, say) clears staging: it is no longer a delta
      against what is on screen. */
  rows: SkillsSurfaceRow[];
  /** `dataUpdatedAt` off the query that fetched `rows`. */
  asOf?: number;
  /** Never receives a toggle -- only ever the delta a person confirmed by
      pressing Apply. */
  onApply: (delta: SurfaceDelta) => void;
  onClose?: () => void;
  /** True while a caller's apply is in flight -- disables both buttons so a
      second click cannot start a second, concurrent apply. */
  applying?: boolean;
  /** Set by a caller after a partial failure, so the panel can say which
      direction did not land -- see the sequential apply contract. */
  applyError?: string | null;
}

/**
 * Toggling a row here writes nothing. It only moves a name into (or out of)
 * the staged delta below; the row itself keeps showing what is really on
 * disk until Apply is pressed. That is the whole safety story for a surface
 * that writes to the user's real pack, so it is pinned by a test rather than
 * left to this component's discipline alone.
 */
export function SurfaceRoster({
  pack,
  rows,
  asOf,
  onApply,
  onClose,
  applying = false,
  applyError = null,
}: SurfaceRosterProps) {
  const { text, bg, border } = useSchemeColors();
  const surface = useDrawerSurface();
  const [staged, setStaged] = useState<Map<string, 'public' | 'internal'>>(
    new Map()
  );

  const signature = rowsSignature(rows);
  useEffect(() => {
    setStaged(new Map());
  }, [signature]);

  const delta = useMemo<SurfaceDelta>(() => {
    const toPublic: string[] = [];
    const toInternal: string[] = [];
    for (const [name, status] of staged) {
      (status === 'public' ? toPublic : toInternal).push(name);
    }
    toPublic.sort();
    toInternal.sort();
    return { toPublic, toInternal };
  }, [staged]);

  function toggle(name: string) {
    const row = rows.find(r => r.name === name);
    if (!row) return;
    setStaged(prev => {
      const next = new Map(prev);
      const current = next.get(name) ?? row.status;
      const flipped = current === 'public' ? 'internal' : 'public';
      if (flipped === row.status) next.delete(name);
      else next.set(name, flipped);
      return next;
    });
  }

  const lines = [
    commandLine(delta.toPublic, 'public'),
    commandLine(delta.toInternal, 'internal'),
  ].filter((line): line is string => line !== null);

  return (
    <Drawer
      opened
      onClose={onClose ?? (() => {})}
      position="right"
      size={720}
      padding="lg"
      styles={surface}
      data-testid="surface-roster"
      title={
        <Stack gap={2}>
          <Group gap="xs" wrap="nowrap">
            <Text fz="xl" fw={700}>
              Surface
            </Text>
            <Text size="sm" c={text.muted} truncate>
              {pack}
            </Text>
          </Group>
          <Group gap={6} wrap="nowrap" style={{ color: text.dimmed }}>
            <Text size="xs" c={text.muted} ff="monospace">
              {pack}/surface.jsonc
            </Text>
            <Text size="xs" c={text.dimmed}>
              {asOf
                ? `as of ${new Date(asOf).toLocaleTimeString()}`
                : 'not yet fetched'}
            </Text>
          </Group>
        </Stack>
      }
    >
      <Stack gap="sm" style={{ height: '100%' }}>
        <Text size="xs" c={text.muted}>
          Public skills can be invoked by name. Internal ones exist only to
          compile into a verb.
        </Text>

        <Paper
          bg={bg.level3}
          radius="sm"
          style={{
            border: `1px solid ${SOFT_RULE}`,
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
          }}
        >
          {rows.map((row, i) => (
            <div
              key={row.name}
              style={
                i === 0 ? undefined : { borderTop: `1px solid ${SOFT_RULE}` }
              }
            >
              <RosterRow
                row={row}
                next={staged.get(row.name) ?? row.status}
                onToggle={toggle}
              />
            </div>
          ))}
        </Paper>

        <Stack
          gap={6}
          style={{ flex: 'none', borderTop: `1px solid ${border.default}` }}
          pt="sm"
        >
          <Group justify="space-between">
            <Text size="xs" c={text.muted}>
              {staged.size === 0
                ? 'Nothing staged'
                : `${staged.size} staged — nothing is written until you apply`}
            </Text>
            <Group gap={6}>
              <Button
                size="xs"
                variant="default"
                disabled={staged.size === 0 || applying}
                onClick={() => setStaged(new Map())}
              >
                Discard
              </Button>
              <Button
                size="xs"
                disabled={staged.size === 0 || applying}
                loading={applying}
                onClick={() => onApply(delta)}
              >
                Apply
              </Button>
            </Group>
          </Group>

          {lines.length > 0 && (
            <Paper
              bg={bg.level3}
              radius="sm"
              p="xs"
              style={{ border: `1px solid ${SOFT_RULE}` }}
            >
              <Text
                size="xs"
                ff="monospace"
                style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {lines.join('\n')}
              </Text>
            </Paper>
          )}

          {applyError && (
            <Alert variant="light" color="bad" icon={<Icons.error size={14} />}>
              <Text size="xs">{applyError}</Text>
            </Alert>
          )}

          <Group gap={6} wrap="nowrap" align="flex-start">
            <Icons.info
              size={14}
              color={text.muted}
              style={{ marginTop: 2, flex: 'none' }}
            />
            <Text size="xs" c={text.muted}>
              Each command rewrites surface.jsonc once and then recompiles the
              pack. A change in both directions is two commands, run in order —
              if the second fails the first has already landed, and this panel
              re-reads from disk to show what did.
            </Text>
          </Group>
        </Stack>
      </Stack>
    </Drawer>
  );
}
