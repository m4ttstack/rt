import { Fragment } from 'react';
import {
  Box,
  Group,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { BuddyStatus, PresenceRow } from '@mattstack/rt-client';

import { AgentName } from './AgentName';
import { DOT_COLOR } from './presence-bits';
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
  /** The desktop right column: edge-to-edge panel on the sidebar surface,
      a hairline on its left, no card. */
  panel?: boolean;
  onPick?: (handle: string, info: { inRoom: boolean }) => void;
}

const OFFLINE_LABEL = 'offline · last 24h';

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
          fontSize: 'var(--tk-fs-4xs)',
          letterSpacing: '0.06em',
          color: 'var(--tk-muted-text)',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>{' '}
      <Text
        component="span"
        style={{
          fontSize: 'var(--tk-fs-3xs)',
          color: 'var(--tk-muted-text)',
        }}
      >
        {count}
      </Text>
      <Box
        style={{ flex: 1, height: 1, background: 'var(--tk-border-soft)' }}
      />
    </Box>
  );
}

/** One line per buddy, the way a buddy list reads: dot, handle, status,
    and the away message when there is one. Where it is (branch, pane,
    path), its heartbeat and its rooms are a hover away in the detail card,
    not on the row: five lines of 10px per buddy was the whole roster
    shouting at once. The phone drawer has no hover, so its rows carry the
    heartbeat line and nothing else. */
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
  const status = buddy.status as 'live' | 'idle';
  const statusLabel = reachable
    ? `${STATUS_WORD[buddy.status]} · ${statusDetail(buddy, now)}`
    : 'presence withheld while the daemon is down';
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
      {/* The dot is the status; the word moved off the row into a tooltip
          (and the card header) so a long `name • repo` has the width. */}
      <Tooltip
        label={statusLabel}
        position="left"
        openDelay={300}
        withArrow
        disabled={compact}
      >
        <Box
          component="span"
          data-testid={`status-${handle}`}
          aria-label={statusLabel}
          style={{ display: 'inline-flex', flex: 'none' }}
        >
          <Dot
            hollow={!reachable}
            color={DOT_COLOR[status]}
            testId={`dot-${handle}`}
          />
        </Box>
      </Tooltip>
      <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
        <AgentName
          handle={handle}
          variant="row"
          buddy={buddy}
          reachable={reachable}
          now={now}
          inRoom={inRoom}
          withCard={!compact}
        />
        {compact && (
          <Text
            component="span"
            data-testid={`sub-${handle}`}
            style={{
              fontSize: 'var(--tk-fs-3xs)',
              color: 'var(--tk-muted-text)',
            }}
          >
            {reachable
              ? statusDetail(buddy, now)
              : 'presence unknown while the daemon is down'}
          </Text>
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
 * The fleet, not the room: every signed-in agent session, one stable online
 * list plus an offline section. Online rows never regroup by status -- the
 * dot alone carries working vs idle, so a busy<->idle flip cannot move a
 * row out from under the pointer. Order is `signedInAt` and nothing else.
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
  panel = false,
  onPick,
}: RosterProps) {
  const bySignIn = (a: RosterBuddy, b: RosterBuddy) =>
    a.signedInAt - b.signedInAt;
  const online = buddies.filter(b => b.status !== 'offline').sort(bySignIn);
  const offline = buddies.filter(b => b.status === 'offline').sort(bySignIn);

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
        minHeight: 0,
        background: compact ? undefined : 'var(--tk-panel)',
        border: compact || panel ? undefined : '1px solid var(--tk-border)',
        borderLeft: panel ? '1px solid var(--tk-border)' : undefined,
        borderRadius: compact || panel ? undefined : 'var(--mantine-radius-md)',
        padding: compact
          ? undefined
          : 'var(--mantine-spacing-lg) var(--mantine-spacing-xl)',
      }}
    >
      {!compact && (
        <Group
          justify="space-between"
          wrap="nowrap"
          // No rule under the header: the online list starts right beneath,
          // and a rule here would read as a second frame.
          style={{ paddingBottom: 'var(--mantine-spacing-xs)' }}
        >
          <Group gap={6} wrap="nowrap">
            <Icon
              name="users"
              size={14}
              color="var(--tk-muted-text)"
              style={{ flex: 'none' }}
            />
            <Text
              component="h2"
              style={{
                margin: 0,
                fontSize: 'var(--tk-fs-3xs)',
                fontWeight: 600,
                letterSpacing: '0.04em',
                color: 'var(--tk-muted-text)',
              }}
            >
              BUDDIES
            </Text>
          </Group>
          {!daemonReachable && (
            <Text
              style={{
                fontSize: 'var(--tk-fs-3xs)',
                color: 'var(--tk-muted-text)',
              }}
            >
              last known
            </Text>
          )}
        </Group>
      )}

      {/* The BUDDIES row stays put; only the sections scroll. */}
      <Box
        data-testid="roster-scroll"
        style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
      >
        {online.map(buddy => (
          <MemberRow
            key={buddy.handle}
            buddy={buddy}
            now={now}
            reachable={daemonReachable}
            inRoom={roomMembers.includes(buddy.handle)}
            compact={compact}
            onPick={onPick}
          />
        ))}
        {daemonReachable && (
          <Fragment>
            <SectionHeading
              status="offline"
              label={OFFLINE_LABEL}
              count={offline.length}
            />
            {offline.map(buddy => (
              <OfflineRow key={buddy.handle} buddy={buddy} now={now} />
            ))}
          </Fragment>
        )}
      </Box>
    </Stack>
  );
}
