import {
  Box,
  Drawer,
  Group,
  Stack,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { useColorScheme, useHover } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';

import { FleetTree, type FleetRoom } from './FleetTree';
import { PHONE_MUTED, PHONE_TAP, tapButtonStyle } from './phone-chrome';
import { MUTED_XS } from './presence-bits';
import type { RosterBuddy } from './roster-types';

export interface RoomRailProps {
  rooms: FleetRoom[];
  /** The whole fleet: the tree groups these by repo under each room. */
  buddies?: RosterBuddy[];
  /** A prop, not `Date.now()` internally, so sign-out ages are testable
      without fake timers. @default Date.now() */
  now?: number;
  /** The room open in the transcript, so its row carries the accent wash. */
  activeRoom?: string;
  onSelectRoom?: (room: string) => void;
  /** rt daemon reachability: the `+` is disabled while it is down, since a
      room cannot be created without it, and every presence claim in the tree
      is withheld. @default true */
  daemonReachable?: boolean;
  /** Opens the new-room modal. The `+` renders only when this is wired. */
  onNewRoom?: () => void;
  /** Closes a room (leaves it off the listing until a post revives it): the
      row's hover × and its right-click menu. Neither renders when this is
      absent. */
  onCloseRoom?: (room: string) => void;
  /** The right-click menu's Mark read, offered only on a row with unread. */
  onMarkRead?: (room: string) => void;
  /** Desktop: brings a workstream's herdr pane to the front. Ignored when
      `onSelectBuddy` is given. */
  onFocusPane?: (paneId: string) => void;
  /** Phone: opens a DM with a workstream's buddy instead of focusing a
      pane, which is meaningless while Matt is away from the machine. Takes
      priority over `onFocusPane`. */
  onSelectBuddy?: (handle: string) => void;
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
 * The 244px sidebar: a `FLEET` header carrying the fleet count and the `+`,
 * then the tree itself. The rail owns the frame and the header; `FleetTree`
 * owns every row inside it.
 */
export function RoomRail({
  rooms,
  buddies = [],
  now = Date.now(),
  activeRoom,
  onSelectRoom,
  daemonReachable = true,
  onNewRoom,
  onCloseRoom,
  onMarkRead,
  onFocusPane,
  onSelectBuddy,
  sidebar = false,
}: RoomRailProps) {
  // A `dm` room with no participants has no pair to be named by, and
  // falling into channelRooms would render its hashed room id (`roomLabel`
  // in FleetTree.tsx falls back to `#${room.room}` there). The server drops
  // the same room from the inbox for the same reason (`inbox.ts`); mirror
  // that here rather than let it render at all.
  const directRooms = rooms.filter(r => r.kind === 'dm' && r.participants);
  const channelRooms = rooms.filter(r => r.kind !== 'dm');
  const online = buddies.filter(b => b.status !== 'offline').length;

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
          FLEET
        </Text>
        <Group gap={2} wrap="nowrap">
          <Text component="span" data-testid="fleet-count" style={MUTED_XS}>
            {daemonReachable
              ? `${online} on · ${buddies.length - online} off`
              : 'last known'}
          </Text>
          {onNewRoom && (
            <NewRoomButton disabled={!daemonReachable} onClick={onNewRoom} />
          )}
        </Group>
      </Group>

      <FleetTree
        rooms={channelRooms}
        dms={directRooms}
        buddies={buddies}
        now={now}
        activeRoom={activeRoom}
        daemonReachable={daemonReachable}
        onOpenRoom={onSelectRoom}
        onOpenDm={onSelectRoom}
        onFocusPane={onFocusPane}
        onSelectBuddy={onSelectBuddy}
        onClose={onCloseRoom}
        onMarkRead={onMarkRead}
      />
    </Stack>
  );
}

export interface FleetDrawerProps {
  opened: boolean;
  onClose: () => void;
  /** Already filtered to what a rail would show (`visibleRooms`) -- the same
      list the desktop sidebar reads. */
  rooms: FleetRoom[];
  buddies: RosterBuddy[];
  now?: number;
  activeRoom?: string;
  daemonReachable?: boolean;
  onSelectRoom: (room: string) => void;
  /** Tapping a workstream row opens a DM with that buddy, then closes the
      drawer -- not `onFocusPane`. Focusing a herdr pane is meaningless on a
      phone: the whole premise of this surface is that Matt is away from
      the machine. A DM is always meaningful, on or off the machine, and is
      already a first-class way to reach an agent here. */
  onOpenDm: (handle: string) => void;
  onCloseRoom?: (room: string) => void;
  onMarkRead?: (room: string) => void;
}

/**
 * The phone's rooms drawer (`PhoneRooms.dc.html`): `RoomRail` itself,
 * `sidebar`-mode, inside a Mantine `Drawer` -- not a second tree built from
 * scratch. There is no BUDDIES/roster section here: a handle already reads
 * next to the room it works in, inside the tree itself.
 */
export function FleetDrawer({
  opened,
  onClose,
  rooms,
  buddies,
  now = Date.now(),
  activeRoom,
  daemonReachable = true,
  onSelectRoom,
  onOpenDm,
  onCloseRoom,
  onMarkRead,
}: FleetDrawerProps) {
  const { computedColorScheme, setColorScheme } = useColorScheme();
  const isDark = computedColorScheme === 'dark';

  function selectBuddy(handle: string) {
    onOpenDm(handle);
    onClose();
  }

  function selectRoom(room: string) {
    onSelectRoom(room);
    onClose();
  }

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="left"
      // This app's theme resolves `size="sm"` to 380px, wider than the
      // 375px screen the artboard draws it on, so the 0.4 overlay never
      // shows. 86vw keeps the artboard's sliver at every phone width.
      size="86vw"
      withCloseButton={false}
      overlayProps={{ backgroundOpacity: 0.4 }}
      padding={0}
      data-testid="phone-drawer"
    >
      <Stack
        gap={2}
        style={{
          height: '100%',
          padding: 'var(--mantine-spacing-lg) var(--mantine-spacing-sm)',
          minHeight: 0,
        }}
      >
        <Group
          justify="space-between"
          wrap="nowrap"
          style={{
            height: PHONE_TAP,
            padding: '0 0 0 var(--mantine-spacing-md)',
            flex: 'none',
          }}
        >
          <Text fw={700}>chat</Text>
          <UnstyledButton
            aria-label="Close"
            data-testid="phone-drawer-close"
            onClick={onClose}
            style={tapButtonStyle(PHONE_TAP)}
          >
            <Icon name="chevronLeft" size={20} />
          </UnstyledButton>
        </Group>

        <Box style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <RoomRail
            sidebar
            rooms={rooms}
            buddies={buddies}
            now={now}
            activeRoom={activeRoom}
            onSelectRoom={selectRoom}
            daemonReachable={daemonReachable}
            onCloseRoom={onCloseRoom}
            onMarkRead={onMarkRead}
            onSelectBuddy={selectBuddy}
          />
        </Box>

        <Group
          justify="space-between"
          wrap="nowrap"
          style={{ padding: '0 0 0 var(--mantine-spacing-md)', flex: 'none' }}
        >
          <Text size="xs" style={{ color: PHONE_MUTED }}>
            {daemonReachable ? 'rt daemon answering' : 'rt daemon unreachable'}
          </Text>
          <UnstyledButton
            aria-label="Color scheme"
            onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
            style={tapButtonStyle(PHONE_TAP)}
          >
            <Icon name={isDark ? 'sun' : 'moon'} size={20} />
          </UnstyledButton>
        </Group>
      </Stack>
    </Drawer>
  );
}
