import { useState } from 'react';
import {
  ActionIcon,
  Box,
  Group,
  Menu,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { useHover } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import type { RoomSummary } from '@mattstack/rt-client';

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
  onSelectRoom?: (room: string) => void;
  /** rt daemon reachability: the `+` is disabled while it is down, since a
      room cannot be created without it. @default true */
  daemonReachable?: boolean;
  /** Opens the new-room modal. The `+` renders only when this is wired. */
  onNewRoom?: () => void;
  /** Closes a room (leaves it off the listing until a post revives it): the
      row's hover × and its right-click menu. Neither renders when this is
      absent. */
  onCloseRoom?: (room: string) => void;
  /** The right-click menu's Mark read, offered only on a row with unread. */
  onMarkRead?: (room: string) => void;
  /** Inside `PageShell.Sidebar`: the sidebar is the surface, so no card. */
  sidebar?: boolean;
}

/** The header's `+`: `.aicon` (24px, 6px radius, muted, `bg4` on hover). */
function NewRoomButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick?: () => void;
}) {
  const { ref, hovered } = useHover<HTMLButtonElement>();
  return (
    <UnstyledButton
      ref={ref}
      data-testid="new-room-button"
      aria-label="New room"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 24,
        flex: 'none',
        borderRadius: 'var(--mantine-radius-md)',
        color: 'var(--tk-muted-text)',
        background: hovered && !disabled ? 'var(--ui-bg-4)' : 'transparent',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <Icon name="plus" size={14} />
    </UnstyledButton>
  );
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
        padding: '0 var(--mantine-spacing-sm)',
        fontSize: 'var(--tk-fs-3xs)',
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
        padding: '0 var(--mantine-spacing-sm)',
        fontSize: 'var(--tk-fs-3xs)',
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
      <AgentName handle={a} withCard={false} />{' '}
      <span style={{ color: 'var(--tk-purple)', flex: 'none' }}>↔</span>{' '}
      <AgentName handle={b} withCard={false} />
    </Text>
  );
}

function roomLabel(room: RoomSummary): string {
  return room.kind === 'dm' && room.participants
    ? `${room.participants.a} ↔ ${room.participants.b}`
    : `#${room.room}`;
}

/**
 * A rail row is a `div[role=button]`, not a `<button>`: the close control
 * inside it is a real button, and a button may not nest a button. Enter and
 * Space select, like the button they replace. The × shows on hover, on
 * focus within, and while the row's menu is open; the menu is Mantine's
 * `Menu.ContextMenu` (right-click, and a long press on touch), positioned
 * at the cursor, one instance per row.
 */
function RoomRow({
  room,
  active,
  onSelect,
  onClose,
  onMarkRead,
}: {
  room: RoomSummary;
  active: boolean;
  onSelect?: () => void;
  onClose?: (room: string) => void;
  onMarkRead?: (room: string) => void;
}) {
  const isDm = room.kind === 'dm';
  const label = roomLabel(room);
  const { ref, hovered } = useHover<HTMLDivElement>();
  const [menuOpened, setMenuOpened] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const closable = onClose !== undefined;
  const showClose = closable && (hovered || focusWithin || menuOpened);

  const row = (
    <Box
      ref={ref}
      role="button"
      tabIndex={0}
      data-testid={`room-row-${room.room}`}
      data-active={active ? 'true' : undefined}
      onClick={onSelect}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.();
        }
      }}
      onFocus={() => setFocusWithin(true)}
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setFocusWithin(false);
      }}
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
        background: active
          ? ACCENT_WASH
          : hovered || menuOpened
            ? 'var(--ui-bg-4)'
            : undefined,
        color: active ? ACCENT_TEXT : undefined,
      }}
    >
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
      {room.mentions > 0 && <MentionBadge count={room.mentions} />}
      {room.unread > 0 && <UnreadBadge count={room.unread} />}
      {closable && (
        <Tooltip label="Close" position="top" withinPortal>
          <ActionIcon
            variant="subtle"
            size="sm"
            radius="md"
            color="gray"
            aria-label={`Close ${label}`}
            data-testid={`room-close-${room.room}`}
            onClick={e => {
              e.stopPropagation();
              onClose(room.room);
            }}
            style={{
              display: showClose ? undefined : 'none',
              flex: 'none',
              marginRight: -4,
              color: 'var(--tk-muted-text)',
            }}
          >
            <Icon name="close" size={14} />
          </ActionIcon>
        </Tooltip>
      )}
    </Box>
  );

  if (!closable) return row;

  return (
    <Menu onChange={setMenuOpened} radius="md" shadow="md" withinPortal>
      <Menu.ContextMenu>{row}</Menu.ContextMenu>
      <Menu.Dropdown data-testid={`room-context-${room.room}`}>
        <Menu.Label>{label}</Menu.Label>
        {room.unread > 0 && onMarkRead && (
          <Menu.Item
            data-testid="room-context-mark-read"
            leftSection={<Icon name="check" size={14} />}
            rightSection={<UnreadBadge count={room.unread} />}
            onClick={() => onMarkRead(room.room)}
          >
            Mark read
          </Menu.Item>
        )}
        <Menu.Item
          data-testid="room-context-close"
          leftSection={<Icon name="close" size={14} />}
          onClick={() => onClose(room.room)}
        >
          Close
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * The 232px rooms rail: a header row (`ROOMS` + count), the plain rooms,
 * then -- only when at least one DM exists -- a `DIRECT` section of `.pair`
 * rows and a footnote.
 */
export function RoomRail({
  rooms,
  activeRoom,
  onSelectRoom,
  daemonReachable = true,
  onNewRoom,
  onCloseRoom,
  onMarkRead,
  sidebar = false,
}: RoomRailProps) {
  const channelRooms = rooms.filter(r => r.kind !== 'dm');
  const directRooms = rooms.filter(r => r.kind === 'dm');

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
        padding: 'var(--mantine-spacing-lg) var(--mantine-spacing-sm)',
        alignSelf: 'stretch',
        overflowY: sidebar ? undefined : 'auto',
      }}
      data-testid="room-rail"
    >
      <Group
        justify="space-between"
        wrap="nowrap"
        style={{
          padding: '0 var(--mantine-spacing-md) var(--mantine-spacing-sm)',
        }}
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
        <Group gap={2} wrap="nowrap">
          <Text size="xs" style={{ color: 'var(--tk-muted-text)' }}>
            {channelRooms.length}
          </Text>
          {onNewRoom && (
            <NewRoomButton disabled={!daemonReachable} onClick={onNewRoom} />
          )}
        </Group>
      </Group>

      {channelRooms.map(room => (
        <RoomRow
          key={room.room}
          room={room}
          active={room.room === activeRoom}
          onSelect={() => onSelectRoom?.(room.room)}
          onClose={onCloseRoom}
          onMarkRead={onMarkRead}
        />
      ))}

      {directRooms.length > 0 && (
        <>
          <Group
            gap="sm"
            wrap="nowrap"
            style={{
              padding:
                'var(--mantine-spacing-md) var(--mantine-spacing-md) var(--mantine-spacing-xs)',
              borderBottom: `1px solid var(--tk-border-soft)`,
            }}
          >
            <Text
              component="h3"
              fw={700}
              style={{
                margin: 0,
                fontSize: 'var(--tk-fs-4xs)',
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
              onClose={onCloseRoom}
              onMarkRead={onMarkRead}
            />
          ))}
        </>
      )}
    </Stack>
  );
}
