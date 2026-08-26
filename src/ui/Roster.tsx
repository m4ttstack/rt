import { Fragment } from 'react';
import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import type { BuddyStatus, PresenceRow } from '@mattstack/rt-client';

import { Icon } from '@ui/icons';
import { STATUS_WORD, statusDetail } from './statusDetail';

/** `/api/chat/buddies`' own shape: the daemon's `PresenceRow` plus the
    status it joins on, plus the room tags `chat.ts`'s handler inverts from
    a `who` call per room -- the only three fields this component ever adds
    on top of the wire type. */
export type RosterBuddy = PresenceRow & {
  status: BuddyStatus;
  rooms: string[];
};

export interface RosterProps {
  buddies: RosterBuddy[];
  /** A prop, not `Date.now()` internally, so relative times are testable
      without fake timers -- the same seam `DaemonBanner`'s `now` is. */
  now: number;
  /** The current room's members (a DM's two participants, or a channel's
      roster) -- what turns a click into "insert @handle" vs "DM instead". */
  roomMembers: string[];
  /** Withholds every presence claim when false: Task 4's rule, not
      re-derived here. @default true */
  daemonReachable?: boolean;
  /** Drops the path line for the phone drawer (Task 7). @default false */
  compact?: boolean;
  onPick?: (handle: string, info: { inRoom: boolean }) => void;
}

const SECTIONS: ReadonlyArray<{ status: BuddyStatus; label: string }> = [
  { status: 'live', label: STATUS_WORD.live },
  { status: 'idle', label: STATUS_WORD.idle },
  { status: 'deaf', label: STATUS_WORD.deaf },
  { status: 'offline', label: 'offline · last 24h' },
];

const STATUS_TEXT_COLOR: Record<'live' | 'idle' | 'deaf', string> = {
  live: 'var(--mantine-color-ok-text)',
  idle: 'var(--mantine-color-warn-text)',
  deaf: 'var(--mantine-color-bad-text)',
};

const DOT_COLOR: Record<'live' | 'idle' | 'deaf', string> = {
  live: 'var(--tk-dot-ok)',
  idle: 'var(--tk-dot-warn)',
  deaf: 'var(--tk-dot-bad)',
};

/**
 * `…/mr-board-wt-invite-onboarding`: the leaf directory, always -- real
 * text, not a `direction: rtl` overflow trick. That CSS technique assumes
 * the FULL path is still in the DOM and lets the browser paint the
 * ellipsis at render time; it never touches `textContent`, so it cannot
 * produce the literal "…/leaf" a test (or a reader with no live layout,
 * e.g. a screen reader) can see. Applying `direction: rtl` on TOP of this
 * already-short, already-correct string reverses it visually instead
 * ("leaf/…") -- confirmed against a real render, not merely reasoned
 * about, which is why it is deliberately absent below. `truncate` alone is
 * the safety net for a leaf name that is itself wider than the column.
 */
function headTruncatePath(cwd: string): string {
  const segments = cwd.split('/').filter(Boolean);
  const leaf = segments.at(-1) ?? cwd;
  return `…/${leaf}`;
}

function Dot({
  hollow,
  color,
  testId,
}: {
  hollow: boolean;
  color?: string;
  testId: string;
}) {
  return (
    <Box
      data-testid={testId}
      style={{
        width: 8,
        height: 8,
        marginTop: 6,
        flex: 'none',
        borderRadius: '50%',
        background: hollow ? 'transparent' : color,
        border: hollow ? '1px solid var(--tk-border)' : undefined,
      }}
    />
  );
}

function Tag({ handle, room }: { handle: string; room: string }) {
  const isDm = room === 'dm';
  return (
    <Box
      component="span"
      data-testid={`tag-${handle}-${room}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 14,
        padding: '0 5px',
        borderRadius: 7,
        fontSize: '8.5px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        border: `1px solid ${
          isDm
            ? 'color-mix(in srgb, var(--tk-purple) 45%, transparent)'
            : 'var(--tk-border-soft)'
        }`,
        color: isDm ? 'var(--tk-purple)' : 'var(--tk-muted)',
      }}
    >
      {isDm ? 'dm' : `#${room}`}
    </Box>
  );
}

function SectionHeading({
  status,
  label,
  count,
}: {
  status: BuddyStatus;
  label: string;
  count: number;
}) {
  return (
    <Box
      component="h3"
      data-testid={`section-${status}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        margin: 0,
        padding: '8px 0 4px',
      }}
    >
      <Text
        component="span"
        data-testid={`section-label-${status}`}
        fw={700}
        style={{
          fontSize: '9.5px',
          letterSpacing: '0.06em',
          color: 'var(--tk-muted)',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>{' '}
      <Text
        component="span"
        style={{ fontSize: '10.56px', color: 'var(--tk-muted)' }}
      >
        {count}
      </Text>
      <Box
        style={{ flex: 1, height: 1, background: 'var(--tk-border-soft)' }}
      />
    </Box>
  );
}

/** `branch · pane N` -- either half omitted cleanly when absent. */
function branchPaneLine(buddy: RosterBuddy): string | undefined {
  const parts = [
    buddy.branch,
    buddy.pane !== undefined ? `pane ${buddy.pane}` : undefined,
  ].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function MemberRow({
  buddy,
  now,
  reachable,
  inRoom,
  compact,
  onPick,
}: {
  buddy: RosterBuddy;
  now: number;
  reachable: boolean;
  inRoom: boolean;
  compact: boolean;
  onPick?: (handle: string, info: { inRoom: boolean }) => void;
}) {
  const { handle } = buddy;
  const status = buddy.status as 'live' | 'idle' | 'deaf';
  const branchPane = branchPaneLine(buddy);

  return (
    <UnstyledButton
      data-testid={`row-${handle}`}
      onClick={() => onPick?.(handle, { inRoom })}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--mantine-spacing-sm)',
        padding: 'var(--mantine-spacing-sm) 0',
        width: '100%',
        minWidth: 0,
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <Dot
        hollow={!reachable}
        color={DOT_COLOR[status]}
        testId={`dot-${handle}`}
      />
      <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
        <Group gap="sm" wrap="nowrap">
          <Text size="sm" fw={600} truncate>
            {handle}
          </Text>
          <Text
            component="span"
            data-testid={`status-${handle}`}
            style={{
              fontSize: '10.56px',
              fontWeight: 500,
              color: reachable ? STATUS_TEXT_COLOR[status] : 'var(--tk-muted)',
            }}
          >
            {reachable ? STATUS_WORD[buddy.status] : '—'}
          </Text>
        </Group>

        {reachable && buddy.statusText && (
          <Text
            component="span"
            data-testid={`away-${handle}`}
            style={{
              fontSize: '10.56px',
              color: 'var(--tk-muted)',
              fontStyle: 'italic',
            }}
          >
            “{buddy.statusText}”
          </Text>
        )}

        {branchPane && (
          <Text size="xs" c="dimmed" truncate>
            {branchPane}
          </Text>
        )}

        {!compact && buddy.cwd && (
          <Text size="xs" c="dimmed" truncate>
            {headTruncatePath(buddy.cwd)}
          </Text>
        )}

        <Text
          component="span"
          data-testid={`sub-${handle}`}
          style={{ fontSize: '10.56px', color: 'var(--tk-muted)' }}
        >
          {reachable
            ? statusDetail(buddy, now)
            : 'presence unknown while the daemon is down'}
        </Text>

        {reachable && buddy.rooms.length > 0 && (
          <Group gap={3} wrap="wrap" style={{ paddingTop: 2 }}>
            {buddy.rooms.map(room => (
              <Tag key={room} handle={handle} room={room} />
            ))}
          </Group>
        )}
      </Stack>
    </UnstyledButton>
  );
}

/** Offline is stale by definition: handle plus "signed out Nh ago" on the
    row itself, no sub-line, no branch/pane/path/tags. */
function OfflineRow({ buddy, now }: { buddy: RosterBuddy; now: number }) {
  return (
    <Box
      data-testid={`row-${buddy.handle}`}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--mantine-spacing-sm)',
        padding: 'var(--mantine-spacing-sm) 0',
        minWidth: 0,
        opacity: 0.55,
        cursor: 'default',
      }}
    >
      <Dot hollow testId={`dot-${buddy.handle}`} />
      <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" fw={600} truncate>
          {buddy.handle}
        </Text>
        <Text size="xs" c="dimmed">
          {statusDetail(buddy, now)}
        </Text>
      </Stack>
    </Box>
  );
}

/**
 * The fleet, not the room: every signed-in agent session, grouped into the
 * four sections the spec fixes the order of. Sections are the sort -- a
 * buddy's status IS the question this panel answers, so nothing inside a
 * section re-sorts by anything but `signedInAt`.
 *
 * `daemonReachable={false}` withholds every presence claim (status word,
 * sub-line, away message, tags, dot colour) and drops the offline section
 * entirely -- a cached "offline" is still a claim about the present. See
 * `statusDetail.ts`: this component renders the daemon's verdict, never
 * derives one.
 */
export function Roster({
  buddies,
  now,
  roomMembers,
  daemonReachable = true,
  compact = false,
  onPick,
}: RosterProps) {
  const sections = SECTIONS.filter(
    s => s.status !== 'offline' || daemonReachable
  ).map(section => ({
    ...section,
    members: buddies
      .filter(b => b.status === section.status)
      .sort((a, b) => a.signedInAt - b.signedInAt),
  }));

  return (
    <Stack
      gap={0}
      data-testid="roster"
      style={{
        // `compact` (the phone drawer): fluid width, no card of its own --
        // the drawer body IS the surface, and the drawer's own "BUDDIES /
        // tap to mention or DM" row replaces the header this renders below.
        width: compact ? '100%' : 300,
        flex: compact ? 1 : 'none',
        alignSelf: 'stretch',
        minWidth: 0,
        background: compact ? undefined : 'var(--tk-panel)',
        border: compact ? undefined : '1px solid var(--tk-border)',
        borderRadius: compact ? undefined : 'var(--mantine-radius-md)',
        padding: compact
          ? undefined
          : 'var(--mantine-spacing-lg) var(--mantine-spacing-md)',
        overflowY: 'auto',
      }}
    >
      {!compact && (
        <Group
          justify="space-between"
          wrap="nowrap"
          style={{
            paddingBottom: 'var(--mantine-spacing-sm)',
            borderBottom: '1px solid var(--tk-border-soft)',
          }}
        >
          <Group gap={6} wrap="nowrap">
            <Icon
              name="users"
              size={14}
              color="var(--tk-muted)"
              style={{ flex: 'none' }}
            />
            <Text
              component="h2"
              style={{
                margin: 0,
                fontSize: '10.56px',
                fontWeight: 600,
                letterSpacing: '0.04em',
                color: 'var(--tk-muted)',
              }}
            >
              BUDDIES
            </Text>
          </Group>
          <Text style={{ fontSize: '10.56px', color: 'var(--tk-muted)' }}>
            {daemonReachable ? 'the fleet, not the room' : 'last known'}
          </Text>
        </Group>
      )}

      {sections.map(section => (
        <Fragment key={section.status}>
          <SectionHeading
            status={section.status}
            label={section.label}
            count={section.members.length}
          />
          {section.members.map(buddy =>
            section.status === 'offline' ? (
              <OfflineRow key={buddy.handle} buddy={buddy} now={now} />
            ) : (
              <MemberRow
                key={buddy.handle}
                buddy={buddy}
                now={now}
                reachable={daemonReachable}
                inRoom={roomMembers.includes(buddy.handle)}
                compact={compact}
                onPick={onPick}
              />
            )
          )}
        </Fragment>
      ))}
    </Stack>
  );
}
