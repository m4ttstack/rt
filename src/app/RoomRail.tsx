import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import type { RoomSummary } from '@mattstack/rt-client';

import { useLocalStorage } from '@mattstack/app-kit/hooks';
import { AnimatedChevron, Icon } from '@mattstack/app-kit/icons';
import { AgentName } from './AgentName';

/**
 * `.accent-deep` has no direct `--tk-*` token: the artboard's own palette
 * only defines it as a DERIVATION (`.app --accent-deep: #206cd2`, a specific
 * shade one step past plain accent; `.app.dark --accent-deep: var(--accent)`,
 * i.e. no separate shade at all in dark). `--mantine-color-accent-7` is
 * exactly the light shade the ramp was resampled to land on; the dark half
 * collapses back to the plain accent text color. `light-dark()` is the same
 * idiom `useSchemeColors.ts` already uses for a per-scheme formula that
 * ISN'T just "the same var, different scheme block".
 */
const ACCENT_DEEP =
  'light-dark(var(--mantine-color-accent-7), var(--mantine-color-accent-text))';
const ACCENT_ON = 'light-dark(var(--mantine-color-white), var(--tk-bg))';
const ACCENT_TEXT = 'var(--mantine-color-accent-text)';
const ACCENT_WASH = `color-mix(in srgb, ${ACCENT_TEXT} var(--tk-wash), transparent)`;
const BORDER_DEFAULT = 'var(--mantine-color-default-border)';

export interface RoomRailProps {
  rooms: RoomSummary[];
  /** The room open in the transcript, so its row carries the accent wash. */
  activeRoom?: string;
  /** The human's own handle, bolded inside a DM pair when it appears there. */
  humanHandle?: string;
  onSelectRoom?: (room: string) => void;
  /** Inside `PageShell.Sidebar`: the sidebar is the surface, so no card. */
  sidebar?: boolean;
}

/**
 * `@N`, filled accent. The glyph -- not just the colour -- is what
 * distinguishes this from `UnreadBadge`: a colourblind reader, or a
 * screenshot, still gets the difference.
 */
function MentionBadge({ count }: { count: number }) {
  return (
    <Box
      component="span"
      aria-label={`${count} mention`}
      data-testid="mention-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 18,
        lineHeight: 1,
        borderRadius: 'var(--mantine-radius-xl)',
        padding: '0 7px',
        fontSize: 10,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        background: ACCENT_DEEP,
        color: ACCENT_ON,
      }}
    >
      @{count}
    </Box>
  );
}

/** Plain `N`, outlined -- the difference from `MentionBadge` is the glyph. */
function UnreadBadge({ count }: { count: number }) {
  return (
    <Box
      component="span"
      aria-label={`${count} unread`}
      data-testid="unread-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 18,
        lineHeight: 1,
        borderRadius: 'var(--mantine-radius-xl)',
        padding: '0 7px',
        fontSize: 10,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        border: `1px solid ${BORDER_DEFAULT}`,
        color: 'var(--tk-muted-text)',
      }}
    >
      {count}
    </Box>
  );
}

/**
 * `a ↔ b`. The hashed room name is structurally never in the tree, not
 * merely hidden by CSS.
 *
 * The arrow is its own span so it can carry the artboard's purple, but the
 * surrounding text stays one flat run: this element's textContent is still
 * the whole phrase, so a screen reader reads it as one, and `getByText`
 * matches here and nowhere else (the span alone is just "↔").
 */
function DmPairName({ room, active }: { room: RoomSummary; active: boolean }) {
  const { a, b } = room.participants!;
  return (
    <Text
      size="sm"
      fw={active ? 600 : undefined}
      truncate
      style={{ flex: 1, minWidth: 0 }}
    >
      <AgentName handle={a} />{' '}
      <span style={{ color: 'var(--tk-purple)', flex: 'none' }}>↔</span>{' '}
      <AgentName handle={b} />
    </Text>
  );
}

/** `RoomSummary` plus the viewer-side flag the rooms route adds for a room
    the fleet is in that the human has not joined. */
type RailRoom = RoomSummary & { joined?: boolean };

function RoomRow({
  room,
  active,
  archived,
  onSelect,
}: {
  room: RailRoom;
  active: boolean;
  archived?: boolean;
  onSelect?: () => void;
}) {
  const isDm = room.kind === 'dm';

  return (
    <UnstyledButton
      data-testid={`room-row-${room.room}`}
      data-active={active ? 'true' : undefined}
      data-archived={archived ? 'true' : undefined}
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        minWidth: 0,
        width: '100%',
        height: 34,
        gap: 'var(--mantine-spacing-sm)',
        padding: '0 var(--mantine-spacing-md)',
        borderRadius: 'var(--mantine-radius-md)',
        cursor: 'pointer',
        background: active ? ACCENT_WASH : undefined,
        color: active ? ACCENT_TEXT : undefined,
        opacity: archived ? 0.6 : undefined,
      }}
    >
      {/* Channels get the hash; a DM is named by its pair, and the artboard
          draws no glyph in front of it. */}
      {!isDm && (
        <Icon
          name="hash"
          size={14}
          color={active ? ACCENT_TEXT : 'var(--tk-muted-text)'}
          style={{ flex: 'none' }}
        />
      )}
      {isDm && room.participants ? (
        <DmPairName room={room} active={active} />
      ) : (
        <Text
          fw={active ? 600 : undefined}
          truncate
          style={{ flex: 1, minWidth: 0 }}
        >
          {room.room}
        </Text>
      )}
      {!archived && room.mentions > 0 && <MentionBadge count={room.mentions} />}
      {!archived && room.unread > 0 && <UnreadBadge count={room.unread} />}
    </UnstyledButton>
  );
}

/**
 * The 232px rooms rail: a header row (`ROOMS` + count), the plain rooms,
 * then -- only when at least one DM exists -- a `DIRECT` section of `.pair`
 * rows and a footnote, then -- only when at least one room is archived -- a
 * collapsed `ARCHIVED` section whose open state persists across sessions.
 * `RoomSummary` (the read routes' own shape) is used directly as the room
 * prop type, so no separate DTO drifts from it.
 */
export function RoomRail({
  rooms,
  activeRoom,
  onSelectRoom,
  sidebar = false,
}: RoomRailProps) {
  const openRooms = rooms.filter(r => r.archivedAt === undefined);
  const channelRooms = openRooms.filter(r => r.kind !== 'dm');
  const directRooms = openRooms.filter(r => r.kind === 'dm');
  const archivedRooms = rooms.filter(r => r.archivedAt !== undefined);
  const [archivedCollapsed, setArchivedCollapsed] = useLocalStorage<boolean>({
    key: 'chat.rail.archived',
    defaultValue: true,
  });

  return (
    <Stack
      gap={2}
      style={{
        width: sidebar ? '100%' : 232 + 12,
        flex: sidebar ? 1 : 'none',
        minWidth: 0,
        background: sidebar ? undefined : 'var(--tk-panel)',
        border: sidebar ? undefined : '1px solid var(--tk-border)',
        borderRadius: sidebar ? undefined : 'var(--mantine-radius-md)',
        padding: 'var(--mantine-spacing-lg) 6px',
        alignSelf: 'stretch',
        overflowY: sidebar ? undefined : 'auto',
      }}
      data-testid="room-rail"
    >
      <Group
        justify="space-between"
        wrap="nowrap"
        style={{ padding: '0 var(--mantine-spacing-md) 6px' }}
      >
        <Text
          component="h3"
          size="xs"
          fw={600}
          style={{
            margin: 0,
            color: 'var(--tk-muted-text)',
            letterSpacing: '0.04em',
          }}
        >
          ROOMS
        </Text>
        <Text size="xs" style={{ color: 'var(--tk-muted-text)' }}>
          {channelRooms.length}
        </Text>
      </Group>

      {channelRooms.map(room => (
        <RoomRow
          key={room.room}
          room={room}
          active={room.room === activeRoom}
          onSelect={() => onSelectRoom?.(room.room)}
        />
      ))}

      {directRooms.length > 0 && (
        <>
          <Group
            gap={6}
            wrap="nowrap"
            style={{
              padding: '10px var(--mantine-spacing-md) 4px',
              borderBottom: `1px solid var(--tk-border-soft)`,
            }}
          >
            <Text
              component="h3"
              fw={700}
              style={{
                margin: 0,
                fontSize: '9.5px',
                color: 'var(--tk-muted-text)',
                letterSpacing: '0.06em',
              }}
            >
              DIRECT
            </Text>
          </Group>

          {directRooms.map(room => (
            <RoomRow
              key={room.room}
              room={room}
              active={room.room === activeRoom}
              onSelect={() => onSelectRoom?.(room.room)}
            />
          ))}

          <Text
            size="xs"
            style={{
              color: 'var(--tk-muted-text)',
              padding: '4px var(--mantine-spacing-md) 0',
            }}
          >
            Every agent↔agent DM is yours to read and post into.
          </Text>
        </>
      )}

      {archivedRooms.length > 0 && (
        <>
          <UnstyledButton
            data-testid="archived-toggle"
            aria-expanded={!archivedCollapsed}
            onClick={() => setArchivedCollapsed(!archivedCollapsed)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              width: '100%',
              padding: '10px var(--mantine-spacing-md) 4px',
              borderBottom: `1px solid var(--tk-border-soft)`,
            }}
          >
            <Text
              component="h3"
              fw={700}
              style={{
                margin: 0,
                fontSize: '9.5px',
                color: 'var(--tk-muted-text)',
                letterSpacing: '0.06em',
              }}
            >
              ARCHIVED
            </Text>
            <Text size="xs" style={{ color: 'var(--tk-muted-text)' }}>
              {archivedRooms.length}
            </Text>
            <Box style={{ flex: 1 }} />
            <AnimatedChevron
              opened={!archivedCollapsed}
              size={12}
              color="var(--tk-muted-text)"
            />
          </UnstyledButton>
          {!archivedCollapsed &&
            archivedRooms.map(room => (
              <RoomRow
                key={room.room}
                room={room}
                archived
                active={room.room === activeRoom}
                onSelect={() => onSelectRoom?.(room.room)}
              />
            ))}
        </>
      )}
    </Stack>
  );
}
