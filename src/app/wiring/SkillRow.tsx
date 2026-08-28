import type { KeyboardEvent } from 'react';
import {
  Badge,
  Group,
  Stack,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';

import { HEALTH_COLOR, HealthChip } from './HealthChip';
import type { SpineEntry, WiringHealth } from './outline';
import { QuietBadge } from './QuietBadge';
import classes from './SkillRow.module.css';

/** Only the two states a reader has to act on carry a badge. `in-sync` is
    the quiet answer, and `unknown` is rt having said nothing about this ref
    -- neither earns a label. */
const HEALTH_BADGE: Partial<Record<WiringHealth, string>> = {
  'source-newer': 'source newer',
  'never-compiled': 'never compiled',
};

/**
 * What the health state means for THIS row, said in the row rather than in a
 * legend. `check` reports which files it found newer, so the drift line names
 * them instead of guessing at "SKILL.md".
 */
function healthLines(entry: SpineEntry): string[] {
  const lines: string[] = [];

  if (entry.external) {
    lines.push("binds this pack's fills; nothing in the roster names these");
  }
  if (entry.health === 'source-newer') {
    const files =
      entry.staleFiles.length > 0
        ? entry.staleFiles.join(', ')
        : 'the artifact';
    lines.push(
      `${files} on disk is older than its sources — Claude is reading the previous compile`
    );
  }
  if (entry.health === 'never-compiled') {
    lines.push(
      entry.kind === 'stage'
        ? 'no artifact on disk — this stage will not load when the pipeline reaches it'
        : 'no artifact on disk — this skill will not load when it is invoked'
    );
  }
  if (entry.note) lines.push(entry.note);
  if (entry.engineError) lines.push(entry.engineError);

  return lines;
}

/** `1 slot` / `2 slots` / `no slots` -- the compact count the slim row shows
    in place of the slot table it no longer renders inline. */
function slotCountLabel(count: number): string {
  if (count === 0) return 'no slots';
  return count === 1 ? '1 slot' : `${count} slots`;
}

export interface SkillRowProps {
  entry: SpineEntry;
  /** Outside-the-pipeline rows carry no step number, so health rides a dot
      in front of the name instead of the timeline bullet. */
  withDot?: boolean;
  /** Renders the compact ONE-LINE pipeline row (`Main.dc.html` parity) in
      place of the outside-the-pipeline stacked layout. The orchestrator and
      numbered stages are slim; outside-the-pipeline rows are not (Task 3
      owns that section's redesign). */
  slim?: boolean;
  /** Opens this entry's detail panel. The whole row (slim or stacked) becomes
      the click/keyboard target when given; the per-skill actions that used to
      sit on the row now live in the panel header. */
  onOpen?: () => void;
  /** The mini-list shape the split view draws on the left while a panel is
      open (`Detail.dc.html` `.mini`): name + a health dot only, no slot count
      and no chevron. Implies `slim`. */
  compact?: boolean;
  /** The row whose panel is open, in the compact mini-list: outlined in the
      full accent (`Detail.dc.html` `.mini.sel`). */
  selected?: boolean;
}

/** The mini-list's health tell: a bare dot for a measured state, a muted dot
    for `unknown` -- the compact row has no room for the label `HealthChip`
    carries, so the dot stands alone. */
function HealthDot({ health }: { health: WiringHealth }) {
  const { text } = useSchemeColors();
  const color = HEALTH_COLOR[health];
  return (
    <div
      aria-hidden
      data-testid="health-dot"
      style={{
        width: 7,
        height: 7,
        borderRadius: '50%',
        flex: 'none',
        background: color ? text.highContrast(color) : text.dimmed,
      }}
    />
  );
}

/**
 * One skill's row: what it is, what state it is in, and every slot it opens.
 * Health indicates ON the row -- it never groups the rows, never sorts them,
 * and never takes the place of a stage's number.
 */
export function SkillRow({
  entry,
  withDot = false,
  slim = false,
  onOpen,
  compact = false,
  selected = false,
}: SkillRowProps) {
  const { text } = useSchemeColors();

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onOpen) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen();
    }
  };

  if (compact) {
    const inner = (
      <>
        <Text
          fw={selected ? 700 : 600}
          size="md"
          truncate
          style={{ flex: 1, minWidth: 0 }}
        >
          {entry.label}
        </Text>
        <HealthDot health={entry.health} />
      </>
    );

    if (!onOpen) {
      return (
        <Group
          gap="sm"
          wrap="nowrap"
          align="center"
          px="sm"
          py="xs"
          data-testid={`skill-row-${entry.key}`}
        >
          {inner}
        </Group>
      );
    }

    return (
      <UnstyledButton
        className={classes.row}
        mod={{ selected }}
        onClick={onOpen}
        aria-label={`open ${entry.label}`}
        data-testid={`skill-row-${entry.key}`}
      >
        {inner}
      </UnstyledButton>
    );
  }

  if (slim) {
    const inner = (
      <>
        <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <Text fw={700} size="lg" style={{ flex: 'none' }}>
            {entry.label}
          </Text>
          {entry.ref && (
            <Text size="sm" c={text.muted} truncate style={{ minWidth: 0 }}>
              {entry.ref}
            </Text>
          )}
          {entry.kind === 'orchestrator' && (
            <Badge
              size="xs"
              variant="light"
              color="accent"
              style={{ flex: 'none' }}
            >
              orchestrator
            </Badge>
          )}
          {entry.external && (
            <Badge
              size="xs"
              variant="light"
              color="purple"
              style={{ flex: 'none' }}
            >
              another plugin
            </Badge>
          )}
          {entry.kind === 'outside' && !entry.external && !entry.invocable && (
            <QuietBadge>internal</QuietBadge>
          )}
          {entry.unwired && <QuietBadge>unwired</QuietBadge>}
          {entry.sameWiringAsStep !== undefined && (
            <QuietBadge>
              same wiring as stage {entry.sameWiringAsStep}
            </QuietBadge>
          )}
        </Group>
        <Text
          size="sm"
          c={text.muted}
          style={{ flex: 'none', whiteSpace: 'nowrap' }}
        >
          {slotCountLabel(entry.slots.length)}
        </Text>
        <HealthChip health={entry.health} />
        <Icons.chevronRight
          size={16}
          color={text.muted}
          aria-hidden
          style={{ flex: 'none' }}
        />
      </>
    );

    // Only a row that opens something is a button; a display-only row is a
    // plain padded Group (no hover, not focusable).
    if (!onOpen) {
      return (
        <Group
          gap="sm"
          wrap="nowrap"
          align="center"
          px="sm"
          py="xs"
          data-testid={`skill-row-${entry.key}`}
        >
          {inner}
        </Group>
      );
    }

    return (
      <UnstyledButton
        className={classes.row}
        mod={{ selected }}
        onClick={onOpen}
        aria-label={`open ${entry.label}`}
        data-testid={`skill-row-${entry.key}`}
      >
        {inner}
      </UnstyledButton>
    );
  }

  const badge = HEALTH_BADGE[entry.health];
  const color = HEALTH_COLOR[entry.health];
  const lines = healthLines(entry);

  return (
    <Stack gap={1} data-testid={`skill-row-${entry.key}`}>
      <Group
        gap="sm"
        wrap="nowrap"
        align="flex-start"
        role={onOpen ? 'button' : undefined}
        tabIndex={onOpen ? 0 : undefined}
        onClick={onOpen}
        onKeyDown={onOpen ? handleKeyDown : undefined}
        aria-label={onOpen ? `open ${entry.label}` : undefined}
        style={{ cursor: onOpen ? 'pointer' : undefined }}
      >
        <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" wrap="nowrap">
            {withDot && (
              <div
                aria-hidden
                data-testid="health-dot"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  flex: 'none',
                  background: color ? text.highContrast(color) : text.dimmed,
                }}
              />
            )}
            <Text fw={600} size="lg">
              {entry.label}
            </Text>
            {entry.ref && (
              <Text size="sm" c={text.muted} truncate>
                {entry.ref}
              </Text>
            )}
            {entry.kind === 'orchestrator' && (
              <QuietBadge>orchestrator</QuietBadge>
            )}
            {badge && color && (
              <Badge
                size="sm"
                variant="light"
                color={color}
                data-testid="health-badge"
              >
                {badge}
              </Badge>
            )}
            {entry.external && (
              <Badge size="sm" variant="light" color="purple">
                another plugin
              </Badge>
            )}
            {entry.kind === 'outside' &&
              !entry.external &&
              !entry.invocable && <QuietBadge>internal</QuietBadge>}
            {entry.unwired && <QuietBadge>unwired</QuietBadge>}
            {entry.sameWiringAsStep !== undefined && (
              <QuietBadge>
                same wiring as stage {entry.sameWiringAsStep}
              </QuietBadge>
            )}
          </Group>
          {lines.map(line => (
            <Text key={line} size="xs" c={text.muted}>
              {line}
            </Text>
          ))}
        </Stack>
        {onOpen && (
          <Icons.chevronRight
            size={16}
            color={text.muted}
            aria-hidden
            style={{ flex: 'none' }}
          />
        )}
      </Group>
    </Stack>
  );
}
