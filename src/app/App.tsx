import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import {
  DaemonBanner,
  MattstackShell,
  NotFoundPage,
  useDaemonHealth,
} from '@mattstack/app-kit/app';
import {
  Box,
  Center,
  Drawer,
  Group,
  PageShell,
  Stack,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { ThemeOverrideWrapper } from '@mattstack/app-kit/design-system';
import { useColorScheme, useIsMobile } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import { notifications } from '@mattstack/app-kit/notifications';
import { RailLink } from '@mattstack/app-kit/router';
import type {
  ChatMember,
  ChatMessage,
  ChatPane,
  InviteResult,
  RoomSummary,
} from '@mattstack/rt-client';
import { useInterval } from 'react-interval-hook';
import { useLocation } from 'wouter';
import { navigate } from 'wouter/use-browser-location';

import { BuddiesProvider } from './buddies-context';
import { chatFontTheme } from './chat-font-theme';
import { AppMark } from './chrome/AppMark';
import { Composer, type ComposerHandle } from './Composer';
import { PageShellDemoPage } from './demo/PageShellDemoPage';
import { HUMAN_HANDLE } from './human';
import { postMarkRead } from './mark-read';
import { NewRoomModal } from './NewRoomModal';
import { PageBar, RoomMenu, type RoomOrder } from './PageBar';
import { PanePickerProvider, usePanePicker } from './PanePicker';
import { useRelayFrames, useRelayOpen } from './relay-socket';
import { RoomRail } from './RoomRail';
import { Roster, type RosterBuddy } from './Roster';
import { useAppRoute, useHash } from './routes';
import { Transcript } from './Transcript';
import { visibleRooms } from './visible-rooms';

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

/** A `chat/<room>/msg` relay topic -- the only frame the daemon still emits
    for chat (delivery v2 dropped the separate `chat/wake/<handle>` relay). */
function isMsgTopic(topic: unknown): topic is string {
  return (
    typeof topic === 'string' &&
    topic.startsWith('chat/') &&
    topic.endsWith('/msg')
  );
}

/**
 * Fetches the buddy roster on mount (skipped when `seed` replaces it, the
 * same test seam `useDaemonHealth` reads), every 5s, and again on any
 * `chat/<room>/msg` frame from the page's relay socket. A post is a hint a
 * buddy's presence may have moved (it is the daemon's own signal that a
 * session touched something), not that its status changed -- the daemon
 * still owns status, always -- but it is worth refreshing before the next
 * scheduled poll.
 */
function useBuddies(seed: Buddy[] | undefined): {
  buddies: Buddy[];
  refetchBuddies: () => void;
} {
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

  useRelayFrames(frame => {
    if (isMsgTopic(frame.topic)) fetchBuddies();
  });

  return { buddies, refetchBuddies: fetchBuddies };
}

/**
 * Fetches the room list on mount (skipped when `seed` replaces it) and
 * exposes `refetchRooms` for after a write that can introduce a room the
 * mount-time fetch never saw -- `openDm` opens or reuses a room this list
 * has no reason to have fetched yet.
 */
function useRooms(seed: RoomSummary[] | undefined) {
  const [rooms, setRooms] = useState<RoomSummary[]>(seed ?? []);

  // Resolves to the fetched list for a caller that wants it directly. A
  // failed fetch resolves to [] with `rooms` left untouched, rather than
  // reading as every room vanishing.
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

  const roomsRef = useRef(rooms);
  // Mirror rooms into the ref from an effect, never in render: a discarded
  // concurrent render must not leave the ref holding an uncommitted list. The
  // relay callback below only ever reads it after commit, so an effect is soon
  // enough.
  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);
  // A post into a room this list has never seen is the daemon's only signal
  // that a room exists now; refetch at once instead of waiting for the poll.
  useRelayFrames(frame => {
    if (!isMsgTopic(frame.topic)) return;
    const room = frame.topic.slice('chat/'.length, -'/msg'.length);
    if (!roomsRef.current.some(r => r.room === room)) void refetchRooms();
  });

  return { rooms, setRooms, refetchRooms };
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
): { members: string[]; refetchMembers: () => void } {
  const [members, setMembers] = useState<ChatMember[]>(seed ?? []);
  // Same one-shot rule as useMessages: pending until the first defined room.
  const seedPending = useRef(seed !== undefined);
  const roomRef = useRef(room);
  roomRef.current = room;

  const fetchMembers = useCallback(() => {
    if (!room) return;
    fetch(`/api/chat/who/${room}`)
      .then(res => res.json())
      .then((data: { members?: ChatMember[] }) => {
        if (roomRef.current === room) setMembers(data.members ?? []);
      })
      .catch(() => {});
  }, [room]);

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
    fetchMembers();
  }, [room, fetchMembers]);

  // A post is the one signal an arriving member makes: the join skill's
  // first line. The daemon emits no membership frame, so this is the hook.
  useRelayFrames(frame => {
    if (room && frame.topic === `chat/${room}/msg`) fetchMembers();
  });

  return { members: members.map(m => m.handle), refetchMembers: fetchMembers };
}

/**
 * Whether herdr is up (so there are panes to invite). Polls `GET /api/panes`
 * on mount and every 30s. `undefined` until the first answer, which is the
 * gate the entry points read: the `+` and `add agents` mount only once this
 * is `true`, so neither flashes before herdr's availability is known.
 */
function usePanesAvailable(): boolean | undefined {
  const [available, setAvailable] = useState<boolean | undefined>(undefined);
  const probe = useCallback(() => {
    fetch('/api/panes')
      .then(res =>
        res.json().then((data: { available?: boolean }) => {
          // Herdr genuinely absent (a 200 saying so) is the only case that
          // hides the entry points. A daemon-down response (502) or a
          // network error keeps them mounted so `daemonReachable` disables
          // them instead, per the spec's failure table.
          if (res.ok) setAvailable(data.available === true);
          else setAvailable(true);
        })
      )
      .catch(() => setAvailable(true));
  }, []);
  useEffect(() => {
    probe();
  }, [probe]);
  useInterval(probe, 30_000);
  return available;
}

/**
 * The transcript-edge line after a create-room or add-agents: `invited N`,
 * one span per pane coloured by its delivery, then the standing note that
 * members surface as they sign in. A pane is named by its live handle, else
 * its workspace, else the bare id.
 */
export function resultLine(
  results: InviteResult[],
  panes: ChatPane[]
): ReactNode {
  const label = (r: InviteResult) => {
    const pane = panes.find(p => p.paneId === r.paneId);
    const name =
      pane?.presence?.handle ??
      (pane?.workspace ? `${pane.workspace} pane` : r.paneId);
    if (r.delivered === 'accepted')
      return (
        <span key={r.paneId} style={{ color: 'var(--mantine-color-ok-text)' }}>
          {name} accepted
        </span>
      );
    if (r.delivered === 'queued')
      return (
        <span
          key={r.paneId}
          style={{ color: 'var(--mantine-color-warn-text)' }}
        >
          {name} queued (working)
        </span>
      );
    return (
      <span key={r.paneId} style={{ color: 'var(--mantine-color-bad-text)' }}>
        {name} refused: {r.reason ?? 'unknown'}
      </span>
    );
  };
  return (
    <>
      invited {results.length}
      {results.map(r => (
        <span key={r.paneId}> · {label(r)}</span>
      ))}
      {' · members appear as they sign in'}
    </>
  );
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
function RoomsPlaceholder({
  anyBuddies,
  allClosed,
}: {
  anyBuddies: boolean;
  allClosed: boolean;
}) {
  return (
    <Center mih="40dvh">
      <Stack align="center" gap="xs">
        <Text fw={600}>No rooms</Text>
        <Text size="sm" c="dimmed">
          {allClosed
            ? 'Every room is closed. A post from anyone brings its room back, and the + starts a new one.'
            : anyBuddies
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

function FleetDot({ color, hollow }: { color?: string; hollow?: boolean }) {
  return (
    <Box
      component="span"
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: hollow ? 'transparent' : color,
        border: hollow ? '1px solid var(--tk-border)' : undefined,
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
  onCloseRoom,
}: {
  room: RoomSummary | undefined;
  buddies: Buddy[];
  reachable: boolean;
  onOpenDrawer: () => void;
  onCloseRoom: (room: string) => void;
}) {
  const live = buddies.filter(b => b.status === 'live').length;
  const idle = buddies.filter(b => b.status === 'idle').length;
  const offline = buddies.filter(b => b.status === 'offline').length;

  return (
    <Group
      wrap="nowrap"
      gap="xs"
      data-testid="phone-header"
      style={{
        height: 56,
        flex: 'none',
        padding: '0 var(--mantine-spacing-sm) 0 2px',
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
      <Text
        truncate
        fw={700}
        style={{ fontSize: 'var(--mantine-font-size-sm)', minWidth: 0 }}
      >
        {roomHeaderTitle(room)}
      </Text>
      <Box style={{ flex: 1 }} />
      <UnstyledButton
        aria-label={
          reachable
            ? `Buddies: ${live} working, ${idle} idle, ${offline} offline`
            : 'Buddies unavailable while the daemon is down'
        }
        data-testid="phone-fleet-toggle"
        onClick={onOpenDrawer}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--mantine-spacing-sm)',
          height: PHONE_TAP,
          padding: '0 var(--mantine-spacing-sm)',
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
            <FleetDot hollow />
            <Text size="xs" style={{ color: PHONE_MUTED }}>
              {offline}
            </Text>
          </>
        ) : (
          <Text size="xs" style={{ color: PHONE_MUTED }}>
            presence withheld
          </Text>
        )}
      </UnstyledButton>
      {room && <RoomMenu room={room} onClose={onCloseRoom} size={PHONE_TAP} />}
    </Group>
  );
}

/** One 44px room row inside the drawer -- `RoomRail`'s own `.room` anatomy
    at the phone's taller tap-target height, badges included. */
function PhoneRoomRow({
  room,
  active,
  onSelect,
}: {
  room: RoomSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const isDm = room.kind === 'dm';
  const title = isDm && room.participants ? roomHeaderTitle(room) : room.room;
  const accentText = 'var(--mantine-color-accent-text)';

  return (
    <UnstyledButton
      data-testid={`phone-room-${room.room}`}
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
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 'var(--mantine-font-size-lg)',
        }}
      >
        {title}
      </Text>
      {room.mentions > 0 && (
        <Box
          component="span"
          aria-label={`${room.mentions} mention`}
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
            background:
              'light-dark(var(--mantine-color-accent-7), var(--mantine-color-accent-text))',
            color: 'light-dark(var(--mantine-color-white), var(--tk-bg))',
          }}
        >
          @{room.mentions}
        </Box>
      )}
      {room.unread > 0 && (
        <Box
          component="span"
          aria-label={`${room.unread} unread`}
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
  const shown = visibleRooms(rooms, activeRoom);
  const channelRooms = shown.filter(r => r.kind !== 'dm');
  const directRooms = shown.filter(r => r.kind === 'dm');

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

        <Group
          justify="space-between"
          wrap="nowrap"
          style={{
            padding: 'var(--mantine-spacing-sm) var(--mantine-spacing-md)',
            flex: 'none',
          }}
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
              gap="sm"
              wrap="nowrap"
              style={{
                padding:
                  'var(--mantine-spacing-md) var(--mantine-spacing-md) var(--mantine-spacing-xs)',
                borderBottom: '1px solid var(--tk-border-soft)',
                flex: 'none',
              }}
            >
              <Text
                fw={700}
                style={{
                  fontSize: 'var(--tk-fs-4xs)',
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

        <Group
          justify="space-between"
          wrap="nowrap"
          style={{
            padding: 'var(--mantine-spacing-md) var(--mantine-spacing-md) 0',
            flex: 'none',
          }}
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
  onCloseRoom,
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
  onCloseRoom: (room: string) => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <ThemeOverrideWrapper theme={chatFontTheme}>
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
          onCloseRoom={onCloseRoom}
        />

        <DaemonBanner
          reachable={daemon.reachable}
          downSince={daemon.downSince}
          probeCount={daemon.probeCount}
          lastAnsweredAt={daemon.lastAnsweredAt}
          onProbeNow={daemon.probeNow}
        />

        {activeRoom && (
          // `display: flex` here, not just `flex: 1`: a bare Transcript root
          // sizes ITSELF via `flex: 1; min-height: 0` on the assumption its
          // parent is a flex container -- a plain (block) Box gives it no
          // such context, so it falls back to auto height and its own inner
          // scroll box (also `flex: 1; min-height: 0`) collapses to zero.
          // Scrolling belongs to Transcript's own scroll view, so this
          // wrapper stays a non-scrolling flex column, not `overflowY: auto`.
          <Box
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              padding: 'var(--mantine-spacing-md) var(--mantine-spacing-lg) 0',
            }}
          >
            <Transcript
              room={activeRoom}
              messages={messages}
              humanHandle={HUMAN_HANDLE}
              anchor={anchor}
              unreadCount={activeRoomSummary?.unread}
              bare
            />
          </Box>
        )}

        {activeRoom && (
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
        )}

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
    </ThemeOverrideWrapper>
  );
}

interface ChatPageProps {
  rooms: RoomSummary[];
  openRooms: RoomSummary[];
  railRooms: RoomSummary[];
  activeRoom: string | undefined;
  activeRoomSummary: RoomSummary | undefined;
  selectRoom: (room: string) => void;
  roomOrder: RoomOrder;
  setRoomOrder: (order: RoomOrder) => void;
  refetchRooms: () => Promise<RoomSummary[]>;
  daemon: ReturnType<typeof useDaemonHealth>;
  buddies: Buddy[];
  roomMembers: string[];
  messages: ChatMessage[];
  anchor: string | undefined;
  composerRef: RefObject<ComposerHandle | null>;
  onOpenDm: (handle: string) => void;
  onCloseRoom: (room: string) => void;
  onMarkRead: (room: string) => void;
}

/**
 * The desktop chat page, rendered inside `PanePickerProvider` so it -- and
 * the `NewRoomModal` it mounts -- can `usePanePicker()`. Owns the two invite
 * entry points (the rail `+` and the page-bar `add agents`), the new-room
 * modal, and the transcript-edge invite notice; every other prop is passed
 * down from `App`, whose behaviour this extraction preserves verbatim.
 */
function ChatPage({
  rooms,
  openRooms,
  railRooms,
  activeRoom,
  activeRoomSummary,
  selectRoom,
  roomOrder,
  setRoomOrder,
  refetchRooms,
  daemon,
  buddies,
  roomMembers,
  messages,
  anchor,
  composerRef,
  onOpenDm,
  onCloseRoom,
  onMarkRead,
}: ChatPageProps) {
  const pickPanes = usePanePicker();
  const panesAvailable = usePanesAvailable();
  const [newRoomOpen, setNewRoomOpen] = useState(false);
  const [notice, setNotice] = useState<{
    room: string;
    node: ReactNode;
  } | null>(null);

  // The notice belongs to the room it was raised in; a room switch clears it.
  useEffect(() => {
    if (notice && notice.room !== activeRoom) setNotice(null);
  }, [activeRoom, notice]);

  async function addAgents() {
    if (!activeRoom) return;
    const picked = await pickPanes({
      context: `to invite to #${activeRoom}`,
      allowCreate: true,
      disable: p =>
        p.agentStatus === 'blocked'
          ? 'at a prompt · answer it first'
          : p.presence?.rooms.includes(activeRoom)
            ? `in #${activeRoom}`
            : null,
    });
    if (!picked || picked.length === 0) return;
    try {
      const res = await fetch('/api/chat/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room: activeRoom,
          panes: picked.map(p => ({ paneId: p.paneId })),
        }),
      });
      if (!res.ok) throw new Error('invite failed');
      const { results } = (await res.json()) as { results: InviteResult[] };
      setNotice({ room: activeRoom, node: resultLine(results, picked) });
    } catch {
      notifications.error("Couldn't invite; nothing was typed into any pane.");
    }
  }

  return (
    <>
      {/* The kit's own page layout: rooms in the collapsible Sidebar (a
          drawer on phones), the page bar as the Header, the daemon banner in
          Content's notch slot, and a scroll-clamped Content whose transcript
          and roster manage their own scrolling. No ContentContainer: the
          capped, centred column is what boxed this page before. */}
      <ThemeOverrideWrapper theme={chatFontTheme}>
        <PageShell
          scrollClamp
          sidebarWidth={244}
          drawerStateKey="chat-rooms-sidebar"
        >
          {rooms.length > 0 && (
            <PageShell.Sidebar>
              <RoomRail
                sidebar
                rooms={railRooms}
                activeRoom={activeRoom}
                onSelectRoom={selectRoom}
                daemonReachable={daemon.reachable}
                onNewRoom={
                  panesAvailable ? () => setNewRoomOpen(true) : undefined
                }
                onCloseRoom={onCloseRoom}
                onMarkRead={onMarkRead}
              />
            </PageShell.Sidebar>
          )}
          <PageShell.Main>
            {activeRoomSummary && (
              <PageShell.Header>
                <PageBar
                  room={activeRoomSummary}
                  buddies={buddies.filter(b => roomMembers.includes(b.handle))}
                  reachable={daemon.reachable}
                  order={roomOrder}
                  onOrderChange={setRoomOrder}
                  onMarkedRead={() => void refetchRooms()}
                  onAddAgents={panesAvailable ? addAgents : undefined}
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
                {openRooms.length === 0 && !activeRoomSummary ? (
                  <Box style={{ flex: 1, minWidth: 0 }} p="xl">
                    <RoomsPlaceholder
                      anyBuddies={buddies.length > 0}
                      allClosed={rooms.length > 0}
                    />
                  </Box>
                ) : (
                  activeRoom && (
                    <Transcript
                      room={activeRoom}
                      messages={messages}
                      humanHandle={HUMAN_HANDLE}
                      anchor={anchor}
                      unreadCount={activeRoomSummary?.unread}
                      notice={
                        notice?.room === activeRoom ? notice.node : undefined
                      }
                      footer={
                        <Composer
                          ref={composerRef}
                          room={activeRoom}
                          roomMembers={roomMembers}
                          buddies={buddies}
                          isDm={activeRoomSummary?.kind === 'dm'}
                          daemonReachable={daemon.reachable}
                          onOpenDm={onOpenDm}
                        />
                      }
                    />
                  )
                )}
                {(railRooms.length > 0 || buddies.length > 0) && (
                  <Roster
                    panel
                    buddies={buddies}
                    now={Date.now()}
                    roomMembers={roomMembers}
                    daemonReachable={daemon.reachable}
                    // Desktop: a click only mentions; DM lives on the hover
                    // card's button. The phone drawer keeps tap-to-DM above --
                    // it has no hover card to carry the action.
                    onPick={(handle, { inRoom }) => {
                      if (inRoom) composerRef.current?.insertMention(handle);
                    }}
                  />
                )}
              </Group>
            </PageShell.Content>
          </PageShell.Main>
        </PageShell>
      </ThemeOverrideWrapper>
      <NewRoomModal
        opened={newRoomOpen}
        onClose={() => setNewRoomOpen(false)}
        daemonReachable={daemon.reachable}
        onCreated={(room, results, picked) => {
          setNewRoomOpen(false);
          void refetchRooms();
          selectRoom(room);
          if (results.length)
            setNotice({ room, node: resultLine(results, picked) });
        }}
      />
    </>
  );
}

/**
 * The whole app, today: `MattstackShell` (rail + header chrome, appName=chat
 * so the shared app launcher mounts) around the Rooms placeholder, routed by
 * wouter's default browser-location hooks (see ./routes). The kit's
 * full-screen PageShell demo stays reachable at '/demo' -- inherited
 * scaffold content, unrelated to chat, and it bypasses the chrome entirely
 * the same way it always has.
 *
 * `initialState` seeds the daemon-health and buddies data instead of a
 * network call -- the seam every UI test in this repo uses. Production
 * never passes it: the daemon poll and the buddies fetch run for real.
 */
export function App({ initialState }: { initialState?: AppInitialState } = {}) {
  const [path] = useLocation();
  const route = useAppRoute();
  const daemon = useDaemonHealth(initialState?.daemonReachable);
  const { buddies, refetchBuddies } = useBuddies(initialState?.buddies);
  const { rooms, setRooms, refetchRooms } = useRooms(initialState?.rooms);
  // A room mid-close is still in the daemon's list until the close request
  // resolves; a background refetch racing that request would otherwise put
  // the optimistically-removed row right back.
  const closingRoomsRef = useRef(new Set<string>());
  const refetchRoomsFiltered = useCallback(async () => {
    const next = await refetchRooms();
    if (closingRoomsRef.current.size === 0) return next;
    const filtered = next.filter(r => !closingRoomsRef.current.has(r.room));
    setRooms(filtered);
    return filtered;
  }, [refetchRooms, setRooms]);
  // The floor beneath the relay-driven refreshes below: a poll that still
  // runs even if a frame is missed, a reconnect never fires, or the tab
  // never blurs long enough to trigger the visibility refetch.
  useInterval(refetchRoomsFiltered, 5000);
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
    } else if (route.name === 'home') {
      // `/` means the first OPEN room; a closed room is only ever active by
      // its own link. No open room leaves nothing active, which is the
      // No rooms placeholder.
      const first = rooms.find(r => r.archivedAt === undefined)?.room;
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

  // Optimistic: the row leaves the rail before the request resolves, and a
  // failure puts the snapshot back. Closing the open room lands on `/`, the
  // same first-open-room landing a fresh open uses.
  const closeRoom = useCallback(
    async (room: string) => {
      const snapshot = rooms;
      closingRoomsRef.current.add(room);
      setRooms(prev => prev.filter(r => r.room !== room));
      if (room === activeRoom) {
        setActiveRoom(undefined);
        if (window.location.pathname !== '/') navigate('/');
      }
      try {
        const res = await fetch('/api/chat/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room }),
        });
        if (!res.ok) throw new Error('close failed');
      } catch {
        notifications.error("Couldn't close the room");
        // Restore only THIS room. A blanket setRooms(snapshot) would resurrect
        // a room a concurrent close already removed and drop one that arrived
        // since; rebuild from the snapshot keeping rooms still present plus the
        // one we failed to close, in snapshot order, then append anything new.
        setRooms(prev => {
          const present = new Set(prev.map(r => r.room));
          const revived = snapshot.filter(
            r => r.room === room || present.has(r.room)
          );
          const known = new Set(revived.map(r => r.room));
          return [...revived, ...prev.filter(r => !known.has(r.room))];
        });
        return;
      } finally {
        closingRoomsRef.current.delete(room);
      }
      void refetchRooms();
    },
    [rooms, activeRoom, setRooms, refetchRooms]
  );

  const markRead = useCallback(
    async (room: string) => {
      try {
        await postMarkRead(room);
      } catch {
        return;
      }
      void refetchRooms();
    },
    [refetchRooms]
  );

  const focusPane = useCallback(async (paneId: string) => {
    try {
      // Raw pane id in the path, like the peek route; Hono routes the colon.
      const res = await fetch(`/api/panes/${paneId}/focus`, { method: 'POST' });
      if (!res.ok) throw new Error('focus failed');
    } catch {
      notifications.error("Couldn't focus the pane");
    }
  }, []);

  const buddyActions = useMemo(
    () => ({
      mention: (handle: string) => composerRef.current?.insertMention(handle),
      dm: (handle: string) => void openDm(handle),
      focusPane: (paneId: string) => void focusPane(paneId),
    }),
    [openDm, focusPane]
  );
  const [roomOrder, setRoomOrder] = useState<RoomOrder>('join');
  const orderedRooms =
    roomOrder === 'name'
      ? [...rooms].sort((a, b) => a.room.localeCompare(b.room))
      : rooms;
  const openRooms = rooms.filter(r => r.archivedAt === undefined);
  const railRooms = visibleRooms(orderedRooms, activeRoom);

  const messages = useMessages(activeRoom, initialState?.messages);
  const { members: roomMembers, refetchMembers } = useRoomMembers(
    activeRoom,
    initialState?.members
  );
  const activeRoomSummary = rooms.find(r => r.room === activeRoom);

  // What a sleeping tab missed: rooms first (a room may have appeared),
  // then the roster, then the open room's members. The transcript refetches
  // its own tail on the same triggers.
  const refetchAll = useCallback(async () => {
    await refetchRoomsFiltered();
    refetchBuddies();
    refetchMembers();
  }, [refetchRoomsFiltered, refetchBuddies, refetchMembers]);
  useRelayOpen(reconnect => {
    if (reconnect) void refetchAll();
  });
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refetchAll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refetchAll]);

  // Each route change starts at the top of the new page.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  if (route.name === 'demo-page-shell') {
    return <PageShellDemoPage />;
  }

  if (
    chatRoute &&
    isMobile &&
    (openRooms.length > 0 || activeRoomSummary !== undefined)
  ) {
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
        onCloseRoom={closeRoom}
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
      <PanePickerProvider>
        <MattstackShell name="chat" appName="chat" mark={<AppMark size={30} />}>
          <MattstackShell.Rail>
            <RailLink icon="users" label="Rooms" href="/" active={chatRoute} />
          </MattstackShell.Rail>
          {chatRoute ? (
            <ChatPage
              rooms={rooms}
              openRooms={openRooms}
              railRooms={railRooms}
              activeRoom={activeRoom}
              activeRoomSummary={activeRoomSummary}
              selectRoom={selectRoom}
              roomOrder={roomOrder}
              setRoomOrder={setRoomOrder}
              refetchRooms={refetchRooms}
              daemon={daemon}
              buddies={buddies}
              roomMembers={roomMembers}
              messages={messages}
              anchor={anchor}
              composerRef={composerRef}
              onOpenDm={openDm}
              onCloseRoom={closeRoom}
              onMarkRead={markRead}
            />
          ) : (
            <NotFoundPage />
          )}
        </MattstackShell>
      </PanePickerProvider>
    </BuddiesProvider>
  );
}
