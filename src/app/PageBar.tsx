import {
  ActionIcon,
  Box,
  Button,
  Group,
  Menu,
  Select,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { modals } from '@mattstack/app-kit/modals';
import type { BuddyStatus, RoomSummary } from '@mattstack/rt-client';

import { AgentName } from './AgentName';
import { STATUS_WORD } from './statusDetail';

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
  /** Opens the pane picker to invite agents to this room. The button renders
      only when this is wired, and is disabled while the daemon is down. */
  onAddAgents?: () => void;
  /** The rail's sort, the artboard's `join order` select. */
  order?: RoomOrder;
  onOrderChange?: (order: RoomOrder) => void;
  /** The room's full membership for the archive confirm; defaults to the
      buddies' handles, which omit offline members. */
  memberHandles?: string[];
  /** Archive (true) or reopen (false) the room; the bar confirms an archive
      itself, naming who loses the room from their rail. */
  onArchive?: (room: string, archived: boolean) => void;
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

export function memberList(handles: string[]): string {
  if (handles.length === 0) return '';
  if (handles.length === 1) return handles[0]!;
  if (handles.length <= 4) {
    return `${handles.slice(0, -1).join(', ')} and ${handles[handles.length - 1]}`;
  }
  return `${handles.slice(0, 3).join(', ')} and ${handles.length - 3} more`;
}

function archiveLabel(room: RoomSummary): string {
  return room.kind === 'dm'
    ? 'Archive this conversation…'
    : `Archive #${room.room}…`;
}

function archiveTitle(room: RoomSummary): string {
  return room.kind === 'dm'
    ? 'Archive this conversation?'
    : `Archive #${room.room}?`;
}

/** The ⋯ control and its menu. One component for the desk's page bar and
    the phone header, so both offer the same two actions. */
export function RoomMenu({
  room,
  memberHandles,
  humanHandle = 'matt',
  onArchive,
  size = 30,
}: {
  /** `joined` is the viewer-side flag the rooms route stamps onto a fleet
      (agent-to-agent) DM the human is not a member of. */
  room: RoomSummary & { joined?: boolean };
  /** The room's current members; the human is filtered out of the confirm
      text since it already says "for you". */
  memberHandles: string[];
  humanHandle?: string;
  onArchive?: (room: string, archived: boolean) => void;
  size?: number;
}) {
  const archived = room.archivedAt !== undefined;
  // A fleet DM archive would succeed server-side with no membership row for
  // the human, dropping the room from his listing and stranding the page.
  // His OWN DMs carry `joined` truthy and stay archivable.
  const fleetDm = room.kind === 'dm' && room.joined === false;
  const others = memberList(memberHandles.filter(h => h !== humanHandle));
  const confirmArchive = () =>
    modals.confirm({
      title: archiveTitle(room),
      message: `It leaves the rail for you${others ? ` and for ${others}` : ''}. Everyone keeps their place in it, and any new post reopens it.`,
      labels: { confirm: 'Archive', cancel: 'Keep' },
      onConfirm: () => onArchive?.(room.room, true),
    });
  // The menu's only actions are Archive (hidden for a fleet DM) and Reopen
  // (archived rooms only), so an OPEN fleet DM would leave it empty. Render
  // no trigger at all rather than a button that opens an empty dropdown.
  if (!archived && fleetDm) return null;
  return (
    <Menu position="bottom-end" withinPortal radius="md" shadow="md">
      <Menu.Target>
        <ActionIcon
          variant="default"
          size={size}
          radius="md"
          aria-label="Room actions"
          data-testid="room-menu"
          styles={{ root: CONTROL_SURFACE }}
        >
          <Icon name="moreHorizontal" size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown data-testid="room-menu-dropdown">
        {archived ? (
          <Menu.Item
            data-testid="room-menu-reopen"
            onClick={() => onArchive?.(room.room, false)}
          >
            Reopen
          </Menu.Item>
        ) : (
          <Menu.Item data-testid="room-menu-archive" onClick={confirmArchive}>
            {archiveLabel(room)}
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

export function PageBar({
  room,
  buddies,
  reachable = true,
  onMarkRead,
  onAddAgents,
  order = 'join',
  onOrderChange,
  memberHandles,
  onArchive,
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
      {onAddAgents && (
        <Button
          variant="default"
          size="xs"
          radius="md"
          mr={7.2}
          data-testid="add-agents-button"
          aria-label={`Add agents to #${room.room}`}
          onClick={onAddAgents}
          disabled={!reachable}
          leftSection={<Icon name="userPlus" size={14} />}
          styles={{ root: { ...CONTROL_SURFACE, fontWeight: 500 } }}
        >
          add agents
        </Button>
      )}
      {room.unread > 0 && room.archivedAt === undefined && (
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
      <Box ml={7.2} style={{ flex: 'none' }}>
        <RoomMenu
          room={room}
          memberHandles={memberHandles ?? buddies.map(b => b.handle)}
          onArchive={onArchive}
        />
      </Box>
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
        {room.archivedAt !== undefined ? (
          <Box component="span" style={CHIP_BASE} data-testid="chip-archived">
            archived
          </Box>
        ) : (
          <Box component="span" style={CHIP_BASE} data-testid="chip-wakes">
            wakes: {wakeMode}
          </Box>
        )}
      </Group>
      <Group gap={0} ml="auto" wrap="nowrap">
        {controls}
      </Group>
    </Group>
  );
}
