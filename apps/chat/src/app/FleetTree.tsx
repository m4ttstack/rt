import { Fragment, useState } from 'react';
import {
  ActionIcon,
  Box,
  Group,
  Menu,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { useHover } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import type { RoomSummary } from '@mattstack/rt-client';

import { AgentName } from './AgentName';
import { doing } from './doing';
import classes from './fleet-tree.module.css';
import { DOT_COLOR, MUTED_XS, MUTED_XS_DIM } from './presence-bits';
import type { RosterBuddy } from './roster-types';
import { STATUS_WORD, statusDetail } from './statusDetail';

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
const BORDER = 'var(--tk-border)';

/** `.ws`'s own `padding-left`. No spacing token lands on it: it is the room
    row's 9.6px plus the tree's one indent step. */
const WORKSTREAM_INDENT = 26.4;

/** The group heading a presence row lands under when its cwd derived no repo.
    A space keeps it from ever colliding with a real repo name. */
const NO_REPO = 'no repo';

/** `.ws .h` and `.grp`, the two 11.2px names in the tree. A Mantine size
    cannot carry them: `chatFontTheme` lifts `sm` to 15px in this subtree. */
const ROW_NAME_SIZE = 'var(--tk-fs-small)';

/** The artboards draw four `.dm2` rows, then the `N more` line. */
const DM_VISIBLE = 4;

export interface DmLastMessage {
  handle: string;
  body: string;
}

/** `/api/chat/rooms`' own shape: the daemon's `RoomSummary` plus the newest
    message per DM room, joined in by `src/server/chat.ts` so a DM entry whose
    two ends have no task line still has an honest second line. */
export type FleetRoom = RoomSummary & { lastMessage?: DmLastMessage };

export interface FleetTreeProps {
  /** Channel rooms, in listing order: each heads the group of agents working
      in the repo it is named for. */
  rooms: FleetRoom[];
  /** DM rooms, in listing order, rendered under `DIRECT`. */
  dms: FleetRoom[];
  /** The whole fleet, not one room's members: every repo with a signed-in or
      recently signed-out agent gets a group, room or no room. */
  buddies: RosterBuddy[];
  /** A prop, not `Date.now()` internally, so ages are testable without fake
      timers. */
  now: number;
  activeRoom?: string;
  /** Withholds every presence claim when false. @default true */
  daemonReachable?: boolean;
  onOpenRoom?: (room: string) => void;
  onOpenDm?: (room: string) => void;
  /** Desktop: brings a workstream's herdr pane to the front. A row whose
      buddy has no pane, or that is rendered without this (and without
      `onSelectBuddy`), is not clickable. */
  onFocusPane?: (paneId: string) => void;
  /** Phone: opens a DM with the workstream's buddy instead of focusing a
      pane. Takes priority over `onFocusPane` -- callers wire one or the
      other, never both. */
  onSelectBuddy?: (handle: string) => void;
  /** The row's hover × and its right-click menu. Neither renders without it. */
  onClose?: (room: string) => void;
  /** The right-click menu's Mark read, offered only on a row with unread. */
  onMarkRead?: (room: string) => void;
}

export interface FleetGroup {
  repo: string;
  /** The repo's room, when it has one. A repo with agents and no room heads
      its group with a plain, unclickable label instead. */
  room?: FleetRoom;
  online: RosterBuddy[];
  offline: RosterBuddy[];
}

/**
 * One group per repo: every room first, in listing order, then the repos that
 * have agents but no room. A room's group key is its own name, since a repo's
 * room is the one sign-in derives from that repo's cwd.
 *
 * Members keep sign-in order inside a group and are never re-sorted by status,
 * so a working<->idle flip cannot move a row out from under the pointer.
 */
export function groupByRepo(
  rooms: FleetRoom[],
  buddies: RosterBuddy[]
): FleetGroup[] {
  const byRepo = new Map<string, RosterBuddy[]>();
  for (const buddy of [...buddies].sort(
    (a, b) => a.signedInAt - b.signedInAt
  )) {
    // A presence row whose cwd derived no repo still gets a group: this is
    // the only place the fleet is listed, so nobody may fall out of it.
    const repo = buddy.repo || NO_REPO;
    const members = byRepo.get(repo);
    if (members) members.push(buddy);
    else byRepo.set(repo, [buddy]);
  }

  const split = (members: RosterBuddy[]) => ({
    online: members.filter(b => b.status !== 'offline'),
    offline: members.filter(b => b.status === 'offline'),
  });

  const groups: FleetGroup[] = rooms.map(room => ({
    repo: room.room,
    room,
    ...split(byRepo.get(room.room) ?? []),
  }));
  const withRoom = new Set(rooms.map(r => r.room));
  for (const [repo, members] of byRepo) {
    if (withRoom.has(repo)) continue;
    groups.push({ repo, ...split(members) });
  }
  return groups;
}

/**
 * The first `cap` conversations, with the open one always among them: an
 * overflowed DM is otherwise unreachable, since the human is a silent third
 * party in an agent-to-agent pair and nothing else in the UI opens one. An
 * active DM past the cap displaces the last visible row rather than adding a
 * fifth, so the drawn count holds.
 */
export function visibleDms(
  dms: FleetRoom[],
  activeRoom: string | undefined,
  cap: number = DM_VISIBLE
): FleetRoom[] {
  if (dms.length <= cap) return dms;
  const head = dms.slice(0, cap);
  if (head.some(d => d.room === activeRoom)) return head;
  const active = dms.find(d => d.room === activeRoom);
  return active ? [...head.slice(0, cap - 1), active] : head;
}

/** `3 more · kai ↔ max 1, max ↔ wren 8`: every hidden pair with its unread,
    truncating when the line runs past the sidebar. */
function overflowLabel(hidden: FleetRoom[]): string {
  const pairs = hidden.map(d => {
    const { a, b } = d.participants!;
    return `${a} ↔ ${b}${d.unread > 0 ? ` ${d.unread}` : ''}`;
  });
  return `${hidden.length} more · ${pairs.join(', ')}`;
}

/** `.dot`: 8px, hollow whenever it has no live status to claim. */
function Dot({
  status,
  reachable,
  testId,
}: {
  status: RosterBuddy['status'];
  reachable: boolean;
  testId: string;
}) {
  const hollow = !reachable || status === 'offline';
  return (
    <Box
      component="span"
      data-testid={testId}
      style={{
        width: 8,
        height: 8,
        flex: 'none',
        borderRadius: '50%',
        background: hollow ? 'transparent' : DOT_COLOR[status],
        border: hollow ? '1px solid var(--tk-border)' : undefined,
      }}
    />
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
        flex: 'none',
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
        flex: 'none',
        border: `1px solid ${BORDER}`,
        color: 'var(--tk-muted-text)',
      }}
    >
      {count}
    </Box>
  );
}

function roomLabel(room: FleetRoom): string {
  return room.kind === 'dm' && room.participants
    ? `${room.participants.a} ↔ ${room.participants.b}`
    : `#${room.room}`;
}

/** The 22px hover × plus the row's right-click menu, the pair of close
    affordances every room and DM row carries. */
function CloseControl({
  room,
  testId,
  shown,
  nudge,
  onClose,
}: {
  room: FleetRoom;
  testId: string;
  shown: boolean;
  /** `.room .close` pulls back into the row's own padding; `.dm2 .close`
      does not. */
  nudge: boolean;
  onClose: (room: string) => void;
}) {
  return (
    <Tooltip label="Close" position="top" withinPortal>
      <ActionIcon
        variant="subtle"
        size="sm"
        radius="md"
        color="gray"
        aria-label={`Close ${roomLabel(room)}`}
        data-testid={testId}
        onClick={e => {
          e.stopPropagation();
          onClose(room.room);
        }}
        style={{
          display: shown ? undefined : 'none',
          flex: 'none',
          marginRight: nudge ? -4 : undefined,
          color: 'var(--tk-muted-text)',
        }}
      >
        <Icon name="close" size={14} />
      </ActionIcon>
    </Tooltip>
  );
}

function RowMenu({
  room,
  testId,
  onChange,
  onClose,
  onMarkRead,
  children,
}: {
  room: FleetRoom;
  testId: string;
  onChange: (opened: boolean) => void;
  onClose: (room: string) => void;
  onMarkRead?: (room: string) => void;
  children: React.ReactElement;
}) {
  return (
    <Menu onChange={onChange} radius="md" shadow="md" withinPortal>
      <Menu.ContextMenu>{children}</Menu.ContextMenu>
      <Menu.Dropdown data-testid={testId}>
        <Menu.Label>{roomLabel(room)}</Menu.Label>
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
 * A tree row is a `div[role=button]`, not a `<button>`: the close control
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
  room: FleetRoom;
  active: boolean;
  onSelect?: () => void;
  onClose?: (room: string) => void;
  onMarkRead?: (room: string) => void;
}) {
  const { ref, hovered } = useHover<HTMLDivElement>();
  const [menuOpened, setMenuOpened] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const closable = onClose !== undefined;

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
      <Icon
        name="hash"
        size={14}
        color={active ? ACCENT_TEXT : 'var(--tk-muted-text)'}
        style={{ flex: 'none' }}
      />
      <Text
        fw={active ? 600 : undefined}
        truncate
        style={{ flex: 1, minWidth: 0 }}
      >
        {room.room}
      </Text>
      {room.mentions > 0 && <MentionBadge count={room.mentions} />}
      {room.unread > 0 && <UnreadBadge count={room.unread} />}
      {closable && (
        <CloseControl
          room={room}
          testId={`room-close-${room.room}`}
          shown={hovered || focusWithin || menuOpened}
          nudge
          onClose={onClose}
        />
      )}
    </Box>
  );

  if (!closable) return row;
  return (
    <RowMenu
      room={room}
      testId={`room-context-${room.room}`}
      onChange={setMenuOpened}
      onClose={onClose}
      onMarkRead={onMarkRead}
    >
      {row}
    </RowMenu>
  );
}

/** A repo with agents but no room: the same 34px row, no hash, the name
    muted, and `no room` where the badges would sit. Not a target. */
function RepoRow({ repo }: { repo: string }) {
  return (
    <Box
      data-testid={`repo-row-${repo}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        minWidth: 0,
        width: '100%',
        height: 34,
        gap: 'var(--mantine-spacing-sm)',
        padding: '0 var(--mantine-spacing-md)',
        borderRadius: 'var(--mantine-radius-md)',
        cursor: 'default',
      }}
    >
      {/* `.grp`: muted, since this heading is a label rather than a place
          to go. */}
      <Text
        truncate
        data-testid={`repo-name-${repo}`}
        style={{
          fontSize: ROW_NAME_SIZE,
          flex: 1,
          minWidth: 0,
          color: 'var(--tk-muted-text)',
        }}
      >
        {repo}
      </Text>
      <Text component="span" style={{ ...MUTED_XS, flex: 'none' }}>
        no room
      </Text>
    </Box>
  );
}

/** One signed-in session inside its repo: dot, handle, and the task line
    filling the rest of the row. Clicking brings its pane to the front. */
function WorkstreamRow({
  buddy,
  now,
  reachable,
  onFocusPane,
  onSelectBuddy,
}: {
  buddy: RosterBuddy;
  now: number;
  reachable: boolean;
  /** Desktop: brings the buddy's herdr pane to the front. Ignored when
      `onSelectBuddy` is given -- the two are mutually exclusive per caller,
      never both wired to the same tree. */
  onFocusPane?: (paneId: string) => void;
  /** Phone: opens a DM with the buddy instead. Focusing a pane is
      meaningless on a phone -- the whole premise of the phone surface is
      that Matt is away from the machine -- so this takes priority over
      `onFocusPane` whenever both are somehow present. */
  onSelectBuddy?: (handle: string) => void;
}) {
  const { handle, pane } = buddy;
  const task = reachable ? doing(buddy, now) : null;
  const onClick = onSelectBuddy
    ? () => onSelectBuddy(handle)
    : pane !== undefined && onFocusPane
      ? () => onFocusPane(pane)
      : undefined;
  const clickable = onClick !== undefined;
  // The row's click focuses a herder pane only on the desktop path; the phone
  // path (`onSelectBuddy`) opens a DM instead and has no hover to hint on.
  const focusesPane =
    !onSelectBuddy && pane !== undefined && onFocusPane !== undefined;
  return (
    <UnstyledButton
      className={classes.wsRow}
      component={clickable ? 'button' : 'div'}
      data-testid={`ws-${handle}`}
      aria-label={
        onSelectBuddy
          ? `Message ${handle}`
          : clickable
            ? `Focus ${handle}'s pane`
            : undefined
      }
      onClick={onClick}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        minWidth: 0,
        overflow: 'hidden',
        height: 30,
        gap: 'var(--mantine-spacing-sm)',
        padding: `0 var(--mantine-spacing-md) 0 ${WORKSTREAM_INDENT}px`,
        borderRadius: 'var(--mantine-radius-md)',
        cursor: clickable ? 'pointer' : 'default',
        textAlign: 'left',
      }}
    >
      <Tooltip
        label={
          reachable
            ? `${STATUS_WORD[buddy.status]} · ${statusDetail(buddy, now)}`
            : 'presence withheld while the daemon is down'
        }
        position="left"
        openDelay={300}
        withArrow
      >
        <Box component="span" style={{ display: 'inline-flex', flex: 'none' }}>
          <Dot
            status={buddy.status}
            reachable={reachable}
            testId={`dot-${handle}`}
          />
        </Box>
      </Tooltip>
      <Text
        component="span"
        fw={600}
        data-testid={`ws-handle-${handle}`}
        style={{ fontSize: ROW_NAME_SIZE, flex: 'none' }}
      >
        <AgentName
          handle={handle}
          variant="name"
          withAvatar={false}
          buddy={buddy}
          reachable={reachable}
          now={now}
        />
      </Text>
      <Text
        component="span"
        truncate
        data-testid={`ws-doing-${handle}`}
        style={{
          ...(task?.kind === 'path' || !reachable ? MUTED_XS_DIM : MUTED_XS),
          flex: 1,
          minWidth: 0,
        }}
      >
        {reachable ? (task?.text ?? '') : 'presence withheld'}
      </Text>
      {focusesPane && (
        <Box
          component="span"
          aria-hidden
          className={classes.focusHint}
          data-testid={`ws-focus-hint-${handle}`}
        >
          <Icon name="maximize" size={11} />
          focus pane
        </Box>
      )}
    </UnstyledButton>
  );
}

/** The repo's signed-out members as one muted line. Two or more collapse to
    a count and their names; a single one keeps its name and its age. */
function OfflineRow({
  repo,
  offline,
  now,
}: {
  repo: string;
  offline: RosterBuddy[];
  now: number;
}) {
  const only = offline.length === 1 ? offline[0]! : undefined;
  return (
    <Box
      data-testid={`offline-${repo}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        minWidth: 0,
        overflow: 'hidden',
        height: 26,
        gap: 'var(--mantine-spacing-sm)',
        padding: `0 var(--mantine-spacing-md) 0 ${WORKSTREAM_INDENT}px`,
        borderRadius: 'var(--mantine-radius-md)',
        cursor: 'default',
        ...MUTED_XS,
      }}
    >
      <Dot status="offline" reachable testId={`dot-offline-${repo}`} />
      <Text component="span" inherit truncate style={{ minWidth: 0 }}>
        {only
          ? `${only.handle} · ${statusDetail(only, now)}`
          : `${offline.length} signed out · ${offline.map(b => b.handle).join(' ')}`}
      </Text>
    </Box>
  );
}

/**
 * A direct conversation, named by its pair, one line like a channel row. The
 * hashed room name is structurally never rendered -- the pair IS the name.
 * A fixed height keeps the row from growing when the hover × appears.
 */
function DmRow({
  room,
  active,
  onSelect,
  onClose,
  onMarkRead,
}: {
  room: FleetRoom;
  active: boolean;
  onSelect?: () => void;
  onClose?: (room: string) => void;
  onMarkRead?: (room: string) => void;
}) {
  const { ref, hovered } = useHover<HTMLDivElement>();
  const [menuOpened, setMenuOpened] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const closable = onClose !== undefined;
  const pair = room.participants!;

  const row = (
    <Box
      ref={ref}
      role="button"
      tabIndex={0}
      data-testid={`dm-row-${room.room}`}
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
        width: '100%',
        minWidth: 0,
        height: 34,
        overflow: 'hidden',
        gap: 4,
        padding: '0 var(--mantine-spacing-md)',
        borderRadius: 'var(--mantine-radius-md)',
        cursor: 'pointer',
        background: active
          ? ACCENT_WASH
          : hovered || menuOpened
            ? 'var(--ui-bg-4)'
            : undefined,
      }}
    >
      {/* textContent, not three separate runs: the arrow needs its own span
          for the purple, but a screen reader still reads one phrase. */}
      <Text
        fw={600}
        truncate
        style={{ fontSize: ROW_NAME_SIZE, flex: 1, minWidth: 0 }}
      >
        <AgentName handle={pair.a} withCard={false} withAvatar={false} />{' '}
        <span style={{ color: 'var(--tk-purple)', flex: 'none' }}>↔</span>{' '}
        <AgentName handle={pair.b} withCard={false} withAvatar={false} />
      </Text>
      {room.unread > 0 && <UnreadBadge count={room.unread} />}
      {closable && (
        <CloseControl
          room={room}
          testId={`dm-close-${room.room}`}
          shown={hovered || focusWithin || menuOpened}
          nudge={false}
          onClose={onClose}
        />
      )}
    </Box>
  );

  if (!closable) return row;
  return (
    <RowMenu
      room={room}
      testId={`dm-context-${room.room}`}
      onChange={setMenuOpened}
      onClose={onClose}
      onMarkRead={onMarkRead}
    >
      {row}
    </RowMenu>
  );
}

/**
 * The `N more` control. It shares the offline roll-up's look (26px, muted,
 * truncating) but not its `cursor: default`: this one is the only way to
 * reach a conversation the cap hides, so it has to answer a click.
 */
function DmOverflowRow({
  hidden,
  expanded,
  onToggle,
}: {
  hidden: FleetRoom[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <UnstyledButton
      className={classes.moreRow}
      data-testid="dm-more"
      aria-expanded={expanded}
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        minWidth: 0,
        overflow: 'hidden',
        height: 26,
        gap: 'var(--mantine-spacing-sm)',
        padding: '0 var(--mantine-spacing-md)',
        borderRadius: 'var(--mantine-radius-md)',
        cursor: 'pointer',
        textAlign: 'left',
        ...MUTED_XS,
      }}
    >
      <Text component="span" inherit truncate style={{ minWidth: 0 }}>
        {expanded ? 'show fewer' : overflowLabel(hidden)}
      </Text>
    </UnstyledButton>
  );
}

/**
 * The sidebar's one tree. Every repo the fleet works in heads a group -- its
 * room when it has one, a plain label when it does not -- with that repo's
 * signed-in sessions under it and its signed-out members rolled into a line.
 * Direct conversations follow, named by their pair.
 *
 * This replaces both of the surfaces it succeeds (a flat rooms rail and a
 * separate roster panel): a handle read next to the room it works in answers
 * "who is this" without a second column to cross-reference.
 */
export function FleetTree({
  rooms,
  dms,
  buddies,
  now,
  activeRoom,
  daemonReachable = true,
  onOpenRoom,
  onOpenDm,
  onFocusPane,
  onSelectBuddy,
  onClose,
  onMarkRead,
}: FleetTreeProps) {
  const [dmsExpanded, setDmsExpanded] = useState(false);
  const groups = groupByRepo(rooms, buddies);
  // A DM is named by its pair, so a participant-less one would crash DmRow and
  // overflowLabel. RoomRail filters them upstream, but the exported FleetTree
  // guards its own input too. `namedDms` is then already `visibleRooms`-filtered,
  // so the cap counts only conversations that are actually listed.
  const namedDms = dms.filter(d => d.participants);
  const shownDms = dmsExpanded ? namedDms : visibleDms(namedDms, activeRoom);
  const hiddenDms = namedDms.filter(d => !shownDms.includes(d));

  return (
    <Fragment>
      {groups.map(group => (
        <Fragment key={group.repo}>
          {group.room ? (
            <RoomRow
              room={group.room}
              active={group.room.room === activeRoom}
              onSelect={() => onOpenRoom?.(group.repo)}
              onClose={onClose}
              onMarkRead={onMarkRead}
            />
          ) : (
            <RepoRow repo={group.repo} />
          )}
          {group.online.map(buddy => (
            <WorkstreamRow
              key={buddy.handle}
              buddy={buddy}
              now={now}
              reachable={daemonReachable}
              onFocusPane={onFocusPane}
              onSelectBuddy={onSelectBuddy}
            />
          ))}
          {group.offline.length > 0 && (
            <OfflineRow repo={group.repo} offline={group.offline} now={now} />
          )}
        </Fragment>
      ))}

      {namedDms.length > 0 && (
        <>
          <Group
            gap="sm"
            wrap="nowrap"
            style={{
              padding:
                'var(--mantine-spacing-md) var(--mantine-spacing-md) var(--mantine-spacing-xs)',
              borderBottom: '1px solid var(--tk-border-soft)',
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
          {shownDms.map(room => (
            <DmRow
              key={room.room}
              room={room}
              active={room.room === activeRoom}
              onSelect={() => onOpenDm?.(room.room)}
              onClose={onClose}
              onMarkRead={onMarkRead}
            />
          ))}
          {(hiddenDms.length > 0 || dmsExpanded) && (
            <DmOverflowRow
              hidden={hiddenDms}
              expanded={dmsExpanded}
              onToggle={() => setDmsExpanded(!dmsExpanded)}
            />
          )}
        </>
      )}
    </Fragment>
  );
}
