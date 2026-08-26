import { Box, Button, Group, Select, Text } from '@mantine/core';
import type { BuddyStatus, RoomSummary } from '@mattstack/rt-client';

import { Icon } from '@ui/icons';
import { STATUS_WORD } from '@ui/statusDetail';
import { AgentName } from './AgentName';

function signedInCount(buddies: { status: BuddyStatus }[]): number {
  return buddies.filter(b => b.status !== 'offline').length;
}

/** Rendered inside `PageShell.Header`, which owns the 64px surface, its
    padding and its border; this is the row's content. */
const PAGE_BAR_ROW = {
  height: '100%',
  width: '100%',
  minWidth: 0,
} as const;

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
  color: 'var(--tk-muted-text)',
} as const;

/** The artboard's two 30px controls sit on `bg1` with the hairline border,
    which is Mantine's `default` variant on the tokyo surface tokens. */
const CONTROL_SURFACE = {
  background: 'var(--tk-bg)',
  borderColor: 'var(--tk-border)',
  fontSize: '12.16px',
} as const;

const UNREAD_BADGE = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 18,
  padding: '0 7px',
  borderRadius: 10,
  fontSize: 10,
  fontWeight: 500,
  lineHeight: 1,
  border: '1px solid var(--tk-border)',
  color: 'var(--tk-muted-text)',
  whiteSpace: 'nowrap',
} as const;

export type RoomOrder = 'join' | 'name';

export interface PageBarBuddy {
  handle: string;
  status: BuddyStatus;
}

export interface PageBarProps {
  room: RoomSummary;
  buddies: PageBarBuddy[];
  /** The room's members with their presence: the bar counts who is in THIS
      room, the roster counts the fleet. */
  reachable?: boolean;
  onMarkRead?: (room: string) => void;
  /** The rail's sort, the artboard's `join order` select. */
  order?: RoomOrder;
  onOrderChange?: (order: RoomOrder) => void;
}

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

/** A chip whose count is at most two names its handles, so the stuck agent
    is read first rather than found last; each name carries its card. */
function NamesSuffix({ handles }: { handles: string[] }) {
  if (handles.length === 0 || handles.length > 2) return null;
  return (
    <>
      {': '}
      {handles.map((h, i) => (
        <span key={h}>
          {i > 0 && ', '}
          <AgentName handle={h} />
        </span>
      ))}
    </>
  );
}

/** The hash is an icon beside the title, as the artboard draws it, not a
    character in it; a DM is named by its pair. */
function roomTitle(room: RoomSummary): string {
  return room.kind === 'dm' && room.participants
    ? `${room.participants.a} ↔ ${room.participants.b}`
    : room.room;
}

function markReadLabel(room: RoomSummary): string {
  return room.kind === 'dm'
    ? 'Mark conversation read'
    : `Mark #${room.room} read`;
}

export function PageBar({
  room,
  buddies,
  reachable = true,
  onMarkRead,
  order = 'join',
  onOrderChange,
}: PageBarProps) {
  const handleMarkRead = () => {
    // Refresh only after the POST resolves: the count clears server-side
    // first, so a refetch fired before it would read the stale unread.
    void fetch('/api/chat/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: room.room }),
    })
      .then(() => onMarkRead?.(room.room))
      .catch(() => {});
  };

  const title = (
    <>
      {room.kind !== 'dm' && (
        <Box
          component="span"
          style={{
            display: 'inline-flex',
            flex: 'none',
            color: 'var(--tk-muted-text)',
          }}
          data-testid="page-bar-hash"
        >
          <Icon name="hash" size={18} />
        </Box>
      )}
      <Text
        fw={700}
        size="20px"
        lh={1.35}
        truncate
        style={{ flex: 'none', maxWidth: '38%', minWidth: 0 }}
      >
        {roomTitle(room)}
      </Text>
      <Box style={{ width: 4.8, flex: 'none' }} />
    </>
  );

  const controls = (
    <>
      {room.unread > 0 && (
        <Button
          variant="default"
          size="xs"
          radius="md"
          data-testid="mark-read-button"
          aria-label={markReadLabel(room)}
          onClick={handleMarkRead}
          leftSection={<Icon name="check" size={14} />}
          rightSection={
            <Box component="span" style={UNREAD_BADGE}>
              {room.unread}
            </Box>
          }
          styles={{ root: CONTROL_SURFACE }}
        >
          mark read
        </Button>
      )}
      {onOrderChange && (
        <Select
          size="xs"
          radius="md"
          w={168}
          ml={7.2}
          aria-label="Room order"
          data-testid="room-order"
          value={order}
          onChange={value => {
            if (value) onOrderChange(value as RoomOrder);
          }}
          allowDeselect={false}
          withCheckIcon={false}
          data={[
            { value: 'join', label: 'join order' },
            { value: 'name', label: 'by name' },
          ]}
          rightSection={<Icon name="chevronDown" size={14} />}
          styles={{ input: CONTROL_SURFACE }}
        />
      )}
    </>
  );

  if (!reachable) {
    return (
      <Group
        align="center"
        wrap="nowrap"
        gap="sm"
        style={PAGE_BAR_ROW}
        data-testid="page-bar"
      >
        {title}
        <Group
          gap="sm"
          wrap="nowrap"
          style={{ flex: '1 1 0%', minWidth: 0, overflowX: 'auto' }}
        >
          <Box component="span" style={CHIP_BASE} data-testid="chip-signed-in">
            {signedInCount(buddies)} in room · last known
          </Box>
          <Box component="span" style={CHIP_BASE} data-testid="chip-withheld">
            presence withheld
          </Box>
        </Group>
        <Group gap={0} ml="auto" wrap="nowrap">
          {controls}
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
      align="center"
      wrap="nowrap"
      gap="sm"
      style={PAGE_BAR_ROW}
      data-testid="page-bar"
    >
      {title}
      <Group
        gap="sm"
        wrap="nowrap"
        style={{ flex: '1 1 0%', minWidth: 0, overflowX: 'auto' }}
      >
        <Box component="span" style={CHIP_BASE} data-testid="chip-signed-in">
          {signedInTotal} in room
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
            <NamesSuffix handles={live.map(b => b.handle)} />
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
            <NamesSuffix handles={idle.map(b => b.handle)} />
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
            <NamesSuffix handles={deaf.map(b => b.handle)} />
          </Box>
        )}
        <Box component="span" style={CHIP_BASE} data-testid="chip-wakes">
          wakes: {wakeMode}
        </Box>
      </Group>
      <Group gap={0} ml="auto" wrap="nowrap">
        {controls}
      </Group>
    </Group>
  );
}
