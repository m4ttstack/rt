import { Box, Group, Text, UnstyledButton } from '@mantine/core';
import type { BuddyStatus, RoomSummary } from '@mattstack/rt-client';

import { STATUS_WORD } from '@ui/statusDetail';

/**
 * Console's second 64px bar, per the Main artboard: its own surface with a
 * hairline under it, so it reads as chrome rather than as the first row of
 * the content beneath. Without the background and border it floats, which
 * is what it did before this was pulled out.
 */
/**
 * "Signed in" means the same population in both branches: everyone whose
 * session is still open. `buddies.length` counts signed-OUT agents too, so
 * the daemon-down chip read a larger fleet than the reachable one did for
 * the same roster -- the one moment the number is least checkable.
 */
function signedInCount(buddies: { status: BuddyStatus }[]): number {
  return buddies.filter(b => b.status !== 'offline').length;
}

const PAGE_BAR_SURFACE = {
  height: 64,
  flex: 'none',
  padding: '0 var(--mantine-spacing-lg)',
  background: 'var(--tk-panel)',
  borderBottom: '1px solid var(--tk-border)',
} as const;

/**
 * The narrow shape `PageBar` (and Task 7's `Composer`) actually read off a
 * buddy row -- not the full `PresenceRow`, so a test can seed four handles
 * without inventing `sessionId`/`signedInAt`/etc.
 */
export interface PageBarBuddy {
  handle: string;
  status: BuddyStatus;
}

export interface PageBarProps {
  room: RoomSummary;
  buddies: PageBarBuddy[];
  /** Daemon reachability. Down means exactly two plain chips (last-known
      count, presence withheld) -- Task 4's rule, reused rather than
      reimplemented. @default true */
  reachable?: boolean;
  onMarkRead?: (room: string) => void;
}

const CHIP_BASE = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--mantine-spacing-xs)',
  height: 22,
  borderRadius: 'var(--mantine-radius-md)',
  padding: '0 8px',
  fontSize: '10.56px',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  border: '1px solid var(--mantine-color-default-border)',
  color: 'var(--tk-muted)',
} as const;

function Dot({ color, testId }: { color: string; testId: string }) {
  return (
    <Box
      component="span"
      data-testid={testId}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        flex: 'none',
        background: color,
      }}
    />
  );
}

/** A chip whose count is <=2 names its handles: the point is that the stuck
    agent is read first rather than found last. */
function namesSuffix(handles: string[]): string {
  return handles.length > 0 && handles.length <= 2
    ? `: ${handles.join(', ')}`
    : '';
}

function roomTitle(room: RoomSummary): string {
  return room.kind === 'dm' && room.participants
    ? `${room.participants.a} ↔ ${room.participants.b}`
    : `#${room.room}`;
}

function markReadLabel(room: RoomSummary): string {
  return room.kind === 'dm'
    ? 'Mark conversation read'
    : `Mark #${room.room} read`;
}

/**
 * Console's second 64px bar: the room title, then the fleet chips. Rendering
 * never advances the read cursor -- only the mark-read button POSTs
 * `/api/chat/mark`, so a test can assert zero network calls on mount.
 */
export function PageBar({
  room,
  buddies,
  reachable = true,
  onMarkRead,
}: PageBarProps) {
  const handleMarkRead = () => {
    onMarkRead?.(room.room);
    // A rejected fetch (daemon gone between render and click) must not become
    // an unhandled rejection: the cursor simply does not advance, which is
    // the safe direction to fail. The next poll re-renders the true count.
    void fetch('/api/chat/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: room.room }),
    }).catch(() => {});
  };

  // `flex: none` + a capped max-width: the title always renders at its own
  // size (truncating past the cap) instead of sharing a `flex: 1` grow/
  // shrink budget with the chips row -- which starves it to a literal
  // zero-width, invisible element the moment the chips (especially with
  // handles named behind a small count) outgrow the remaining space.
  const title = (
    <Text
      fw={700}
      size="26px"
      truncate
      style={{ flex: 'none', maxWidth: '38%', minWidth: 0 }}
    >
      {roomTitle(room)}
    </Text>
  );

  if (!reachable) {
    return (
      <Group
        justify="space-between"
        align="center"
        wrap="nowrap"
        style={{ ...PAGE_BAR_SURFACE }}
        data-testid="page-bar"
      >
        {title}
        <Group
          gap="xs"
          wrap="nowrap"
          style={{ flex: '1 1 0%', minWidth: 0, overflowX: 'auto' }}
        >
          <Box component="span" style={CHIP_BASE} data-testid="chip-signed-in">
            {signedInCount(buddies)} signed in · last known
          </Box>
          <Box component="span" style={CHIP_BASE} data-testid="chip-withheld">
            presence withheld
          </Box>
        </Group>
      </Group>
    );
  }

  const wakeMode = room.kind === 'dm' ? 'all' : (room.defaultWake ?? 'mention');
  const live = buddies.filter(b => b.status === 'live');
  const idle = buddies.filter(b => b.status === 'idle');
  const deaf = buddies.filter(b => b.status === 'deaf');
  const signedInTotal = signedInCount(buddies);

  return (
    <Group
      justify="space-between"
      align="center"
      wrap="nowrap"
      style={{ ...PAGE_BAR_SURFACE }}
      data-testid="page-bar"
    >
      {title}

      <Group
        gap="xs"
        wrap="nowrap"
        style={{ flex: '1 1 0%', minWidth: 0, overflowX: 'auto' }}
      >
        <Box component="span" style={CHIP_BASE} data-testid="chip-signed-in">
          {signedInTotal} signed in
        </Box>

        {live.length > 0 && (
          <Box
            component="span"
            style={{
              ...CHIP_BASE,
              borderColor:
                'color-mix(in srgb, var(--mantine-color-ok-text) 45%, transparent)',
              color: 'var(--mantine-color-ok-text)',
            }}
            data-testid="chip-live"
          >
            <Dot color="var(--tk-dot-ok)" testId="dot-live" />
            {live.length} {STATUS_WORD.live}
            {namesSuffix(live.map(b => b.handle))}
          </Box>
        )}

        {idle.length > 0 && (
          <Box
            component="span"
            style={{
              ...CHIP_BASE,
              borderColor:
                'color-mix(in srgb, var(--mantine-color-warn-text) 45%, transparent)',
              color: 'var(--mantine-color-warn-text)',
            }}
            data-testid="chip-idle"
          >
            <Dot color="var(--tk-dot-warn)" testId="dot-idle" />
            {idle.length} {STATUS_WORD.idle}
            {namesSuffix(idle.map(b => b.handle))}
          </Box>
        )}

        {deaf.length > 0 && (
          <Box
            component="span"
            style={{
              ...CHIP_BASE,
              background:
                'color-mix(in srgb, var(--mantine-color-bad-text) 7%, transparent)',
              borderColor:
                'color-mix(in srgb, var(--mantine-color-bad-text) 45%, transparent)',
              color: 'var(--mantine-color-bad-text)',
            }}
            data-testid="chip-deaf"
          >
            <Dot color="var(--tk-dot-bad)" testId="dot-deaf" />
            {deaf.length} {STATUS_WORD.deaf}
            {namesSuffix(deaf.map(b => b.handle))}
          </Box>
        )}

        <Box component="span" style={CHIP_BASE} data-testid="chip-wakes">
          wakes: {wakeMode}
        </Box>

        {room.unread > 0 && (
          <UnstyledButton
            data-testid="mark-read-button"
            aria-label={markReadLabel(room)}
            onClick={handleMarkRead}
            style={{
              ...CHIP_BASE,
              cursor: 'pointer',
              color: 'var(--mantine-color-accent-text)',
              borderColor:
                'color-mix(in srgb, var(--mantine-color-accent-text) 45%, transparent)',
            }}
          >
            mark read
          </UnstyledButton>
        )}
      </Group>
    </Group>
  );
}
