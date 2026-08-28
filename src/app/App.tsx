import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type {
  ChatMember,
  ChatMessage,
  RoomSummary,
} from '@mattstack/rt-client';
import { useInterval } from 'react-interval-hook';
import { useLocation } from 'wouter';
import { navigate } from 'wouter/use-browser-location';

import { ArchivedBar } from '@ui/ArchivedBar';
import { BuddiesProvider } from '@ui/buddies-context';
import { Composer, type ComposerHandle } from '@ui/Composer';
import {
  Box,
  Center,
  Drawer,
  Group,
  PageShell,
  Stack,
  Text,
  UnstyledButton,
} from '@ui/core';
import { DaemonBanner } from '@ui/DaemonBanner';
import { useColorScheme, useIsMobile, useLocalStorage } from '@ui/hooks';
import { AnimatedChevron, Icon } from '@ui/icons';
import { notifications } from '@ui/notifications';
import { PageBar, RoomMenu, type RoomOrder } from '@ui/PageBar';
import { RoomRail } from '@ui/RoomRail';
import { Roster, type RosterBuddy } from '@ui/Roster';
import { Transcript } from '@ui/Transcript';
import { AppChrome } from './chrome/AppChrome';
import { PageShellDemoPage } from './demo/PageShellDemoPage';
import { NotFoundPage } from './NotFoundPage';
import { useAppRoute, useHash } from './routes';

/**
 * `/api/chat/buddies`' own wire shape -- `Roster` reads the full
 * `PresenceRow` (branch/cwd/pane/statusText/signedInAt, ...), not just the
 * `status`/timestamp subset `statusDetail.ts` needs, so this is no longer
 * the narrower type Task 4 left here.
 */
export type Buddy = RosterBuddy;

/**
 * Seeds the app's data instead of a network call -- every UI test in this
 * repo uses this seam rather than mocking `fetch`. `daemonReachable` seeds
 * `useDaemonHealth`'s starting state; `buddies` seeds the roster fetch. The
 * remaining fields are reserved for the tasks that render rooms/members/
 * messages, so the shape is settled once rather than re-litigated per task.
 */
export interface AppInitialState {
  daemonReachable?: boolean;
  buddies?: Buddy[];
  rooms?: RoomSummary[];
  members?: ChatMember[];
  messages?: ChatMessage[];
}

interface DaemonHealthState {
  reachable: boolean;
  downSince?: number;
  probeCount: number;
  lastAnsweredAt?: number;
}

/**
 * Polls `GET /api/daemon` every 5s and tracks the shape `DaemonBanner` needs
 * beyond the bare boolean: how long the current outage has run and how many
 * probes it has seen, neither of which the server tracks across requests.
 * `seed` (from `initialState.daemonReachable`) is a one-time starting value,
 * matched against the house `initialState` seam every other UI test uses --
 * it is read once, not watched, so a test never needs a live poll.
 */
function useDaemonHealth(seed: boolean | undefined) {
  const [state, setState] = useState<DaemonHealthState>(() => {
    const now = Date.now();
    if (seed === false)
      return { reachable: false, downSince: now, probeCount: 1 };
    return {
      reachable: true,
      probeCount: 0,
      lastAnsweredAt: seed === true ? now : undefined,
    };
  });

  const probe = useCallback(async () => {
    let reachable = false;
    try {
      const res = await fetch('/api/daemon');
      const data = (await res.json()) as { reachable: boolean };
      reachable = data.reachable;
    } catch {
      reachable = false;
    }

    const now = Date.now();
    setState(prev => {
      if (reachable)
        return { reachable: true, probeCount: 0, lastAnsweredAt: now };
      return {
        reachable: false,
        downSince: prev.reachable ? now : (prev.downSince ?? now),
        probeCount: prev.reachable ? 1 : prev.probeCount + 1,
        lastAnsweredAt: prev.lastAnsweredAt,
      };
    });
  }, []);

  useInterval(probe, 5000);

  return { ...state, probeNow: probe };
}

function wsUrl(): string {
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

/**
 * Fetches the buddy roster on mount (skipped when `seed` replaces it, the
 * same test seam `useDaemonHealth` reads), every 5s, and again on any
 * `chat/wake/*` relay frame. A wake frame means a buddy's tail needs a
 * nudge, not that its status changed -- the daemon still owns status,
 * always -- but it is a hint this snapshot is worth refreshing before the
 * next scheduled poll.
 */
function useBuddies(seed: Buddy[] | undefined): Buddy[] {
  const [buddies, setBuddies] = useState<Buddy[]>(seed ?? []);

  const fetchBuddies = useCallback(() => {
    fetch('/api/chat/buddies')
      .then(res => res.json())
      .then((data: { buddies?: Buddy[] }) => setBuddies(data.buddies ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (seed !== undefined) return;
    fetchBuddies();
    // Mount-only: `seed` is a one-time starting value, not a prop to re-sync on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInterval(fetchBuddies, 5000);

  useEffect(() => {
    const socket = new WebSocket(wsUrl());
    socket.onmessage = event => {
      let frame: { topic?: unknown } | undefined;
      try {
        frame = JSON.parse(String((event as { data: unknown }).data));
      } catch {
        return;
      }
      if (
        typeof frame?.topic === 'string' &&
        frame.topic.startsWith('chat/wake/')
      ) {
        fetchBuddies();
      }
    };
    return () => socket.close();
  }, [fetchBuddies]);

  return buddies;
}

/**
 * Fetches the room list on mount (skipped when `seed` replaces it) and
 * exposes `refetchRooms` for after a write that can introduce a room the
 * mount-time fetch never saw -- `openDm` opens or reuses a room this list
 * has no reason to have fetched yet.
 */
function useRooms(seed: RoomSummary[] | undefined) {
  const [rooms, setRooms] = useState<RoomSummary[]>(seed ?? []);

  // Resolves to the fetched list so a caller can act on what came back --
  // `setArchived` needs to know whether the room it just archived is still
  // listed. A failed fetch resolves to [] with `rooms` left untouched, which
  // reads as "nothing to navigate to", never as "the room vanished".
  const refetchRooms = useCallback(async (): Promise<RoomSummary[]> => {
    try {
      const res = await fetch('/api/chat/rooms');
      const data = (await res.json()) as { rooms?: RoomSummary[] };
      const next = data.rooms ?? [];
      setRooms(next);
      return next;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    if (seed !== undefined) return;
    void refetchRooms();
    // Mount-only, same reasoning as useBuddies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { rooms, refetchRooms };
}

/**
 * Fetches one room's message tail whenever `room` changes. `seed` (from
 * `initialState.messages`) replaces the very first fetch only -- once the
 * viewer switches rooms, or a test unmounts/remounts with a different
 * `room`, the real fetch takes over, same as production always uses.
 */
function useMessages(
  room: string | undefined,
  seed: ChatMessage[] | undefined
): ChatMessage[] {
  const [messages, setMessages] = useState<ChatMessage[]>(seed ?? []);
  // The seed stays PENDING until the first defined room arrives, then is
  // spent on it. `activeRoom` is undefined on the first render (a later
  // effect lands on the first room), so binding the seed to `room` at mount
  // bound it to `undefined` and every real room refetched -- which is the
  // seed never working at all. Guarding on `seed !== undefined` alone had
  // the opposite failure: it suppressed EVERY fetch for the life of the
  // mount, so a room switch kept the first room's transcript.
  const seedPending = useRef(seed !== undefined);

  useEffect(() => {
    if (!room) {
      // Do NOT clear while the seed is still pending: `activeRoom` is
      // undefined on the first render, so clearing here threw the seed away
      // before any room could consume it.
      if (!seedPending.current) setMessages([]);
      return;
    }
    if (seedPending.current) {
      seedPending.current = false;
      return;
    }
    // Clears immediately on a room switch rather than leaving the PREVIOUS
    // room's tail visible until the new fetch resolves -- Transcript
    // re-seeds off this array's identity, not off `room` alone.
    setMessages([]);
    let cancelled = false;
    fetch(`/api/chat/messages/${room}`)
      .then(res => res.json())
      .then((data: { messages?: ChatMessage[] }) => {
        if (!cancelled) setMessages(data.messages ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [room]);

  return messages;
}

/**
 * Fetches one room's member list whenever `room` changes, mirroring
 * `useMessages`'s seed/refetch shape. `Roster` only ever needs "is this
 * handle in the open room", so the member rows collapse to handles here
 * rather than carrying their own `ChatMember` shape further than this hook.
 */
function useRoomMembers(
  room: string | undefined,
  seed: ChatMember[] | undefined
): string[] {
  const [members, setMembers] = useState<ChatMember[]>(seed ?? []);
  // Same one-shot rule as useMessages: pending until the first defined room.
  const seedPending = useRef(seed !== undefined);

  useEffect(() => {
    if (!room) {
      if (!seedPending.current) setMembers([]);
      return;
    }
    if (seedPending.current) {
      seedPending.current = false;
      return;
    }
    setMembers([]);
    let cancelled = false;
    fetch(`/api/chat/who/${room}`)
      .then(res => res.json())
      .then((data: { members?: ChatMember[] }) => {
        if (!cancelled) setMembers(data.members ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [room]);

  return members.map(m => m.handle);
}

/**
 * No rooms at all: nobody is signed in anywhere and the human has joined
 * nothing. Distinct from "rooms exist but none selected".
 *
 * The copy matters. This used to read "the chat feature hasn't landed here
 * yet", which was Task 1 scaffold text and became actively false the moment
 * chat shipped -- it said the app was unfinished when the truth was that the
 * fleet was asleep.
 */
function RoomsPlaceholder({ anyBuddies }: { anyBuddies: boolean }) {
  return (
    <Center mih="40dvh">
      <Stack align="center" gap={4}>
        <Text fw={600}>No rooms</Text>
        <Text size="sm" c="dimmed">
          {anyBuddies
            ? 'Agents are signed in but not in a room yet.'
            : 'No agent has signed in. A room appears when one does.'}
        </Text>
      </Stack>
    </Center>
  );
}

/* ------------------------------------------------------------------ */
/* Phone chrome (Task 7) -- Phone.dc.html / PhoneRooms.dc.html.        */
/* Nothing above this point is responsive; the phone layout is its own */
/* shell, not a squashed version of the desktop one.                   */
/* ------------------------------------------------------------------ */

/** Every phone header/drawer control is 44px -- `.aicon.tap`, the hit-target
    floor CONFORMANCE.md pins. */
const PHONE_TAP = 44;
const PHONE_MUTED = 'var(--tk-muted-text)';
const PHONE_BORDER = 'var(--tk-border)';

function tapButtonStyle(size: number) {
  return {
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    width: size,
    height: size,
    flex: 'none' as const,
    borderRadius: 'var(--mantine-radius-md)',
    color: PHONE_MUTED,
    background: 'transparent',
    border: 0,
  };
}

function FleetDot({ color }: { color: string }) {
  return (
    <Box
      component="span"
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        flex: 'none',
      }}
    />
  );
}

function roomHeaderTitle(room: RoomSummary | undefined): string {
  if (!room) return '';
  return room.kind === 'dm' && room.participants
    ? `${room.participants.a} ↔ ${room.participants.b}`
    : `#${room.room}`;
}

/**
 * The 56px phone header: the drawer toggle, the room/pair title, and the
 * fleet counts as ONE tap target that also opens the drawer -- there is no
 * separate members button.
 */
function PhoneHeader({
  room,
  buddies,
  reachable,
  onOpenDrawer,
  memberHandles,
  onArchive,
}: {
  room: RoomSummary | undefined;
  buddies: Buddy[];
  reachable: boolean;
  onOpenDrawer: () => void;
  memberHandles: string[];
  onArchive: (room: string, archived: boolean) => void;
}) {
  const live = buddies.filter(b => b.status === 'live').length;
  const idle = buddies.filter(b => b.status === 'idle').length;
  const deaf = buddies.filter(b => b.status === 'deaf').length;

  return (
    <Group
      wrap="nowrap"
      gap={4}
      data-testid="phone-header"
      style={{
        height: 56,
        flex: 'none',
        padding: '0 6px 0 2px',
        background: 'var(--tk-panel)',
        borderBottom: `1px solid ${PHONE_BORDER}`,
      }}
    >
      <UnstyledButton
        aria-label="Rooms and members"
        data-testid="phone-drawer-toggle"
        onClick={onOpenDrawer}
        style={tapButtonStyle(PHONE_TAP)}
      >
        <Icon name="panelLeftOpen" size={20} />
      </UnstyledButton>
      <Text truncate fw={700} style={{ fontSize: 15, minWidth: 0 }}>
        {roomHeaderTitle(room)}
      </Text>
      <Box style={{ flex: 1 }} />
      <UnstyledButton
        aria-label={
          reachable
            ? `Buddies: ${live} listening, ${idle} idle, ${deaf} deaf`
            : 'Buddies unavailable while the daemon is down'
        }
        data-testid="phone-fleet-toggle"
        onClick={onOpenDrawer}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: PHONE_TAP,
          padding: '0 8px',
          borderRadius: 'var(--mantine-radius-md)',
          background: 'transparent',
          border: 0,
        }}
      >
        {reachable ? (
          <>
            <FleetDot color="var(--tk-dot-ok)" />
            <Text size="xs" style={{ color: 'var(--mantine-color-ok-text)' }}>
              {live}
            </Text>
            <FleetDot color="var(--tk-dot-warn)" />
            <Text size="xs" style={{ color: 'var(--mantine-color-warn-text)' }}>
              {idle}
            </Text>
            <FleetDot color="var(--tk-dot-bad)" />
            <Text size="xs" style={{ color: 'var(--mantine-color-bad-text)' }}>
              {deaf}
            </Text>
          </>
        ) : (
          <Text size="xs" style={{ color: PHONE_MUTED }}>
            presence withheld
          </Text>
        )}
      </UnstyledButton>
      {room && (
        <RoomMenu
          room={room}
          memberHandles={memberHandles}
          onArchive={onArchive}
          size={PHONE_TAP}
        />
      )}
    </Group>
  );
}

/** One 44px room row inside the drawer -- `RoomRail`'s own `.room` anatomy
    at the phone's taller tap-target height, badges included. */
function PhoneRoomRow({
  room,
  active,
  archived,
  onSelect,
}: {
  room: RoomSummary;
  active: boolean;
  archived?: boolean;
  onSelect: () => void;
}) {
  const isDm = room.kind === 'dm';
  const title = isDm && room.participants ? roomHeaderTitle(room) : room.room;
  const accentText = 'var(--mantine-color-accent-text)';

  return (
    <UnstyledButton
      data-testid={`phone-room-${room.room}`}
      data-archived={archived ? 'true' : undefined}
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--mantine-spacing-sm)',
        height: PHONE_TAP,
        width: '100%',
        minWidth: 0,
        padding: '0 var(--mantine-spacing-md)',
        borderRadius: 'var(--mantine-radius-md)',
        background: active
          ? 'color-mix(in srgb, var(--mantine-color-accent-text) var(--tk-wash), transparent)'
          : undefined,
        color: active ? accentText : undefined,
        opacity: archived ? 0.6 : undefined,
      }}
    >
      {!isDm && (
        <Icon
          name="hash"
          size={14}
          color={active ? accentText : PHONE_MUTED}
          style={{ flex: 'none' }}
        />
      )}
      <Text
        truncate
        fw={active ? 600 : undefined}
        style={{ flex: 1, minWidth: 0, fontSize: 14 }}
      >
        {title}
      </Text>
      {!archived && room.mentions > 0 && (
        <Box
          component="span"
          aria-label={`${room.mentions} mention`}
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
            background:
              'light-dark(var(--mantine-color-accent-7), var(--mantine-color-accent-text))',
            color: 'light-dark(var(--mantine-color-white), var(--tk-bg))',
          }}
        >
          @{room.mentions}
        </Box>
      )}
      {!archived && room.unread > 0 && (
        <Box
          component="span"
          aria-label={`${room.unread} unread`}
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
            border: `1px solid ${PHONE_BORDER}`,
            color: PHONE_MUTED,
          }}
        >
          {room.unread}
        </Box>
      )}
    </UnstyledButton>
  );
}

/**
 * The rooms/roster Drawer (`PhoneRooms.dc.html`): rooms with the same
 * badges, the direct section, then buddies rendered by `Roster` with
 * `compact`. Tapping a buddy inserts `@handle` when in the room, otherwise
 * opens the DM room, and closes -- same as `Roster`'s desktop-panel `onPick`.
 */
function PhoneDrawer({
  opened,
  onClose,
  rooms,
  activeRoom,
  onSelectRoom,
  buddies,
  roomMembers,
  daemonReachable,
  onMention,
  onOpenDm,
}: {
  opened: boolean;
  onClose: () => void;
  rooms: RoomSummary[];
  activeRoom: string | undefined;
  onSelectRoom: (room: string) => void;
  buddies: Buddy[];
  roomMembers: string[];
  daemonReachable: boolean;
  onMention: (handle: string) => void;
  onOpenDm: (handle: string) => void;
}) {
  const { computedColorScheme, setColorScheme } = useColorScheme();
  const isDark = computedColorScheme === 'dark';
  const openRooms = rooms.filter(r => r.archivedAt === undefined);
  const channelRooms = openRooms.filter(r => r.kind !== 'dm');
  const directRooms = openRooms.filter(r => r.kind === 'dm');
  const archivedRooms = rooms.filter(r => r.archivedAt !== undefined);
  const [archivedCollapsed, setArchivedCollapsed] = useLocalStorage<boolean>({
    key: 'chat.rail.archived',
    defaultValue: true,
  });

  function selectRoom(room: string) {
    onSelectRoom(room);
    onClose();
  }

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="left"
      // Not `size="sm"`: this app's theme resolves that to 380px, which is
      // WIDER than the 375px screen the artboard draws it on, so the panel
      // covers the page and the 0.4 overlay never shows. A drawer with no
      // visible backdrop does not read as a drawer -- it reads as a route
      // change, and the tap-outside-to-close affordance disappears with it.
      // 86vw keeps the artboard's sliver at every phone width.
      size="86vw"
      withCloseButton={false}
      overlayProps={{ backgroundOpacity: 0.4 }}
      padding={0}
      data-testid="phone-drawer"
    >
      <Stack
        gap={2}
        style={{ height: '100%', padding: '11.2px 6px', minHeight: 0 }}
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

        <Group
          justify="space-between"
          wrap="nowrap"
          style={{ padding: '6px var(--mantine-spacing-md)', flex: 'none' }}
        >
          <Text
            size="xs"
            fw={600}
            style={{ color: PHONE_MUTED, letterSpacing: '0.04em' }}
          >
            ROOMS
          </Text>
          <Text size="xs" style={{ color: PHONE_MUTED }}>
            {channelRooms.length}
          </Text>
        </Group>
        {channelRooms.map(room => (
          <PhoneRoomRow
            key={room.room}
            room={room}
            active={room.room === activeRoom}
            onSelect={() => selectRoom(room.room)}
          />
        ))}

        {directRooms.length > 0 && (
          <>
            <Group
              gap={6}
              wrap="nowrap"
              style={{
                padding: '10px var(--mantine-spacing-md) 4px',
                borderBottom: '1px solid var(--tk-border-soft)',
                flex: 'none',
              }}
            >
              <Text
                fw={700}
                style={{
                  fontSize: '9.5px',
                  color: PHONE_MUTED,
                  letterSpacing: '0.06em',
                }}
              >
                DIRECT
              </Text>
            </Group>
            {directRooms.map(room => (
              <PhoneRoomRow
                key={room.room}
                room={room}
                active={room.room === activeRoom}
                onSelect={() => selectRoom(room.room)}
              />
            ))}
          </>
        )}

        {archivedRooms.length > 0 && (
          <>
            <UnstyledButton
              data-testid="phone-archived-toggle"
              aria-expanded={!archivedCollapsed}
              onClick={() => setArchivedCollapsed(!archivedCollapsed)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                padding: '10px var(--mantine-spacing-md) 4px',
                borderBottom: '1px solid var(--tk-border-soft)',
                flex: 'none',
              }}
            >
              <Text
                fw={700}
                style={{
                  fontSize: '9.5px',
                  color: PHONE_MUTED,
                  letterSpacing: '0.06em',
                }}
              >
                ARCHIVED
              </Text>
              <Text size="xs" style={{ color: PHONE_MUTED }}>
                {archivedRooms.length}
              </Text>
              <Box style={{ flex: 1 }} />
              <AnimatedChevron
                opened={!archivedCollapsed}
                size={12}
                color={PHONE_MUTED}
              />
            </UnstyledButton>
            {!archivedCollapsed &&
              archivedRooms.map(room => (
                <PhoneRoomRow
                  key={room.room}
                  room={room}
                  archived
                  active={room.room === activeRoom}
                  onSelect={() => selectRoom(room.room)}
                />
              ))}
          </>
        )}

        <Group
          justify="space-between"
          wrap="nowrap"
          style={{ padding: '10px var(--mantine-spacing-md) 0', flex: 'none' }}
        >
          <Text
            size="xs"
            fw={600}
            style={{ color: PHONE_MUTED, letterSpacing: '0.04em' }}
          >
            BUDDIES
          </Text>
          <Text size="xs" style={{ color: PHONE_MUTED }}>
            tap to mention or DM
          </Text>
        </Group>
        <Box
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '0 var(--mantine-spacing-md)',
          }}
        >
          <Roster
            buddies={buddies}
            now={Date.now()}
            roomMembers={roomMembers}
            daemonReachable={daemonReachable}
            compact
            onPick={(handle, { inRoom }) => {
              if (inRoom) onMention(handle);
              else onOpenDm(handle);
              onClose();
            }}
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

/**
 * The phone shell: `PhoneHeader`, the transcript, the composer (`phone`
 * chrome: 16px input, 44px send, Enter is a newline), and `PhoneDrawer`.
 * Not the desktop 3-column layout squashed -- a dedicated shell, since the
 * artboard draws none of the rail, the wordmark header, or the page bar on
 * a 390px screen.
 */
function PhoneChat({
  daemon,
  buddies,
  rooms,
  activeRoom,
  setActiveRoom,
  activeRoomSummary,
  messages,
  anchor,
  roomMembers,
  composerRef,
  onOpenDm,
  onArchive,
}: {
  daemon: ReturnType<typeof useDaemonHealth>;
  buddies: Buddy[];
  rooms: RoomSummary[];
  activeRoom: string | undefined;
  setActiveRoom: (room: string) => void;
  activeRoomSummary: RoomSummary | undefined;
  messages: ChatMessage[];
  anchor: string | undefined;
  roomMembers: string[];
  composerRef: RefObject<ComposerHandle | null>;
  onOpenDm: (handle: string) => void;
  onArchive: (room: string, archived: boolean) => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <Box
      data-testid="phone-shell"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100dvh',
        background: 'var(--ui-bg-1)',
      }}
    >
      <PhoneHeader
        room={activeRoomSummary}
        buddies={buddies}
        reachable={daemon.reachable}
        onOpenDrawer={() => setDrawerOpen(true)}
        memberHandles={roomMembers}
        onArchive={onArchive}
      />

      <DaemonBanner
        reachable={daemon.reachable}
        downSince={daemon.downSince}
        probeCount={daemon.probeCount}
        lastAnsweredAt={daemon.lastAnsweredAt}
        onProbeNow={daemon.probeNow}
      />

      {activeRoom && (
        <Box
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '9.6px 11.2px 0',
          }}
        >
          <Transcript
            room={activeRoom}
            messages={messages}
            anchor={anchor}
            unreadCount={activeRoomSummary?.unread}
            bare
          />
        </Box>
      )}

      {activeRoom &&
        (activeRoomSummary?.archivedAt !== undefined ? (
          <ArchivedBar
            phone
            archivedAt={activeRoomSummary.archivedAt}
            onReopen={() => onArchive(activeRoom, false)}
          />
        ) : (
          <Composer
            ref={composerRef}
            phone
            room={activeRoom}
            roomMembers={roomMembers}
            buddies={buddies}
            isDm={activeRoomSummary?.kind === 'dm'}
            daemonReachable={daemon.reachable}
            onOpenDm={onOpenDm}
          />
        ))}

      <PhoneDrawer
        opened={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        rooms={rooms}
        activeRoom={activeRoom}
        onSelectRoom={setActiveRoom}
        buddies={buddies}
        roomMembers={roomMembers}
        daemonReachable={daemon.reachable}
        onMention={handle => composerRef.current?.insertMention(handle)}
        onOpenDm={handle => {
          onOpenDm(handle);
          setDrawerOpen(false);
        }}
      />
    </Box>
  );
}

/**
 * The whole app, today: the fixed rail + header chrome (`AppChrome`) around
 * the Rooms placeholder, routed by the hand-rolled history router in
 * ./router (no router dependency). The kit's full-screen PageShell demo
 * stays reachable at '/demo' -- inherited scaffold content, unrelated to
 * chat, and it bypasses the chrome entirely the same way it always has.
 *
 * `initialState` seeds the daemon-health and buddies data instead of a
 * network call -- the seam every UI test in this repo uses. Production
 * never passes it: the daemon poll and the buddies fetch run for real.
 */
export function App({ initialState }: { initialState?: AppInitialState } = {}) {
  const [path] = useLocation();
  const route = useAppRoute();
  const daemon = useDaemonHealth(initialState?.daemonReachable);
  const buddies = useBuddies(initialState?.buddies);
  const { rooms, refetchRooms } = useRooms(initialState?.rooms);
  // A post clears a room's archivedAt server-side (a post revives it) while
  // the transcript already streams those posts live; without a poll an
  // archived room would keep its read-only ArchivedBar over the new messages
  // until a manual refresh. Matches the buddies/daemon 5s cadence.
  useInterval(refetchRooms, 5000);
  const routeRoom = route.name === 'room' ? route.room : undefined;
  const [activeRoom, setActiveRoom] = useState<string | undefined>(routeRoom);
  const chatRoute = route.name === 'home' || route.name === 'room';
  const hash = useHash();
  const anchor = hash.startsWith('#m-') ? hash.slice(1) : undefined;
  const isMobile = useIsMobile();
  const composerRef = useRef<ComposerHandle>(null);

  // The URL owns the room: `/r/<room>` names it, and `/` means the first
  // room, including after Back from a pick. A rail click writes the URL
  // (selectRoom), so a room the viewer chose is always a `/r/` route.
  useEffect(() => {
    if (route.name === 'room') {
      if (route.room !== activeRoom) setActiveRoom(route.room);
    } else if (route.name === 'home' && rooms.length > 0) {
      // The listing now includes archived rooms, alphabetically ordered, so
      // the first row can be an archived (read-only) room. Land on the first
      // OPEN room, falling back to the first row only if every room is
      // archived.
      const first = (rooms.find(r => r.archivedAt === undefined) ?? rooms[0]!)
        .room;
      if (activeRoom !== first) setActiveRoom(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.name, routeRoom, rooms]);

  function selectRoom(room: string) {
    setActiveRoom(room);
    const to = `/r/${encodeURIComponent(room)}`;
    if (window.location.pathname !== to) navigate(to);
  }

  const openDm = useCallback(
    async (handle: string) => {
      try {
        const res = await fetch('/api/chat/dm/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: handle }),
        });
        if (!res.ok) throw new Error('dm open failed');
        const data = (await res.json()) as { room: string };
        void refetchRooms();
        setActiveRoom(data.room);
        const to = `/r/${encodeURIComponent(data.room)}`;
        if (window.location.pathname !== to) navigate(to);
        composerRef.current?.focus();
      } catch {
        notifications.error("Couldn't open the DM");
      }
    },
    [refetchRooms]
  );

  const setArchived = useCallback(
    async (room: string, archived: boolean) => {
      try {
        const res = await fetch('/api/chat/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room, archived }),
        });
        if (!res.ok) throw new Error('archive failed');
      } catch {
        notifications.error(
          archived ? "Couldn't archive the room" : "Couldn't reopen the room"
        );
        return;
      }
      const next = await refetchRooms();
      // Archiving a fleet (agent-to-agent) DM leaves the human no membership
      // row, so it drops out of his listing entirely. Staying on it would
      // fall the footer through to the composer for a room the rail no longer
      // shows, with no Reopen; navigate to the same open-first landing the
      // home route uses. A room still listed (a normal archive, or a reopen)
      // keeps the page where it is.
      if (
        archived &&
        room === activeRoom &&
        next.length > 0 &&
        !next.some(r => r.room === room)
      ) {
        const fallback = (
          next.find(r => r.archivedAt === undefined) ?? next[0]!
        ).room;
        setActiveRoom(fallback);
        const to = `/r/${encodeURIComponent(fallback)}`;
        if (window.location.pathname !== to) navigate(to);
      }
    },
    [refetchRooms, activeRoom]
  );

  const buddyActions = useMemo(
    () => ({
      mention: (handle: string) => composerRef.current?.insertMention(handle),
      dm: (handle: string) => void openDm(handle),
    }),
    [openDm]
  );
  const [roomOrder, setRoomOrder] = useState<RoomOrder>('join');
  const orderedRooms =
    roomOrder === 'name'
      ? [...rooms].sort((a, b) => a.room.localeCompare(b.room))
      : rooms;

  const messages = useMessages(activeRoom, initialState?.messages);
  const roomMembers = useRoomMembers(activeRoom, initialState?.members);
  const activeRoomSummary = rooms.find(r => r.room === activeRoom);

  // Each route change starts at the top of the new page.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  if (route.name === 'demo-page-shell') {
    return <PageShellDemoPage />;
  }

  if (chatRoute && isMobile && rooms.length > 0) {
    return (
      <PhoneChat
        daemon={daemon}
        buddies={buddies}
        rooms={rooms}
        activeRoom={activeRoom}
        setActiveRoom={selectRoom}
        activeRoomSummary={activeRoomSummary}
        messages={messages}
        anchor={anchor}
        roomMembers={roomMembers}
        composerRef={composerRef}
        onOpenDm={openDm}
        onArchive={setArchived}
      />
    );
  }

  return (
    <BuddiesProvider
      buddies={buddies}
      roomMembers={roomMembers}
      now={Date.now()}
      reachable={daemon.reachable}
      actions={buddyActions}
    >
      <AppChrome>
        {chatRoute ? (
          // The kit's own page layout: rooms in the collapsible Sidebar (a
          // drawer on phones), the page bar as the Header, the daemon banner in
          // Content's notch slot, and a scroll-clamped Content whose transcript
          // and roster manage their own scrolling. No ContentContainer: the
          // capped, centred column is what boxed this page before.
          <PageShell
            scrollClamp
            sidebarWidth={244}
            drawerStateKey="chat-rooms-sidebar"
          >
            {rooms.length > 0 && (
              <PageShell.Sidebar>
                <RoomRail
                  sidebar
                  rooms={orderedRooms}
                  activeRoom={activeRoom}
                  onSelectRoom={selectRoom}
                />
              </PageShell.Sidebar>
            )}
            <PageShell.Main>
              {rooms.length > 0 && activeRoomSummary && (
                <PageShell.Header>
                  <PageBar
                    room={activeRoomSummary}
                    buddies={buddies.filter(b =>
                      roomMembers.includes(b.handle)
                    )}
                    reachable={daemon.reachable}
                    order={roomOrder}
                    onOrderChange={setRoomOrder}
                    onMarkRead={() => void refetchRooms()}
                    memberHandles={roomMembers}
                    onArchive={setArchived}
                  />
                </PageShell.Header>
              )}
              <PageShell.Content
                contentContainer={false}
                topNotch={{
                  opened: !daemon.reachable,
                  content: (
                    <Box
                      w="100%"
                      px="lg"
                      pt="lg"
                      data-testid="daemon-banner-slot"
                    >
                      <DaemonBanner
                        reachable={daemon.reachable}
                        downSince={daemon.downSince}
                        probeCount={daemon.probeCount}
                        lastAnsweredAt={daemon.lastAnsweredAt}
                        onProbeNow={daemon.probeNow}
                      />
                    </Box>
                  ),
                }}
              >
                <Group
                  align="stretch"
                  wrap="nowrap"
                  gap={0}
                  style={{ flex: 1, minHeight: 0, minWidth: 0 }}
                >
                  {rooms.length === 0 ? (
                    <Box style={{ flex: 1, minWidth: 0 }} p="xl">
                      <RoomsPlaceholder anyBuddies={buddies.length > 0} />
                    </Box>
                  ) : (
                    activeRoom && (
                      <Transcript
                        room={activeRoom}
                        messages={messages}
                        anchor={anchor}
                        unreadCount={activeRoomSummary?.unread}
                        footer={
                          activeRoomSummary?.archivedAt !== undefined ? (
                            <ArchivedBar
                              archivedAt={activeRoomSummary.archivedAt}
                              onReopen={() =>
                                void setArchived(activeRoom, false)
                              }
                            />
                          ) : (
                            <Composer
                              ref={composerRef}
                              room={activeRoom}
                              roomMembers={roomMembers}
                              buddies={buddies}
                              isDm={activeRoomSummary?.kind === 'dm'}
                              daemonReachable={daemon.reachable}
                              onOpenDm={openDm}
                            />
                          )
                        }
                      />
                    )
                  )}
                  {(rooms.length > 0 || buddies.length > 0) && (
                    <Roster
                      panel
                      buddies={buddies}
                      now={Date.now()}
                      roomMembers={roomMembers}
                      daemonReachable={daemon.reachable}
                      onPick={(handle, { inRoom }) => {
                        if (inRoom) composerRef.current?.insertMention(handle);
                        else void openDm(handle);
                      }}
                    />
                  )}
                </Group>
              </PageShell.Content>
            </PageShell.Main>
          </PageShell>
        ) : (
          <NotFoundPage />
        )}
      </AppChrome>
    </BuddiesProvider>
  );
}
